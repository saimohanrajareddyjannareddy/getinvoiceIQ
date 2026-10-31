import type { SupabaseClient } from '@supabase/supabase-js'

export type PriceAlert = {
  item_name: string
  display_name: string
  category: string
  vendor: string
  previous: number
  current: number
  /** Signed percent change from the previous purchase to the latest. */
  change: number
  unit: string
  /** invoice_date of the latest purchase. */
  date: string
}

// Price-move alerts: the same math as the Price Tracker page (latest
// unit price vs the previous purchase, grouped by raw item name),
// joined with the vendor + date of the latest invoice and filtered
// to moves at or beyond the threshold. An item needs at least two
// purchases before it can alert.
export async function fetchPriceAlerts(
  supabase: SupabaseClient,
  restaurantId: string,
  minChangePct = 5
): Promise<PriceAlert[]> {
  const { data } = await supabase
    .from('invoice_lines')
    .select(
      'item_name, display_name, category, unit_price, unit_qty, case_qty, invoice_headers!header_id(invoice_date, vendor, review_status)'
    )
    .eq('restaurant_id', restaurantId)
    .not('unit_price', 'is', null)
    .gt('unit_price', 0)
    .gt('total', 0)
  if (!data) return []

  type Entry = {
    invoice_date: string
    unit_price: number
    unit_qty: number
    case_qty: number
    vendor: string
  }
  const map: Record<string, { display_name: string; category: string; prices: Entry[] }> = {}
  data.forEach((l: any) => {
    if (!l.item_name || !l.unit_price) return
    // Skip invoices still in Review — same approved-only rule as
    // Home/Invoices (an unapproved parse must not fire a price alert).
    if (l.invoice_headers?.review_status === 'needs_review') return
    const date = l.invoice_headers?.invoice_date
    if (!date) return
    if (!map[l.item_name]) {
      map[l.item_name] = {
        display_name: l.display_name || l.item_name,
        category: l.category || 'Other',
        prices: [],
      }
    }
    map[l.item_name].prices.push({
      invoice_date: date,
      unit_price: l.unit_price,
      unit_qty: l.unit_qty ?? 0,
      case_qty: l.case_qty ?? 0,
      vendor: l.invoice_headers?.vendor || '',
    })
  })

  return Object.entries(map)
    .filter(([, v]) => v.prices.length >= 2)
    .map(([item_name, { display_name, category, prices }]) => {
      const sorted = [...prices].sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))
      const last = sorted[sorted.length - 1]
      const prev = sorted[sorted.length - 2]
      const change = ((last.unit_price - prev.unit_price) / prev.unit_price) * 100
      const unit =
        (last.unit_qty ?? 0) > 1 ? '/lb' : (last.case_qty ?? 0) > 0 ? '/case' : '/unit'
      return {
        item_name,
        display_name,
        category,
        vendor: last.vendor,
        previous: prev.unit_price,
        current: last.unit_price,
        change,
        unit,
        date: last.invoice_date,
      }
    })
    .filter((a) => Math.abs(a.change) >= minChangePct)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}
