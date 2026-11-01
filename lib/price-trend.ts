import { SERIES } from '@/lib/chart-theme'

/**
 * getinvoiceIQ — price trend derivation, shared by the Price
 * Tracker page (full size) and the Home dashboard (mini card).
 *
 * Trailing 6 weeks anchored on the NEWEST purchase in the data,
 * so the window always holds the restaurant's latest activity.
 * An item's weekly point is its LAST unit price that week — the
 * going rate at week's end; weeks with no purchase stay gaps
 * (null), never invented values. Up to three items with at least
 * two weekly points, most-covered first; the biggest mover gets
 * the first series color (pop) and the callout.
 */

export type TrendPricePoint = { invoice_date: string; unit_price: number }

export type TrendItem = {
  item_name: string
  display_name: string
  unit: string
  prices: TrendPricePoint[]
}

export type TrendSeries = {
  item: TrendItem
  color: string
  points: (number | null)[]
  first: number
  last: number
  pct: number
}

export type PriceTrend = {
  rows: Record<string, string | number | null>[]
  series: TrendSeries[]
  mover: TrendSeries
}

export function buildPriceTrend(items: TrendItem[]): PriceTrend | null {
  if (items.length === 0) return null
  const DAY = 86400000
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  let anchor = 0
  items.forEach(i => i.prices.forEach(p => {
    const t = parse(p.invoice_date)
    if (t > anchor) anchor = t
  }))
  if (anchor === 0) return null
  const start = anchor - 41 * DAY
  const buckets = Array.from({ length: 6 }, (_, w) => {
    const from = start + w * 7 * DAY
    return {
      from,
      label: new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  })
  const candidates: TrendSeries[] = []
  items.forEach(item => {
    const points: (number | null)[] = Array(6).fill(null)
    item.prices.forEach(p => {
      const idx = Math.floor((parse(p.invoice_date) - start) / (7 * DAY))
      if (idx >= 0 && idx < 6) points[idx] = p.unit_price
    })
    const present = points.filter((v): v is number => v !== null)
    if (present.length < 2) return
    const first = present[0]
    const last = present[present.length - 1]
    candidates.push({ item, color: '', points, first, last, pct: ((last - first) / first) * 100 })
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) =>
    b.points.filter(v => v !== null).length - a.points.filter(v => v !== null).length ||
    Math.abs(b.pct) - Math.abs(a.pct))
  const top = candidates.slice(0, 3)
  ;[...top]
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .forEach((s, i) => { s.color = SERIES[i] })
  const rows = buckets.map((b, w) => {
    const row: Record<string, string | number | null> = { label: b.label }
    top.forEach(s => { row[s.item.item_name] = s.points[w] })
    return row
  })
  const mover = [...top].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0]
  return { rows, series: top, mover }
}
