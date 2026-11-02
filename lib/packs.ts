import type { SupabaseClient } from '@supabase/supabase-js'
import { toBase, type BaseKind } from './recipes'

/*
 * Product pack sizes (sql/022): what ONE purchased unit of a specific
 * product from a specific store really contains.
 *
 * The same ingredient comes in different packs per store:
 *   Restaurant Depot cornstarch: 1 case = 24 x 16 oz  (24 lb)
 *   Costco cornstarch:           1 case = 30 x 12 oz  (22.5 lb)
 *   Cilantro:                    1 case = 20 x 200 g  (8.8 lb)
 *   Yogurt:                      1 case = 4 x 1 lb    (4 lb)
 * so a pack belongs to (store, product name), not to the ingredient.
 * Every purchase is broken down to one scale per ingredient: pounds
 * for weight, gallons for liquids, count for countables.
 */

export interface ProductPack {
  /** Inner packs in one purchased unit (24 bags in a case). */
  packCount: number
  /** Size of one inner pack (16)… */
  packSize: number
  /** …in this unit: lb, oz, g, kg, gal, floz, ml, l or each. */
  packUnit: string
}

export const PACK_UNITS = ['lb', 'oz', 'g', 'kg', 'gal', 'floz', 'l', 'ml', 'each'] as const

/** Same normalization as the SQL side: lower-case, trimmed, single spaces. */
export function normKey(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function packKey(vendor: string | null | undefined, itemName: string | null | undefined): string {
  return `${normKey(vendor)}|${normKey(itemName)}`
}

/** Base quantity (g / ml / each) of one purchased unit with this pack. */
export function packBase(p: ProductPack): { base: number; kind: BaseKind } | null {
  if (!(p.packCount > 0) || !(p.packSize > 0)) return null
  return toBase(p.packCount * p.packSize, p.packUnit)
}

/** How many purchased units an invoice line is (cases, eaches, or pounds). */
export function lineCount(line: {
  purchase_unit?: string | null
  unit_qty: number | null
  case_qty: number | null
}): number {
  const c = Number(line.case_qty ?? 0)
  const u = Number(line.unit_qty ?? 0)
  if ((line.purchase_unit ?? '').toLowerCase() === 'case') return c > 0 ? c : u
  return u > 0 ? u : c
}

/**
 * Base quantity bought on one invoice line using its product pack, or
 * lines sold by weight. null = needs the ingredient-level fallback.
 */
export function lineBaseFromPack(
  line: { purchase_unit?: string | null; unit_qty: number | null; case_qty: number | null },
  pack: ProductPack | undefined
): { base: number; kind: BaseKind } | null {
  const units = lineCount(line)
  if (!(units > 0)) return null
  if (pack) {
    const one = packBase(pack)
    if (one) return { base: units * one.base, kind: one.kind }
  }
  // Sold by weight: the quantity already is pounds.
  if ((line.purchase_unit ?? '').toLowerCase() === 'lb' && Number(line.unit_qty ?? 0) > 0) {
    return toBase(Number(line.unit_qty), 'lb')
  }
  return null
}

const UNIT_WORDS: Record<string, string> = {
  lb: 'lb', lbs: 'lb', '#': 'lb', oz: 'oz', z: 'oz', g: 'g', gr: 'g', gm: 'g', kg: 'kg',
  gal: 'gal', ga: 'gal', floz: 'floz', 'fl oz': 'floz', l: 'l', lt: 'l', ltr: 'l', ml: 'ml',
  ct: 'each', cnt: 'each', pc: 'each', pcs: 'each', ea: 'each', each: 'each',
}
const UNIT_RX = '(fl\\s?oz|lbs?|oz|kg|gal|ga|ltr|lt|ml|gm|gr|g|l|ct|cnt|pcs?|ea|each|z|#)'

/**
 * Reads a pack size from a product name when the store prints one:
 * "CORNSTARCH 24/16OZ", "YOGURT 4/1 LB", "CHKN BRST 40LB", "12 x 32 oz",
 * "CILANTRO 20CT". A suggestion for the owner to confirm, never applied
 * silently.
 */
export function suggestPack(itemName: string | null | undefined): ProductPack | null {
  const s = (itemName ?? '').toLowerCase()
  const unit = (u: string) => UNIT_WORDS[u.replace(/\s+/g, ' ').trim()] ?? UNIT_WORDS[u.replace(/\s+/g, '')]
  let m = s.match(new RegExp(`(\\d+)\\s*[/x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT_RX}\\b`))
  if (m && unit(m[3])) return { packCount: Number(m[1]), packSize: Number(m[2]), packUnit: unit(m[3]) }
  m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT_RX}(?![a-z])`))
  if (m && unit(m[2]) && Number(m[1]) > 0) return { packCount: 1, packSize: Number(m[1]), packUnit: unit(m[2]) }
  return null
}

/** Display unit for a base kind: pounds, gallons, count. */
export function scaleUnit(kind: BaseKind): string {
  return kind === 'g' ? 'lb' : kind === 'ml' ? 'gal' : 'ct'
}

/** Base quantity expressed on the display scale (lb / gal / ct). */
export function toScale(base: number, kind: BaseKind): number {
  return kind === 'g' ? base / 453.592 : kind === 'ml' ? base / 3785.41 : base
}

/**
 * Product packs for a restaurant keyed by packKey(vendor, item_name).
 * `missing` = sql/022 not applied yet.
 */
export async function fetchProductPacks(
  sb: SupabaseClient,
  restaurantId: string
): Promise<{ packs: Map<string, ProductPack>; missing: boolean }> {
  const packs = new Map<string, ProductPack>()
  const { data, error } = await sb
    .from('product_packs')
    .select('vendor_key, item_key, pack_count, pack_size, pack_unit')
    .eq('restaurant_id', restaurantId)
  if (error) return { packs, missing: true }
  for (const r of (data ?? []) as { vendor_key: string; item_key: string; pack_count: number; pack_size: number; pack_unit: string }[]) {
    packs.set(`${r.vendor_key}|${r.item_key}`, {
      packCount: Number(r.pack_count),
      packSize: Number(r.pack_size),
      packUnit: r.pack_unit,
    })
  }
  return { packs, missing: false }
}
