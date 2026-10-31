'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { Search, Download } from 'lucide-react'

type Invoice = { id: string; invoice_date: string; invoice_number: string; vendor: string; total: number; review_status?: string }

const ALL = '__all__'

// Vendor tabs + weekly/monthly totals.
// Default scope is ALL vendors (totals combine every supplier); picking a
// vendor tab narrows the list AND the totals to that vendor.

function isoDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function InvoicesPage() {
  const router = useRouter()
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [search, setSearch] = useState('')
  const [vendorTab, setVendorTab] = useState<string>(ALL)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurantId) return
    supabase.from('invoice_headers').select('*').eq('restaurant_id', restaurantId)
      .order('invoice_date', { ascending: false }).then(({ data }) => {
        // Quarantined invoices (needs_review) live in the Review
        // queue until approved — they don't belong in this list.
        setInvoices((data || []).filter((inv: Invoice) => inv.review_status !== 'needs_review'))
        setLoading(false)
      })
  }, [restaurantId])

  const vendors = useMemo(
    () => [...new Set(invoices.map(i => i.vendor).filter(Boolean))].sort(),
    [invoices]
  )

  const inScope = useMemo(
    () => vendorTab === ALL ? invoices : invoices.filter(i => i.vendor === vendorTab),
    [invoices, vendorTab]
  )

  const filtered = inScope.filter(inv =>
    inv.invoice_number?.toString().includes(search) ||
    inv.vendor?.toLowerCase().includes(search.toLowerCase()) ||
    inv.invoice_date?.includes(search)
  )

  // Weekly / monthly spend for the current vendor scope (trailing windows,
  // same convention as the food-cost page).
  const { weekTotal, monthTotal, weekCount, monthCount } = useMemo(() => {
    const weekStart = isoDaysAgo(7)
    const monthStart = isoDaysAgo(30)
    let weekTotal = 0, monthTotal = 0, weekCount = 0, monthCount = 0
    for (const inv of inScope) {
      const t = Number(inv.total) || 0
      if (inv.invoice_date >= monthStart) { monthTotal += t; monthCount++ }
      if (inv.invoice_date >= weekStart) { weekTotal += t; weekCount++ }
    }
    return { weekTotal, monthTotal, weekCount, monthCount }
  }, [inScope])

  const money = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  async function exportCSV() {
    if (!restaurantId) return
    let query = supabase
      .from('invoice_lines')
      .select('invoice_date, item_name, display_name, category, unit_qty, case_qty, unit_price, total, header_id, invoice_headers!header_id(invoice_number, vendor)')
      .eq('restaurant_id', restaurantId)
      .order('invoice_date', { ascending: false })
    if (vendorTab !== ALL) {
      const ids = inScope.map(i => i.id)
      if (ids.length === 0) return
      query = query.in('header_id', ids)
    }
    const { data: lines } = await query
    if (!lines) return
    const rows = [
      ['Date', 'Invoice #', 'Vendor', 'Item (raw)', 'Item (canonical)', 'Category', 'Unit Qty', 'Case Qty', 'Unit Price', 'Total'],
      ...lines.map((l: any) => [
        l.invoice_date, l.invoice_headers?.invoice_number, l.invoice_headers?.vendor,
        l.item_name, l.display_name, l.category, l.unit_qty, l.case_qty, l.unit_price, l.total
      ])
    ]
    const csv = rows.map(r => r.map((v: any) => `"${v ?? ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    const d = new Date()
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const scope = vendorTab === ALL ? 'all-vendors' : vendorTab.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    a.download = `invoices-${scope}-${dateStr}.csv`; a.click()
  }

  const scopeLabel = vendorTab === ALL ? 'All vendors' : vendorTab

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col items-start gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Invoices</h1>
          <p className="text-ink-muted text-sm">All invoices — click to see line items.</p>
        </div>
        <button onClick={exportCSV}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 border border-ink/[0.12] bg-cream-surface rounded-[9px] text-sm text-ink-3 hover:bg-cream-surface-alt transition">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Vendor tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {[ALL, ...vendors].map(v => (
          <button key={v} onClick={() => setVendorTab(v)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
              vendorTab === v
                ? 'bg-pop text-white'
                : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'
            }`}>
            {v === ALL ? 'All vendors' : v}
          </button>
        ))}
      </div>

      {/* Weekly / monthly totals for the current scope */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide">Spend · last 7 days</div>
          <div className="mt-1 font-display text-2xl font-extrabold text-ink">{money(weekTotal)}</div>
          <div className="mt-1 text-xs text-ink-muted">{scopeLabel} · {weekCount} invoice{weekCount === 1 ? '' : 's'}</div>
        </div>
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide">Spend · last 30 days</div>
          <div className="mt-1 font-display text-2xl font-extrabold text-ink">{money(monthTotal)}</div>
          <div className="mt-1 text-xs text-ink-muted">{scopeLabel} · {monthCount} invoice{monthCount === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by date, invoice #, or vendor..."
          className="w-full border border-ink/[0.16] bg-cream-surface rounded-[9px] pl-9 pr-4 py-2 text-sm text-ink focus:outline-none focus:border-pop" />
      </div>

      <div className="hidden md:block bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full text-sm">
          <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
            <tr className="text-ink-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Invoice #</th>
              <th className="text-left px-4 py-3">Vendor</th>
              <th className="text-right px-4 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8 text-ink-muted">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-ink-muted">No invoices for this vendor.</td></tr>
            ) : filtered.map(inv => (
              <tr key={inv.id} onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
                className="border-b border-ink/[0.06] last:border-0 hover:bg-pop/5 cursor-pointer transition">
                <td className="px-4 py-3 text-ink-3">{inv.invoice_date}</td>
                <td className="px-4 py-3 font-mono font-medium text-ink">#{inv.invoice_number}</td>
                <td className="px-4 py-3 text-ink-3">{inv.vendor}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-ink">${Number(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Mobile: tappable rows, vendor first */}
      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden md:hidden">
        {loading ? (
          <div className="py-8 text-center text-sm text-ink-muted">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-muted">No invoices for this vendor.</div>
        ) : (
          <div className="divide-y divide-ink/[0.06]">
            {filtered.map(inv => (
              <button
                key={inv.id}
                onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-pop/5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{inv.vendor}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {inv.invoice_date} · #{inv.invoice_number}
                  </span>
                </span>
                <span className="font-mono text-[15px] font-bold text-ink">
                  ${Number(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
