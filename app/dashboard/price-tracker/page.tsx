'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { SERIES, GRID, TICK, tooltipStyle, CURSOR } from '@/lib/chart-theme'

type PriceEntry = { invoice_date: string; unit_price: number; unit_qty: number; case_qty: number }
type TrackedItem = { item_name: string; display_name: string; category: string; prices: PriceEntry[]; current: number; previous: number; change: number; unit: string }

export default function PriceTrackerPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [items, setItems] = useState<TrackedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all')

  useEffect(() => {
    if (!restaurantId) return
    supabase.from('invoice_lines')
      .select('item_name, display_name, category, unit_price, unit_qty, case_qty, invoice_headers!header_id(invoice_date, review_status)')
      .eq('restaurant_id', restaurantId)
      .not('unit_price', 'is', null)
      .gt('unit_price', 0)
      .gt('total', 0)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, { display_name: string; category: string; prices: PriceEntry[] }> = {}
        data.forEach((l: any) => {
          if (!l.item_name || !l.unit_price) return
          // Skip invoices still in Review — same approved-only rule as
          // Home/Invoices (unapproved prices must not move the tracker).
          if (l.invoice_headers?.review_status === 'needs_review') return
          const date = l.invoice_headers?.invoice_date
          if (!date) return
          if (!map[l.item_name]) map[l.item_name] = { display_name: l.display_name || l.item_name, category: l.category || 'Other', prices: [] }
          map[l.item_name].prices.push({ invoice_date: date, unit_price: l.unit_price, unit_qty: l.unit_qty ?? 0, case_qty: l.case_qty ?? 0 })
        })

        const tracked: TrackedItem[] = Object.entries(map)
          .filter(([, v]) => v.prices.length >= 2)
          .map(([item_name, { display_name, category, prices }]) => {
            const sorted = prices.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))
            const current = sorted[sorted.length - 1].unit_price
            const previous = sorted[sorted.length - 2].unit_price
            const change = ((current - previous) / previous) * 100
            const last = sorted[sorted.length - 1]
            const unit = (last.unit_qty ?? 0) > 1 ? '/lb' : (last.case_qty ?? 0) > 0 ? '/case' : '/unit'
            return { item_name, display_name, category, prices: sorted, current, previous, change, unit }
          })
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

        setItems(tracked)
        setLoading(false)
      })
  }, [restaurantId])

  const filtered = items.filter(i => {
    if (filter === 'up') return i.change > 0
    if (filter === 'down') return i.change < 0
    return true
  })

  // ── Price trend graph ──────────────────────────────────────────
  // The homepage mock promises this chart; here it is with real
  // data. Trailing 6 weeks anchored on the newest purchase in the
  // data, so the window always holds the restaurant's latest
  // activity. An item's weekly point is its LAST unit price that
  // week — the going rate at week's end; weeks with no purchase
  // stay gaps, never invented values. Up to three items with at
  // least two weekly points; the biggest mover wears pop, like
  // the mock, and gets the callout chip.
  const trend = useMemo(() => {
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
    const start = anchor - 41 * DAY
    const buckets = Array.from({ length: 6 }, (_, w) => {
      const from = start + w * 7 * DAY
      return {
        from,
        label: new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }
    })
    type SeriesT = { item: TrackedItem; color: string; points: (number | null)[]; first: number; last: number; pct: number }
    const candidates: SeriesT[] = []
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
  }, [items])

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Price Tracker</h1>
      <p className="text-ink-muted text-sm mb-6">Track unit price changes across invoices for each item.</p>

      <div className="flex gap-2 mb-6">
        {([['all', 'All Items'], ['up', '↑ Price Increases'], ['down', '↓ Price Decreases']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${filter === val ? 'bg-ink text-cream' : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'}`}>
            {label}
          </button>
        ))}
      </div>

      {!loading && trend && (
        <div className="mb-6 rounded-[14px] border border-ink/[0.08] bg-cream-surface p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-[22px] text-ink">Price trend</h2>
              <p className="mt-1 text-[13px] text-ink-muted">Unit price · trailing 6 weeks · last purchase each week</p>
            </div>
            {/* Biggest-mover callout, styled after the homepage mock. */}
            <div className="rounded-[10px] bg-ink px-[13px] py-[10px] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.55)]">
              <div className="font-mono text-[13px] font-semibold text-[#F9A8D4]">
                {trend.mover.item.display_name} {trend.mover.pct >= 0 ? '↑' : '↓'} {Math.abs(trend.mover.pct).toFixed(1)}% in 6 weeks
              </div>
              <div className="mt-[3px] text-[11px] text-[#C7C0B4]">
                ${trend.mover.first.toFixed(2)} → ${trend.mover.last.toFixed(2)} {trend.mover.item.unit}
              </div>
            </div>
          </div>
          <div className="h-[260px] min-h-[260px] w-full" style={{ height: 260, maxHeight: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                <YAxis tick={TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${Number(v.toFixed(2))}`} />
                <Tooltip contentStyle={tooltipStyle} cursor={CURSOR}
                  formatter={(v, name) => {
                    const s = trend.series.find(x => x.item.item_name === name)
                    return [`$${Number(v).toFixed(2)}${s ? ` ${s.item.unit}` : ''}`, s ? s.item.display_name : String(name)]
                  }} />
                {trend.series.map(s => (
                  <Line key={s.item.item_name} type="monotone" dataKey={s.item.item_name}
                    stroke={s.color} strokeWidth={2.5} dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                    connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {trend.series.map(s => (
              <span key={s.item.item_name} className="inline-flex items-center gap-[7px] font-mono text-[11px] text-ink-3">
                <span className="h-[3px] w-[10px] rounded-[2px]" style={{ background: s.color }} />
                {s.item.display_name} <span className="text-ink-muted">{s.item.unit}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
        <div className="hidden md:block overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full text-sm">
          <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
            <tr className="text-ink-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Item</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">Previous</th>
              <th className="text-right px-4 py-3">Current</th>
              <th className="text-right px-4 py-3">Unit</th>
              <th className="text-right px-4 py-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-ink-muted">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-ink-muted">No price data available.</td></tr>
            ) : filtered.map(item => (
              <tr key={item.item_name} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt">
                <td className="px-4 py-3 font-medium text-ink">{item.display_name}</td>
                <td className="px-4 py-3">
                  <span className="bg-pop/10 text-pop text-xs px-2 py-0.5 rounded-full">{item.category}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink-3">${item.previous.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-ink">${item.current.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-ink-muted text-xs">{item.unit}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`flex items-center justify-end gap-1 font-semibold ${item.change > 0 ? 'text-red-500' : item.change < 0 ? 'text-green-500' : 'text-ink-muted'}`}>
                    {item.change > 0 ? <TrendingUp size={14} /> : item.change < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
                    {item.change > 0 ? '+' : ''}{item.change.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Mobile: one card per item, change up front */}
        <div className="divide-y divide-ink/[0.06] md:hidden">
          {loading ? (
            <div className="py-8 text-center text-sm text-ink-muted">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-muted">No price data available.</div>
          ) : filtered.map(item => (
            <div key={item.item_name} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{item.display_name}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                  <span className="bg-pop/10 text-pop px-2 py-0.5 rounded-full">{item.category}</span>
                  <span>${item.previous.toFixed(2)} → <span className="font-semibold text-ink">${item.current.toFixed(2)}</span> / {item.unit}</span>
                </div>
              </div>
              <span className={`flex shrink-0 items-center gap-1 text-[15px] font-bold ${item.change > 0 ? 'text-red-500' : item.change < 0 ? 'text-green-500' : 'text-ink-muted'}`}>
                {item.change > 0 ? <TrendingUp size={16} /> : item.change < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
                {item.change > 0 ? '+' : ''}{item.change.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
