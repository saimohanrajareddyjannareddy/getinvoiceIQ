import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Food cost % counts FOOD (and drink) purchases only. Supplies that
 * are bought from the same vendors but never reach a plate — gloves,
 * containers, bags, soap — are left out, as restaurant accounting
 * usually does. Categories come from invoice_lines.category
 * (lib/parse-invoice.ts).
 */
export const NON_FOOD_CATEGORIES = ['Cleaning', 'Packaging'] as const

export function isNonFood(category: string | null | undefined): boolean {
  return !!category && (NON_FOOD_CATEGORIES as readonly string[]).includes(category)
}

/**
 * Non-food spend per invoice header, to subtract from header totals.
 * Header totals stay the base (they include tax/fees that line items
 * may not), so only the supplies are taken out.
 */
export async function nonFoodByHeader(
  sb: SupabaseClient,
  headerIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < headerIds.length; i += 200) {
    const chunk = headerIds.slice(i, i + 200)
    const { data } = await sb
      .from('invoice_lines')
      .select('header_id, total, category')
      .in('header_id', chunk)
      .in('category', [...NON_FOOD_CATEGORIES])
    for (const l of (data ?? []) as { header_id: string; total: number | null; category: string | null }[]) {
      if (!isNonFood(l.category)) continue
      out.set(l.header_id, (out.get(l.header_id) ?? 0) + (l.total || 0))
    }
  }
  return out
}
