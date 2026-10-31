'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

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
