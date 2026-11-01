import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * AI recipe draft: given a dish the POS sold, Claude proposes the
 * AUTHENTIC single-serving recipe. Ingredients the restaurant
 * already buys (its canonical catalog) are preferred by exact name;
 * genuine essentials the catalog lacks (a batter flour, a dal) are
 * added in clean canonical format and created as new catalog items
 * — the catalog grows from the menu, not only from invoices.
 * Saved as confidence='ai_inferred' for the owner to review, edit
 * and confirm on the Recipes page.
 *
 * Refuses to overwrite a user-confirmed recipe.
 */

const UNITS = ['oz', 'lb', 'each', 'floz', 'g']
const HOUSE_CATEGORIES = [
  'Proteins',
  'Produce',
  'Dairy',
  'Dry Goods',
  'Beverages',
  'Packaging',
  'Cleaning',
  'Other',
]

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 /-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function defaultUnitFor(unit: string): string {
  if (unit === 'each') return 'EA'
  if (unit === 'floz') return 'GAL'
  return 'LB'
}

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!serviceKey || !apiKey) {
    return NextResponse.json(
      { error: 'Recipe drafting is not configured on the server' },
      { status: 500 }
    )
  }

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const body = (await req.json()) as {
    restaurant_id?: string
    menu_item_name?: string
    component?: boolean
  }
  const restaurantId = body.restaurant_id
  const dish = (body.menu_item_name || '').trim()
  const isComponent = body.component === true
  if (!restaurantId || !dish) {
    return NextResponse.json({ error: 'restaurant_id and menu_item_name required' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: userData } = await anon.auth.getUser(token)
  const user = userData?.user
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const sb = createClient(url, serviceKey)
  const { data: membership } = await sb
    .from('user_restaurants')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this restaurant' }, { status: 403 })
  }

  // A confirmed recipe is the owner's word — never overwrite it.
  const { data: existing } = await sb
    .from('recipes_estimated')
    .select('confidence')
    .eq('restaurant_id', restaurantId)
    .eq('menu_item_name', dish)
  if ((existing ?? []).some((r) => r.confidence === 'user_confirmed')) {
    return NextResponse.json(
      { error: 'This dish already has a confirmed recipe — edit it instead.' },
      { status: 409 }
    )
  }

  const { data: rest } = await sb
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .maybeSingle()

  // Ingredient vocabulary: the canonical catalog. Items this
  // restaurant actually buys are listed first (most relevant).
  const { data: canonicalRows } = await sb
    .from('canonical_items')
    .select('id, name, default_unit')
  const canonical = (canonicalRows ?? []) as { id: string; name: string; default_unit: string | null }[]
  if (canonical.length === 0) {
    return NextResponse.json(
      { error: 'No ingredients catalog yet — upload a few invoices first so ingredients can be mapped.' },
      { status: 400 }
    )
  }
  const { data: purchasedLines } = await sb
    .from('invoice_lines')
    .select('canonical_item_id')
    .eq('restaurant_id', restaurantId)
    .not('canonical_item_id', 'is', null)
    .limit(500)
  const purchasedIds = new Set((purchasedLines ?? []).map((l) => l.canonical_item_id as string))
  const sorted = [...canonical].sort((a, b) => {
    const pa = purchasedIds.has(a.id) ? 0 : 1
    const pb = purchasedIds.has(b.id) ? 0 : 1
    return pa - pb || a.name.localeCompare(b.name)
  })
  const vocab = sorted.map((c) => `- ${c.name} (usually bought per ${c.default_unit ?? 'EA'})`).join('\n')

  const system = isComponent
    ? [
        'You are an experienced restaurant chef and cost consultant.',
        `Draft the standard BATCH recipe for a preparation ("${dish}") as a restaurant kitchen makes it — one normal prep batch, not a single serving.`,
        'Ingredient naming rules (important):',
        '- lowercase, full words: "toor dal", "tamarind", "coconut", "mustard seeds".',
        '- NO brand names, NO size or packaging words (no "jumbo", "bulk"), NO abbreviations.',
        '- The user message lists ingredients this restaurant already buys. When one fits, use its exact name. When the preparation genuinely needs an ingredient that is NOT listed, add it in the same clean format — never substitute a wrong ingredient just because it is listed.',
        '- Quantities are for the WHOLE batch, in realistic prep quantities.',
        '- unit must be one of: oz, lb, each, floz, g.',
        '- category must be one of: Proteins, Produce, Dairy, Dry Goods, Beverages, Packaging, Cleaning, Other.',
        '- Also return the batch yield: how much finished preparation the batch makes. For sauces, chutneys, gravies and batters express yield_qty in oz (weight) with yield_unit "oz".',
        '- Include 4 to 12 ingredients.',
        'Return ONLY a JSON object, no prose: {"yield_qty":number,"yield_unit":"oz","lines":[{"ingredient_name":"...","quantity":number,"unit":"oz","category":"Produce"}]}',
      ].join('\n')
    : [
        'You are an experienced restaurant chef and cost consultant.',
        'Draft the AUTHENTIC single-serving recipe for the dish — what a real kitchen would use, including accompaniments served on the plate (chutneys, sambar, fillings, garnishes).',
        'Ingredient naming rules (important):',
        '- lowercase, full words: "rice flour", "urad dal", "yellow onion", "salt".',
        '- NO brand names (never a branded salt or flour — just "salt", "flour"), NO size or packaging words (no "jumbo", "bulk", "40-pack"), NO abbreviations.',
        '- The user message lists ingredients this restaurant already buys. When one fits, use its exact name. When the dish genuinely needs an ingredient that is NOT listed, add it in the same clean format — never substitute a wrong ingredient just because it is listed.',
        '- Quantities are per ONE serving, in realistic restaurant portions.',
        '- unit must be one of: oz, lb, each, floz, g.',
        '- category must be one of: Proteins, Produce, Dairy, Dry Goods, Beverages, Packaging, Cleaning, Other.',
        '- Include 4 to 12 ingredients.',
        'Return ONLY a JSON object, no prose: {"lines":[{"ingredient_name":"...","quantity":number,"unit":"oz","category":"Produce"}]}',
      ].join('\n')
  const userMsg = isComponent
    ? `Restaurant: ${rest?.name ?? 'a restaurant'}\nPreparation (one batch): ${dish}\n\nIngredients this restaurant already buys (prefer these exact names when they fit):\n${vocab}`
    : `Restaurant: ${rest?.name ?? 'a restaurant'}\nDish: ${dish}\n\nIngredients this restaurant already buys (prefer these exact names when they fit):\n${vocab}`

  const draft: { ingredient_name: string; quantity: number; unit: string }[] = []
  let yieldQty: number | null = null
  let yieldUnit: string | null = null
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`)
    const data = await resp.json()
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('No JSON in draft response')
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      yield_qty?: number
      yield_unit?: string
      lines?: { ingredient_name?: string; quantity?: number; unit?: string; category?: string }[]
    }
    if (
      typeof parsed.yield_qty === 'number' &&
      parsed.yield_qty > 0 &&
      parsed.yield_unit &&
      UNITS.includes(parsed.yield_unit)
    ) {
      yieldQty = parsed.yield_qty
      yieldUnit = parsed.yield_unit
    }
    const rawLines = (parsed.lines ?? []).filter(
      (l) =>
        l.ingredient_name &&
        typeof l.quantity === 'number' &&
        l.quantity > 0 &&
        l.quantity <= 10000 &&
        l.unit &&
        UNITS.includes(l.unit)
    )

    // Resolve each ingredient to the catalog, creating clean new
    // canonical items for genuine essentials the catalog lacks.
    const byName = new Map(canonical.map((c) => [c.name, c]))
    const seen = new Set<string>()
    for (const l of rawLines) {
      const name = normalizeName(l.ingredient_name as string)
      if (!name || seen.has(name)) continue
      seen.add(name)
      if (!byName.has(name)) {
        const category =
          l.category && HOUSE_CATEGORIES.includes(l.category) ? l.category : 'Other'
        const { data: created } = await sb
          .from('canonical_items')
          .insert({ name, category, default_unit: defaultUnitFor(l.unit as string) })
          .select('id, name, default_unit')
          .single()
        if (created) {
          byName.set(name, created)
        } else {
          // Unique conflict (raced or pre-existing under another
          // normalization) — re-read; drop the line if truly absent.
          const { data: again } = await sb
            .from('canonical_items')
            .select('id, name, default_unit')
            .eq('name', name)
            .maybeSingle()
          if (!again) continue
          byName.set(name, again)
        }
      }
      draft.push({
        ingredient_name: name,
        quantity: l.quantity as number,
        unit: l.unit as string,
      })
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not draft a recipe: ${(e as Error).message}` },
      { status: 502 }
    )
  }
  if (draft.length === 0) {
    return NextResponse.json(
      { error: 'The draft came back empty — none of the suggested ingredients matched your catalog.' },
      { status: 502 }
    )
  }

  // Replace the previous AI draft (confirmed rows were refused above).
  await sb
    .from('recipes_estimated')
    .delete()
    .eq('restaurant_id', restaurantId)
    .eq('menu_item_name', dish)
    .eq('confidence', 'ai_inferred')
  const { error: insErr } = await sb.from('recipes_estimated').insert(
    draft.map((l) => ({
      restaurant_id: restaurantId,
      menu_item_name: dish,
      ingredient_name: l.ingredient_name,
      quantity: l.quantity,
      unit: l.unit,
      confidence: 'ai_inferred',
      source: 'claude:opus-4.7',
    }))
  )
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Components also record their batch yield (sql/018). The upsert
  // needs the table to exist; if it doesn't, the lines still saved —
  // surface it as a soft warning in the response.
  let metaError: string | null = null
  if (isComponent) {
    if (yieldQty != null && yieldUnit) {
      const { error: metaErr } = await sb.from('recipe_meta').upsert(
        {
          restaurant_id: restaurantId,
          recipe_name: dish,
          kind: 'component',
          yield_qty: yieldQty,
          yield_unit: yieldUnit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id,recipe_name' }
      )
      if (metaErr) metaError = metaErr.message
    } else {
      metaError = 'The draft did not include a batch yield.'
    }
  }

  return NextResponse.json({
    lines: draft,
    yield_qty: yieldQty,
    yield_unit: yieldUnit,
    meta_error: metaError,
  })
}
