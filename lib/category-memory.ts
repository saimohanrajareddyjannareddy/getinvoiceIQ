import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedInvoice } from './parse-invoice'

/*
 * Per-supplier category memory, shared by every intake path.
 *
 * What this restaurant's past approved invoices from the same
 * supplier called each item is the ground truth: repeat items
 * inherit their remembered category, so nobody hand-writes
 * per-supplier rules, and every correction the owner saves teaches
 * the next invoice. This logic originally lived only in the upload
 * page, which meant email-scan and WhatsApp imports never learned
 * from past approvals (open fix #3, 2026-10-29) — it lives here now
 * so all three paths share one implementation.
 */

/* Comparison key for supplier/item names: case/whitespace-insensitive. */
export function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/*
 * Build the memory from the 60 most recent approved invoices:
 * key `${normKey(vendor)}|${normKey(item_name)}` → category, most
 * recent invoice wins. 'Other' and unreadable suppliers teach
 * nothing and are skipped. Fails soft: any query error returns
 * whatever was built (possibly an empty map) — memory is an
 * enhancement, never a reason to block an import.
 */
export async function loadCategoryMemory(
  sb: SupabaseClient,
  restaurantId: string
): Promise<Map<string, string>> {
  const mem = new Map<string, string>()
  try {
    const { data: recent } = await sb
      .from('invoice_headers')
      .select('id, vendor')
      .eq('restaurant_id', restaurantId)
      .neq('review_status', 'needs_review')
      .order('invoice_date', { ascending: false })
      .limit(60)
    if (!recent || recent.length === 0) return mem
    const vendorById = new Map(recent.map((h: any) => [h.id, h.vendor || '']))
    const rank = new Map(recent.map((h: any, i: number) => [h.id, i]))
    const { data: lines } = await sb
      .from('invoice_lines')
      .select('header_id, item_name, category')
      .in('header_id', recent.map((h: any) => h.id))
    const ordered = [...(lines || [])].sort(
      (a: any, b: any) => (rank.get(a.header_id) ?? 0) - (rank.get(b.header_id) ?? 0)
    )
    for (const l of ordered) {
      if (!l.category || l.category === 'Other') continue
      const v = normKey(vendorById.get(l.header_id) || '')
      if (!v || v === 'unknown') continue
      const key = `${v}|${normKey(l.item_name || '')}`
      if (!mem.has(key)) mem.set(key, l.category)
    }
  } catch {
    // Memory is best-effort; an empty/partial map just means the
    // parser's own categories stand.
  }
  return mem
}

/*
 * Apply the memory to a fresh parse: any item this supplier has
 * sold this restaurant before inherits the category it was saved
 * with last time (looked up by raw item name, then display name).
 * Returns the input unchanged when nothing applies.
 */
export function applyCategoryMemory(
  p: ParsedInvoice,
  mem: Map<string, string>
): ParsedInvoice {
  if (mem.size === 0) return p
  const vKey = normKey(p.vendor || '')
  if (!vKey || vKey === 'unknown') return p
  let changed = false
  const items = p.items.map((it) => {
    const remembered =
      mem.get(`${vKey}|${normKey(it.item_name || '')}`) ||
      mem.get(`${vKey}|${normKey(it.display_name || '')}`)
    if (remembered && remembered !== 'Other' && remembered !== it.category) {
      changed = true
      return { ...it, category: remembered }
    }
    return it
  })
  return changed ? { ...p, items } : p
}
