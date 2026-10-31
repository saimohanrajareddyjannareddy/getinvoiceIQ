'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { ChevronDown, ChevronRight } from 'lucide-react'

type HeaderRow = {
  id: string
  invoice_date: string
  invoice_number: string
  vendor: string
  total: number
  review_status?: string
}

type VendorSummary = {
  name: string
  count: number
  totalSpend: number
  spend30d: number
  lastDate: string
  avgInvoice: number
  recent: HeaderRow[]
}

function isoDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Vendors = where the money goes, aggregated from approved invoice
// headers (quarantined needs_review invoices are excluded, same as
// the Invoices list). Click a row for its most recent invoices.
export default function VendorsPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [rows, setRows] = useState<HeaderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    ;(async () => {
      const cols = 'id, invoice_date, invoice_number, vendor, total'
      let res: any = await supabase
        .from('invoice_headers')
        .select(`${cols}, review_status`)
        .eq('restaurant_id', restaurantId)
        .order('invoice_date', { ascending: false })
      if (res.error && res.error.message.includes('review_status')) {
        // Pre-010 migration: no review columns yet.
        res = await supabase
          .from('invoice_headers')
          .select(cols)
          .eq('restaurant_id', restaurantId)
          .order('invoice_date', { ascending: false })
      }
      setRows(((res.data as HeaderRow[]) || []).filter((r) => r.review_status !== 'needs_review'))
      setLoading(false)
    })()
  }, [restaurantId])

  const vendors = useMemo<VendorSummary[]>(() => {
    const cutoff30 = isoDaysAgo(30)
    const map: Record<string, VendorSummary> = {}
    for (const r of rows) {
      const name = (r.vendor || 'Unknown').trim() || 'Unknown'
      if (!map[name]) {
        map[name] = { name, count: 0, totalSpend: 0, spend30d: 0, lastDate: r.invoice_date, avgInvoice: 0, recent: [] }
      }
      const v = map[name]
      v.count++
      v.totalSpend += r.total || 0
      if (r.invoice_date >= cutoff30) v.spend30d += r.total || 0
      if (r.invoice_date > v.lastDate) v.lastDate = r.invoice_date
      if (v.recent.length < 5) v.recent.push(r)
    }
    return Object.values(map)
      .map((v) => ({ ...v, avgInvoice: v.count ? v.totalSpend / v.count : 0 }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
  }, [rows])

  const total30 = vendors.reduce((s, v) => s + v.spend30d, 0)
  const topVendor = vendors[0]

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Vendors</h1>
      <p className="text-ink-muted text-sm mb-6">Every supplier you buy from, ranked by spend.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
          <div className="text-xs font-medium text-ink-muted uppercase tracking-wide">Suppliers</div>
          <div className="font-display text-2xl font-extrabold text-ink mt-1">{loading ? '—' : vendors.length}</div>
        </div>
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
          <div className="text-xs font-medium text-ink-muted uppercase tracking-wide">Spend · last 30 days</div>
          <div className="font-display text-2xl font-extrabold text-ink mt-1">{loading ? '—' : money(total30)}</div>
        </div>
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
          <div className="text-xs font-medium text-ink-muted uppercase tracking-wide">Biggest supplier</div>
          <div className="font-display text-2xl font-extrabold text-ink mt-1 truncate">{loading ? '—' : topVendor ? topVendor.name : '—'}</div>
          {topVendor && <div className="text-xs text-ink-muted mt-0.5">{money(topVendor.totalSpend)} all time</div>}
        </div>
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
              <tr className="text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Supplier</th>
                <th className="text-right px-4 py-3">Invoices</th>
                <th className="text-right px-4 py-3">Total spend</th>
                <th className="text-right px-4 py-3">Last 30 days</th>
                <th className="text-right px-4 py-3">Avg invoice</th>
                <th className="text-left px-4 py-3">Last invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink-muted">Loading...</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink-muted">No supplier invoices yet — upload or scan your first invoice and its supplier appears here.</td></tr>
              ) : vendors.map((v) => (
                <Fragment key={v.name}>
                  <tr onClick={() => setExpanded(expanded === v.name ? null : v.name)}
                    className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt cursor-pointer">
                    <td className="px-4 py-3 font-medium text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        {expanded === v.name ? <ChevronDown size={14} className="text-ink-muted" /> : <ChevronRight size={14} className="text-ink-muted" />}
                        {v.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-ink-3">{v.count}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-ink">{money(v.totalSpend)}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink-3">{money(v.spend30d)}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink-3">{money(v.avgInvoice)}</td>
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{v.lastDate}</td>
                  </tr>
                  {expanded === v.name && (
                    <tr className="bg-cream-surface-alt/60 border-b border-ink/[0.06]">
                      <td colSpan={6} className="px-6 py-3">
                        <div className="text-xs font-medium text-ink-muted uppercase tracking-wide mb-2">Recent invoices</div>
                        {v.recent.map((r) => (
                          <div key={r.id} className="flex items-center gap-4 py-1 text-sm">
                            <span className="font-mono text-xs text-ink-muted w-24">{r.invoice_date}</span>
                            <span className="font-mono text-xs text-ink-muted">#{r.invoice_number}</span>
                            <span className="ml-auto font-mono font-medium text-ink">{money(r.total || 0)}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
