import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Recipe costing data layer (stage 1 of the recipe engine).
 *
 * Dishes come from pos_sales (what the POS sold), recipes live in
 * recipes_estimated (AI drafts the owner confirms), and ingredient
 * costs come from the restaurant's latest approved invoice lines
 * resolved to canonical items.
 *
 * Unit math mirrors sql/008's to_base_unit(): everything normalizes
 * to grams / ml / each, and a purchased line's quantity is its
 * unit_qty expressed in the canonical item's default_unit — the
 * same formula usage_variance() uses, so plate costs and the
 * variance page can never disagree. Case purchases store their
 * count in case_qty with unit_qty = 0; they price once the
 * restaurant sets a pack size (ingredient_settings, sql/020).
 * Plate costs also divide by the usable-yield % from that table.
 */

export interface DishSales {
  menuItemName: string
  soldQty: number
  revenue: number
  avgPrice: number
}

export interface RecipeLine {
  ingredient_name: string
  quantity: number
  unit: string
  confidence: string
}

export interface CanonicalItem {
  id: string
  name: string
  category: string | null
  default_unit: string | null
}

export interface IngredientCost {
  /** PURCHASE cost per base unit (g / ml / each); null when unpriced. */
  costPerBase: number | null
  baseKind: BaseKind | null
  /** Usable share after trim / peel loss, 1–100. Missing = 100. */
  yieldPct?: number
}

/**
 * Cost per USABLE base unit: what a recipe gram actually costs once
 * trim loss is paid for. Recipes are written in usable quantities, so
 * plate costs use this; purchase-side math (variance $) uses
 * costPerBase.
 */
export function usableCostPerBase(c: IngredientCost | undefined): number | null {
  if (!c || c.costPerBase == null) return null
  const y = c.yieldPct && c.yieldPct > 0 ? Math.min(c.yieldPct, 100) : 100
  return c.costPerBase / (y / 100)
}

export interface IngredientSetting {
  /** Units of the item's default_unit in one case; null = not set. */
  packQty: number | null
  yieldPct: number
}

/**
 * Per-restaurant pack sizes and yields (sql/020), keyed by canonical
 * item id. `missing` is true when the table doesn't exist yet — the
 * page shows a setup notice and costing works as before.
 */
export async function fetchIngredientSettings(
  sb: SupabaseClient,
  restaurantId: string
): Promise<{ settings: Map<string, IngredientSetting>; missing: boolean }> {
  const settings = new Map<string, IngredientSetting>()
  const { data, error } = await sb
    .from('ingredient_settings')
    .select('canonical_item_id, pack_qty, yield_pct')
    .eq('restaurant_id', restaurantId)
  if (error) return { settings, missing: true }
  for (const r of (data ?? []) as { canonical_item_id: string; pack_qty: number | null; yield_pct: number | null }[]) {
    settings.set(r.canonical_item_id, {
      packQty: r.pack_qty != null ? Number(r.pack_qty) : null,
      yieldPct: r.yield_pct != null ? Number(r.yield_pct) : 100,
    })
  }
  return { settings, missing: false }
}

/** Units bought on one invoice line, or null when it can't be counted. */
export function purchasedQty(
  line: { unit_qty: number | null; case_qty: number | null },
  packQty: number | null | undefined
): number | null {
  const u = Number(line.unit_qty ?? 0)
  if (u > 0) return u
  const cases = Number(line.case_qty ?? 0)
  if (cases > 0 && packQty && packQty > 0) return cases * packQty
  return null
}

export type BaseKind = 'g' | 'ml' | 'each'

const MASS: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 }
const VOLUME: Record<string, number> = { ml: 1, floz: 29.5735, gal: 3785.41, l: 1000 }
const COUNT: Record<string, number> = { each: 1, ea: 1, ct: 1, count: 1 }

export function unitKind(unit: string | null | undefined): BaseKind | null {
  if (!unit) return null
  const u = unit.trim().toLowerCase()
  if (u in MASS) return 'g'
  if (u in VOLUME) return 'ml'
  if (u in COUNT) return 'each'
  return null
}

/** Quantity expressed in base units, or null when the unit is unknown. */
export function toBase(
  qty: number,
  unit: string | null | undefined
): { base: number; kind: BaseKind } | null {
  if (!unit) return null
  const u = unit.trim().toLowerCase()
  if (u in MASS) return { base: qty * MASS[u], kind: 'g' }
  if (u in VOLUME) return { base: qty * VOLUME[u], kind: 'ml' }
  if (u in COUNT) return { base: qty * COUNT[u], kind: 'each' }
  return null
}

export const RECIPE_UNITS = ['oz', 'lb', 'each', 'floz', 'g'] as const

export async function fetchDishSales(
  sb: SupabaseClient,
  restaurantId: string,
  days = 30
): Promise<DishSales[]> {
  const since = new Date(Date.now() - (days - 1) * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
  const { data } = await sb
    .from('pos_sales')
    .select('item_name, quantity, revenue')
    .eq('restaurant_id', restaurantId)
    .gte('sale_date', since)
  const map = new Map<string, DishSales>()
  for (const r of (data ?? []) as { item_name: string; quantity: number; revenue: number }[]) {
    const cur =
      map.get(r.item_name) ??
      { menuItemName: r.item_name, soldQty: 0, revenue: 0, avgPrice: 0 }
    cur.soldQty += r.quantity || 0
    cur.revenue += r.revenue || 0
    map.set(r.item_name, cur)
  }
  for (const d of map.values()) {
    d.avgPrice = d.soldQty > 0 ? d.revenue / d.soldQty : 0
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue)
}

export async function fetchRecipes(
  sb: SupabaseClient,
  restaurantId: string
): Promise<Map<string, RecipeLine[]>> {
  const { data } = await sb
    .from('recipes_estimated')
    .select('menu_item_name, ingredient_name, quantity, unit, confidence')
    .eq('restaurant_id', restaurantId)
  const map = new Map<string, RecipeLine[]>()
  for (const r of (data ?? []) as (RecipeLine & { menu_item_name: string })[]) {
    const arr = map.get(r.menu_item_name) ?? []
    arr.push({
      ingredient_name: r.ingredient_name,
      quantity: Number(r.quantity),
      unit: r.unit,
      confidence: r.confidence,
    })
    map.set(r.menu_item_name, arr)
  }
  return map
}

export async function fetchCanonicalItems(
  sb: SupabaseClient
): Promise<CanonicalItem[]> {
  const { data } = await sb
    .from('canonical_items')
    .select('id, name, category, default_unit')
    .order('name')
  return (data ?? []) as CanonicalItem[]
}

/**
 * Latest cost per canonical ingredient, from approved invoice lines.
 * "Latest" = the most recent invoice (by invoice_date) that priced
 * the item with a usable quantity.
 */
export async function fetchIngredientCosts(
  sb: SupabaseClient,
  restaurantId: string,
  canonical: CanonicalItem[],
  settings: Map<string, IngredientSetting> = new Map(),
  /** Filled with names whose newest purchases are by the case with no pack size. */
  needsPack?: Set<string>
): Promise<Map<string, IngredientCost>> {
  const costs = new Map<string, IngredientCost>()
  const byId = new Map(canonical.map((c) => [c.id, c]))

  const { data: headers } = await sb
    .from('invoice_headers')
    .select('id, invoice_date, review_status')
    .eq('restaurant_id', restaurantId)
    .order('invoice_date', { ascending: false })
    .limit(80)
  const approved = ((headers ?? []) as { id: string; invoice_date: string; review_status?: string | null }[])
    .filter((h) => h.review_status !== 'needs_review')
  if (approved.length === 0) return costs
  const dateByHeader = new Map(approved.map((h) => [h.id, h.invoice_date]))

  const { data: lines } = await sb
    .from('invoice_lines')
    .select('canonical_item_id, unit_qty, case_qty, total, header_id')
    .in('header_id', approved.map((h) => h.id))
    .not('canonical_item_id', 'is', null)

  type Line = {
    canonical_item_id: string
    unit_qty: number | null
    case_qty: number | null
    total: number | null
    header_id: string
  }
  const sorted = ((lines ?? []) as Line[]).sort((a, b) =>
    (dateByHeader.get(b.header_id) ?? '').localeCompare(dateByHeader.get(a.header_id) ?? '')
  )
  for (const l of sorted) {
    const item = byId.get(l.canonical_item_id)
    if (!item || costs.has(item.name)) continue
    if (!l.total || l.total <= 0) continue
    const setting = settings.get(item.id)
    const qty = purchasedQty(l, setting?.packQty)
    if (qty == null) {
      if (Number(l.case_qty ?? 0) > 0) needsPack?.add(item.name)
      continue
    }
    const base = toBase(qty, item.default_unit)
    if (!base || base.base <= 0) continue
    costs.set(item.name, {
      costPerBase: l.total / base.base,
      baseKind: base.kind,
      yieldPct: setting?.yieldPct ?? 100,
    })
  }
  // An item priced from an older unit purchase no longer needs asking.
  if (needsPack) for (const name of [...needsPack]) if (costs.has(name)) needsPack.delete(name)
  return costs
}

export interface RecipeMeta {
  kind: 'component'
  yieldQty: number
  yieldUnit: string
}

/**
 * Component (sub-recipe) definitions from recipe_meta (sql/018).
 * Returns an empty map when the table doesn't exist yet — costing
 * then simply treats component names as unpriced ingredients.
 */
export async function fetchRecipeMeta(
  sb: SupabaseClient,
  restaurantId: string
): Promise<Map<string, RecipeMeta>> {
  const map = new Map<string, RecipeMeta>()
  const { data, error } = await sb
    .from('recipe_meta')
    .select('recipe_name, yield_qty, yield_unit')
    .eq('restaurant_id', restaurantId)
  if (error) return map
  for (const r of (data ?? []) as { recipe_name: string; yield_qty: number; yield_unit: string }[]) {
    map.set(r.recipe_name, {
      kind: 'component',
      yieldQty: Number(r.yield_qty),
      yieldUnit: r.yield_unit,
    })
  }
  return map
}

/**
 * Fill component prices into the cost map: a component's cost per
 * base unit = its batch cost (its own recipe lines, costed the same
 * way, recursively up to depth 3) ÷ its batch yield. A component
 * with any unpriced ingredient stays unpriced — an honest gap beats
 * an understated cost. Purchase prices always win over component
 * prices for the same name.
 */
export function mergeComponentCosts(
  recipes: Map<string, RecipeLine[]>,
  meta: Map<string, RecipeMeta>,
  purchaseCosts: Map<string, IngredientCost>
): Map<string, IngredientCost> {
  const merged = new Map(purchaseCosts)
  const memo = new Map<string, IngredientCost | null>()

  function componentCost(
    name: string,
    depth: number,
    visiting: Set<string>
  ): IngredientCost | null {
    if (memo.has(name)) return memo.get(name) ?? null
    if (depth > 3 || visiting.has(name)) return null
    const m = meta.get(name)
    const lines = recipes.get(name)
    if (!m || !lines || lines.length === 0) return null
    visiting.add(name)
    let total = 0
    for (const line of lines) {
      const base = toBase(line.quantity, line.unit)
      if (!base) {
        visiting.delete(name)
        memo.set(name, null)
        return null
      }
      const direct = purchaseCosts.get(line.ingredient_name)
      const directUsable = usableCostPerBase(direct)
      if (directUsable != null && direct?.baseKind === base.kind) {
        total += base.base * directUsable
        continue
      }
      const sub = componentCost(line.ingredient_name, depth + 1, visiting)
      if (!sub || sub.costPerBase == null || sub.baseKind !== base.kind) {
        visiting.delete(name)
        memo.set(name, null)
        return null
      }
      total += base.base * sub.costPerBase
    }
    visiting.delete(name)
    const yb = toBase(m.yieldQty, m.yieldUnit)
    if (!yb || yb.base <= 0) {
      memo.set(name, null)
      return null
    }
    const out: IngredientCost = { costPerBase: total / yb.base, baseKind: yb.kind }
    memo.set(name, out)
    return out
  }

  for (const name of meta.keys()) {
    if (merged.has(name)) continue
    const c = componentCost(name, 0, new Set())
    if (c) merged.set(name, c)
  }
  return merged
}

export interface CalibrationHint {
  ingredient: string
  factor: number
  theoreticalBase: number
  actualBase: number
  variancePct: number
}

/**
 * Back-solve signal: where purchases diverge from recipe-implied
 * usage by ≥25%, the recipes are probably wrong (portions bigger
 * or smaller than written) — factor = actual ÷ theoretical is the
 * multiplier that would align them. Purchases ≠ usage (stock
 * changes, waste), so a hint is a proposal, never an auto-edit.
 */
export function calibrationHints(rows: VarianceRow[], minAbsPct = 25): CalibrationHint[] {
  return rows
    .filter(
      (r) =>
        r.theoreticalBase > 0 &&
        r.actualBase > 0 &&
        r.variancePct != null &&
        Math.abs(r.variancePct) >= minAbsPct
    )
    .map((r) => ({
      ingredient: r.ingredient,
      factor: r.actualBase / r.theoreticalBase,
      theoreticalBase: r.theoreticalBase,
      actualBase: r.actualBase,
      variancePct: r.variancePct as number,
    }))
    .filter((h) => h.factor >= 0.25 && h.factor <= 4)
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
}

/** Plate cost for one recipe; lists ingredients that couldn't be priced. */
export function plateCost(
  lines: RecipeLine[],
  costs: Map<string, IngredientCost>
): { total: number; missing: string[] } {
  let total = 0
  const missing: string[] = []
  for (const line of lines) {
    const base = toBase(line.quantity, line.unit)
    const cost = costs.get(line.ingredient_name)
    const usable = usableCostPerBase(cost)
    if (!base || !cost || usable == null || cost.baseKind !== base.kind) {
      missing.push(line.ingredient_name)
      continue
    }
    total += base.base * usable
  }
  return { total, missing }
}

export function recipeStatus(lines: RecipeLine[] | undefined): 'none' | 'ai' | 'confirmed' {
  if (!lines || lines.length === 0) return 'none'
  return lines.some((l) => l.confidence === 'user_confirmed') ? 'confirmed' : 'ai'
}

export interface VarianceRow {
  ingredient: string
  theoreticalBase: number
  actualBase: number
  variancePct: number | null
  notes: string | null
}

/**
 * Theoretical-vs-actual usage from the usage_variance() SQL
 * function (sql/008 — must be run in the Supabase editor; until
 * then this returns an error the page turns into a setup notice).
 * Quantities are base units (g / ml / each) — display converts
 * back to each ingredient's usual purchase unit.
 */
export async function fetchUsageVariance(
  sb: SupabaseClient,
  restaurantId: string,
  start: string,
  end: string
): Promise<{ rows: VarianceRow[]; error: string | null }> {
  const { data, error } = await sb.rpc('usage_variance', {
    p_restaurant_id: restaurantId,
    p_start: start,
    p_end: end,
  })
  if (error) return { rows: [], error: error.message }
  const rows = ((data ?? []) as {
    ingredient: string
    theoretical_base: number
    actual_base: number
    variance_pct: number | null
    notes: string | null
  }[]).map((r) => ({
    ingredient: r.ingredient,
    theoreticalBase: Number(r.theoretical_base),
    actualBase: Number(r.actual_base),
    variancePct: r.variance_pct == null ? null : Number(r.variance_pct),
    notes: r.notes,
  }))
  return { rows, error: null }
}

/** Base qty → a friendly value in the ingredient's purchase unit. */
export function formatBaseQty(
  baseQty: number,
  defaultUnit: string | null | undefined
): string {
  const conv = defaultUnit ? toBase(1, defaultUnit) : null
  if (conv && conv.base > 0) {
    const v = baseQty / conv.base
    const rounded = v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100
    return `${rounded.toLocaleString('en-US')} ${defaultUnit!.toLowerCase()}`
  }
  if (baseQty >= 1000) return `${(baseQty / 1000).toFixed(1)}k units`
  return `${Math.round(baseQty * 10) / 10} units`
}
