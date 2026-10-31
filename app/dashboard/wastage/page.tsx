'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Link2, AlertTriangle } from 'lucide-react'

type CategoryRow = { category: string; purchased: number; sold: number | null }

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function WastagePage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [cloverConnected, setCloverConnected] = useState(false)
  const [range, setRange] = useState<'weekly' | 'monthly'>('monthly')
  const [data, setData] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPurchased, setTotalPurchased] = useState(0)
  const [totalSold, setTotalSold] = useState<number | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const now = new Date()
      let start: string, end: string
      if (range === 'weekly') {
        const s = new Date(now); s.setDate(now.getDate() - 7)
        start = localDate(s); end = localDate(now)
      } else {
        start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
        end = localDate(now)
      }

      const [linesRes, salesRes, headersRes] = await Promise.all([
        supabase.from('invoice_lines').select('category, total, header_id').eq('restaurant_id', restaurantId).gte('invoice_date', start).lte('invoice_date', end).gt('total', 0),
        supabase.from('pos_sales').select('category, revenue').eq('restaurant_id', restaurantId).gte('sale_date', start).lte('sale_date', end),
        // Purchased side counts only approved invoices — same rule as
        // Home/Invoices: headers still in Review (needs_review) excluded.
        supabase.from('invoice_headers').select('id, review_status').eq('restaurant_id', restaurantId).gte('invoice_date', start).lte('invoice_date', end),
      ])

      if (cancelled) return

      const hasSales = !salesRes.error && salesRes.data && salesRes.data.length > 0
      setCloverConnected(hasSales || false)

      const approvedIds = new Set(
        (headersRes.data || []).filter((h: any) => h.review_status !== 'needs_review').map((h: any) => h.id)
      )
      const purchaseMap: Record<string, number> = {}
      for (const l of linesRes.data || []) {
        if (!approvedIds.has((l as any).header_id)) continue
        const cat = l.category || 'Other'
        purchaseMap[cat] = (purchaseMap[cat] || 0) + (l.total || 0)
      }

      const salesMap: Record<string, number> = {}
      for (const s of salesRes.data || []) {
        const cat = s.category || 'Other'
        salesMap[cat] = (salesMap[cat] || 0) + (s.revenue || 0)
      }

      const cats = [...new Set([...Object.keys(purchaseMap), ...Object.keys(salesMap)])]
      const rows: CategoryRow[] = cats
        .map(cat => ({ category: cat, purchased: purchaseMap[cat] || 0, sold: hasSales ? (salesMap[cat] || 0) : null }))
        .sort((a, b) => b.purchased - a.purchased)

      setData(rows)
      setTotalPurchased(rows.reduce((s, r) => s + r.purchased, 0))
      setTotalSold(hasSales ? rows.reduce((s, r) => s + (r.sold || 0), 0) : null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId, range])

  const wasteEstimate = totalSold !== null ? totalPurchased - totalSold : null

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Wastage Tracker</h1>
          <p className="text-ink-muted text-sm">Compare what you purchased vs what you sold.</p>
        </div>
        <div className="flex gap-2">
          {(['weekly', 'monthly'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium capitalize transition ${range === r ? 'bg-ink text-cream' : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'}`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {!cloverConnected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3 mb-6">
          <Link2 size={18} className="text-pop mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-800 mb-1">Connect Clover POS to unlock full wastage tracking</div>
            <div className="text-sm text-amber-700 mb-3">
              Once connected, you&apos;ll see purchased vs sold side by side per category, and a waste % for each item.
            </div>
            <a href="/dashboard/settings"
              className="inline-block px-4 py-2 bg-pop text-white rounded-lg text-sm hover:bg-pop-hover transition">
              Go to Settings → Connect Clover
            </a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1">Total Purchased</div>
          <div className="font-display text-2xl font-extrabold text-ink">${totalPurchased.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1">Total Revenue (COGS)</div>
          <div className="font-display text-2xl font-extrabold text-ink">
            {totalSold !== null ? `$${totalSold.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-ink-muted">—</span>}
          </div>
        </div>
        <div className={`rounded-[14px] border p-5 ${wasteEstimate !== null && wasteEstimate > 0 ? 'bg-red-50 border-red-100' : 'bg-cream-surface border-ink/[0.08]'}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1 flex items-center gap-1">
            {wasteEstimate !== null && wasteEstimate > 0 && <AlertTriangle size={12} className="text-red-400" />}
            Estimated Waste
          </div>
          <div className={`font-display text-2xl font-extrabold ${wasteEstimate !== null && wasteEstimate > 0 ? 'text-red-600' : 'text-ink'}`}>
            {wasteEstimate !== null ? `$${wasteEstimate.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-ink-muted">—</span>}
          </div>
        </div>
      </div>

      {!loading && data.length > 0 && (
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5 mb-6">
          <h2 className="font-serif text-[20px] text-ink mb-4">Spend by Category</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data}>
              <XAxis dataKey="category" tick={{ fontSize: 11, fontFamily: 'var(--font-plex-mono)', fill: '#8A8377' }} tickLine={false} axisLine={{ stroke: 'rgba(26,23,19,0.1)' }} />
              <YAxis tick={{ fontSize: 11, fontFamily: 'var(--font-plex-mono)', fill: '#8A8377' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(v) => `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Legend />
              <Bar dataKey="purchased" name="Purchased" fill="#EC4899" radius={[4, 4, 0, 0]} />
              {cloverConnected && <Bar dataKey="sold" name="Sold (COGS)" fill="#171310" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
        <div className="px-5 py-3 border-b border-ink/[0.08] bg-cream-surface-alt">
          <h2 className="font-semibold text-ink-2 text-sm">Category Breakdown</h2>
        </div>
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b">
            <tr className="text-ink-muted text-xs uppercase tracking-wide">
              <th className="text-left px-5 py-3">Category</th>
              <th className="text-right px-5 py-3">Purchased</th>
              {cloverConnected && <>
                <th className="text-right px-5 py-3">Sold (COGS)</th>
                <th className="text-right px-5 py-3">Waste $</th>
                <th className="text-right px-5 py-3">Waste %</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cloverConnected ? 5 : 2} className="text-center py-8 text-ink-muted">Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={cloverConnected ? 5 : 2} className="text-center py-8 text-ink-muted">No data for this period.</td></tr>
            ) : data.map(row => {
              const waste = row.sold !== null ? row.purchased - row.sold : null
              const wastePct = waste !== null && row.purchased > 0 ? (waste / row.purchased) * 100 : null
              return (
                <tr key={row.category} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt">
                  <td className="px-5 py-3 font-medium text-ink">{row.category}</td>
                  <td className="px-5 py-3 text-right font-mono text-ink-2">${row.purchased.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  {cloverConnected && <>
                    <td className="px-5 py-3 text-right text-green-700">${(row.sold || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${waste && waste > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {waste !== null ? `$${waste.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right ${wastePct && wastePct > 20 ? 'text-red-600 font-semibold' : 'text-ink-3'}`}>
                      {wastePct !== null ? `${wastePct.toFixed(1)}%` : '—'}
                    </td>
                  </>}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
