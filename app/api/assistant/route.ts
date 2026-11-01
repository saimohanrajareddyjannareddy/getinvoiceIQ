import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchPriceAlerts } from '@/lib/alerts'

/*
 * "Ask getinvoiceIQ" — a read-only agent over ONE restaurant's books.
 *
 * The browser sends the signed-in user's access token; the route
 * verifies it, checks the user belongs to the restaurant, and only
 * then lets Claude call data tools through the service client with
 * every query scoped to that restaurant. The model can read —
 * never write — and answers only from tool results.
 */

type Msg = { role: 'user' | 'assistant'; content: string }

const TOOLS = [
  {
    name: 'search_items',
    description:
      'Find purchases of items whose name contains the query (e.g. "chicken", "milk", "oil") in a date range. Returns each matching purchase plus aggregates: total spend, purchase count, and quantities summed per unit (lb / case / each kept separate). Use this for "how much X did I buy" questions.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against item names' },
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        date_to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
      },
      required: ['query', 'date_from', 'date_to'],
    },
  },
  {
    name: 'spend_summary',
    description:
      'Total invoice spend in a date range, optionally grouped by vendor or by category. Use for "what did I spend" questions.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        group_by: { type: 'string', enum: ['none', 'vendor', 'category'] },
      },
      required: ['date_from', 'date_to', 'group_by'],
    },
  },
  {
    name: 'list_invoices',
    description: 'List invoices in a date range, newest first, optionally filtered to one vendor.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        vendor: { type: 'string', description: 'Optional vendor name filter (partial match)' },
        limit: { type: 'number', description: 'Max invoices to return (default 15)' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'sales_summary',
    description:
      'Net sales (after discounts and refunds, tax excluded) from the POS in a date range, plus the food-cost percentage for the same range when invoice data exists. Use for sales and food-cost questions.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
      required: ['date_from', 'date_to'],
    },
  },
  {
    name: 'price_alerts',
    description:
      'Items whose latest purchase price moved versus their previous purchase (price increases and decreases), biggest moves first.',
    input_schema: {
      type: 'object',
      properties: {
        min_change_pct: { type: 'number', description: 'Minimum absolute percent move (default 5)' },
      },
      required: [],
    },
  },
] as const

type ToolName = (typeof TOOLS)[number]['name']

function qtyOf(line: { purchase_unit: string | null; unit_qty: number | null; case_qty: number | null }): number {
  const unit = (line.purchase_unit || '').toLowerCase()
  if (unit === 'case') return line.case_qty || line.unit_qty || 0
  return line.unit_qty || line.case_qty || 0
}

async function approvedHeaderIds(
  sb: SupabaseClient,
  restaurantId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ ids: string[]; headers: { id: string; vendor: string; invoice_date: string; invoice_number: string | null; total: number }[] }> {
  const { data } = await sb
    .from('invoice_headers')
    .select('id, vendor, invoice_date, invoice_number, total')
    .eq('restaurant_id', restaurantId)
    .neq('review_status', 'needs_review')
    .gte('invoice_date', dateFrom)
    .lte('invoice_date', dateTo)
    .order('invoice_date', { ascending: false })
  const headers = (data || []) as { id: string; vendor: string; invoice_date: string; invoice_number: string | null; total: number }[]
  return { ids: headers.map((h) => h.id), headers }
}

async function runTool(
  sb: SupabaseClient,
  restaurantId: string,
  name: ToolName,
  input: Record<string, unknown>
): Promise<unknown> {
  if (name === 'search_items') {
    const query = String(input.query || '').replace(/[%_,()]/g, ' ').trim()
    const { ids, headers } = await approvedHeaderIds(sb, restaurantId, String(input.date_from), String(input.date_to))
    if (ids.length === 0 || !query) return { matches: [], note: 'No approved invoices in that date range.' }
    const vendorById = new Map(headers.map((h) => [h.id, h]))
    const { data } = await sb
      .from('invoice_lines')
      .select('item_name, display_name, category, purchase_unit, unit_qty, case_qty, unit_price, total, header_id')
      .eq('restaurant_id', restaurantId)
      .in('header_id', ids)
      .or(`item_name.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(200)
    const lines = data || []
    // Quantities on credit/return lines are stored unsigned in some
    // older parses — the sign lives on the money. Net them here:
    // qty counts negative when the line total is negative, and
    // purchases vs credits are reported separately so the answer
    // can state the net plainly.
    const buyQty: Record<string, number> = {}
    const creditQty: Record<string, number> = {}
    let buySpend = 0
    let creditSpend = 0
    let buyCount = 0
    let creditCount = 0
    const matches = lines.map((l) => {
      const h = vendorById.get(l.header_id)
      const qty = qtyOf(l)
      const unit = (l.purchase_unit || 'each').toLowerCase()
      const isCredit = (l.total || 0) < 0
      if (isCredit) {
        creditQty[unit] = Math.round(((creditQty[unit] || 0) + qty) * 100) / 100
        creditSpend += l.total || 0
        creditCount++
      } else {
        buyQty[unit] = Math.round(((buyQty[unit] || 0) + qty) * 100) / 100
        buySpend += l.total || 0
        buyCount++
      }
      return {
        item: l.display_name || l.item_name,
        vendor: h?.vendor,
        date: h?.invoice_date,
        qty,
        unit,
        unit_price: l.unit_price,
        total: l.total,
        credit: isCredit,
      }
    })
    matches.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const netQty: Record<string, number> = {}
    for (const u of new Set([...Object.keys(buyQty), ...Object.keys(creditQty)])) {
      netQty[u] = Math.round(((buyQty[u] || 0) - (creditQty[u] || 0)) * 100) / 100
    }
    return {
      purchases: {
        count: buyCount,
        spend: Math.round(buySpend * 100) / 100,
        quantities_by_unit: buyQty,
      },
      credits: {
        count: creditCount,
        amount: Math.round(creditSpend * 100) / 100,
        quantities_by_unit: creditQty,
      },
      net: {
        spend: Math.round((buySpend + creditSpend) * 100) / 100,
        quantities_by_unit: netQty,
      },
      matches: matches.slice(0, 25),
    }
  }

  if (name === 'spend_summary') {
    const groupBy = String(input.group_by || 'none')
    const { ids, headers } = await approvedHeaderIds(sb, restaurantId, String(input.date_from), String(input.date_to))
    const grand = headers.reduce((s, h) => s + (h.total || 0), 0)
    if (groupBy === 'vendor') {
      const byVendor = new Map<string, number>()
      for (const h of headers) byVendor.set(h.vendor || 'Unknown', (byVendor.get(h.vendor || 'Unknown') || 0) + (h.total || 0))
      return {
        total_spend: Math.round(grand * 100) / 100,
        invoice_count: headers.length,
        by_vendor: [...byVendor.entries()].map(([vendor, spend]) => ({ vendor, spend: Math.round(spend * 100) / 100 })).sort((a, b) => b.spend - a.spend),
      }
    }
    if (groupBy === 'category') {
      if (ids.length === 0) return { total_spend: 0, invoice_count: 0, by_category: [] }
      const { data } = await sb.from('invoice_lines').select('category, total').eq('restaurant_id', restaurantId).in('header_id', ids)
      const byCat = new Map<string, number>()
      for (const l of data || []) byCat.set(l.category || 'Other', (byCat.get(l.category || 'Other') || 0) + (l.total || 0))
      return {
        total_spend: Math.round(grand * 100) / 100,
        invoice_count: headers.length,
        by_category: [...byCat.entries()].map(([category, spend]) => ({ category, spend: Math.round(spend * 100) / 100 })).sort((a, b) => b.spend - a.spend),
      }
    }
    return { total_spend: Math.round(grand * 100) / 100, invoice_count: headers.length }
  }

  if (name === 'list_invoices') {
    const limit = Math.min(30, Math.max(1, Number(input.limit) || 15))
    let q = sb
      .from('invoice_headers')
      .select('vendor, invoice_number, invoice_date, total')
      .eq('restaurant_id', restaurantId)
      .neq('review_status', 'needs_review')
      .gte('invoice_date', String(input.date_from))
      .lte('invoice_date', String(input.date_to))
      .order('invoice_date', { ascending: false })
      .limit(limit)
    if (input.vendor) q = q.ilike('vendor', `%${String(input.vendor).replace(/[%_]/g, '')}%`)
    const { data } = await q
    return { invoices: data || [] }
  }

  if (name === 'sales_summary') {
    const from = String(input.date_from)
    const to = String(input.date_to)
    const { data, error } = await sb
      .from('daily_sales')
      .select('date, net_cents')
      .eq('restaurant_id', restaurantId)
      .gte('date', from)
      .lte('date', to)
    if (error) return { note: 'No POS sales data is connected for this restaurant.' }
    const netSales = (data || []).reduce((s, r) => s + (r.net_cents || 0), 0) / 100
    const { headers } = await approvedHeaderIds(sb, restaurantId, from, to)
    const spend = headers.reduce((s, h) => s + (h.total || 0), 0)
    return {
      net_sales: Math.round(netSales * 100) / 100,
      days_with_sales: (data || []).length,
      invoice_spend_same_range: Math.round(spend * 100) / 100,
      food_cost_pct: netSales > 0 ? Math.round((spend / netSales) * 1000) / 10 : null,
    }
  }

  if (name === 'price_alerts') {
    const alerts = await fetchPriceAlerts(sb, restaurantId, Number(input.min_change_pct) || 5)
    return { alerts: alerts.slice(0, 15) }
  }

  return { error: 'unknown tool' }
}

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!serviceKey || !apiKey) {
    return NextResponse.json({ error: 'Assistant is not configured on the server' }, { status: 500 })
  }

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const body = (await req.json()) as {
    restaurant_id?: string
    messages?: Msg[]
    today?: string
    weekday?: string
  }
  const restaurantId = body.restaurant_id
  const history = (body.messages || []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()
  ).slice(-12)
  if (!restaurantId || history.length === 0) {
    return NextResponse.json({ error: 'restaurant_id and messages required' }, { status: 400 })
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
  if (!membership) return NextResponse.json({ error: 'Not a member of this restaurant' }, { status: 403 })

  const { data: rest } = await sb.from('restaurants').select('name').eq('id', restaurantId).maybeSingle()
  const today = body.today || new Date().toISOString().slice(0, 10)
  const weekday = body.weekday || ''

  const system = `You are the getinvoiceIQ assistant inside the dashboard of the restaurant "${rest?.name || 'this restaurant'}". You answer questions about THIS restaurant's invoices, purchases, item prices, suppliers and POS sales using the tools.

Today is ${weekday} ${today} (the restaurant's local date). Interpret relative dates against today: "this week" = Monday of this week through today; "last week" = the full previous Monday through Sunday; "this month" = the 1st through today; "last month" = the full previous month; "today" = today only. Always tell the user the exact date range you used.

Rules:
- Use the tools before answering. Never invent numbers, prices, or invoices.
- search_items returns purchases and credits (returns/discounts) separately, plus the net. Report it that way: what was bought, what was credited back, and the net received — never merge credit quantities into purchase quantities.
- Report quantities per unit (lb, case, each) separately — never add different units together.
- Format money as dollars with two decimals.
- If the tools return no matching data, say so plainly and suggest what to check (e.g. a wider date range or a different spelling).
- Keep answers short and direct. A compact list is fine; no filler.
- You are read-only: if asked to change, delete, or add data, explain where in the app that is done (Upload, Review, the invoice page) instead.`

  type Block = Record<string, unknown>
  const messages: { role: string; content: string | Block[] }[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  try {
    for (let round = 0; round < 6; round++) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-7',
          max_tokens: 1600,
          system,
          tools: TOOLS,
          messages,
        }),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return NextResponse.json({ error: `Assistant model error (${resp.status}): ${errText.slice(0, 200)}` }, { status: 502 })
      }
      const result = (await resp.json()) as { stop_reason?: string; content?: Block[] }
      const content = result.content || []
      if (result.stop_reason !== 'tool_use') {
        const text = content
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text || ''))
          .join('\n')
          .trim()
        return NextResponse.json({ reply: text || 'I could not find an answer in your data.' })
      }
      messages.push({ role: 'assistant', content })
      const toolResults: Block[] = []
      for (const block of content) {
        if (block.type !== 'tool_use') continue
        const name = String(block.name) as ToolName
        let out: unknown
        try {
          out = await runTool(sb, restaurantId, name, (block.input as Record<string, unknown>) || {})
        } catch (e) {
          out = { error: (e as Error).message }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: String(block.id),
          content: JSON.stringify(out).slice(0, 12000),
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }
    return NextResponse.json({ reply: 'That question needed too many lookups — try narrowing the date range or the item name.' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
