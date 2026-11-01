'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { Search } from 'lucide-react'

type LineResult = {
  id: string
  item_name: string
  display_name: string
  category: string
  unit_price: number
  unit_qty: number
  case_qty: number
  total: number
  invoice_date: string
  invoice_number: string
  vendor: string
}

export default function SearchPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LineResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function search() {
    if (!restaurantId || !query.trim()) return
    setLoading(true)
    setSearched(true)
    const q = query.trim()
    const { data } = await supabase
      .from('invoice_lines')
      .select('id, item_name, display_name, category, unit_price, unit_qty, case_qty, total, invoice_date, invoice_headers!header_id(invoice_number, vendor)')
      .eq('restaurant_id', restaurantId)
      .or(`item_name.ilike.%${q}%,display_name.ilike.%${q}%`)
      .gt('total', 0)
      .order('invoice_date', { ascending: false })
      .limit(200)
    if (data) {
      setResults(data.map((r: any) => ({
        id: r.id,
        item_name: r.item_name,
        display_name: r.display_name || r.item_name,
        category: r.category,
        unit_price: r.unit_price,
        unit_qty: r.unit_qty,
        case_qty: r.case_qty,
        total: r.total,
        invoice_date: r.invoice_date,
        invoice_number: r.invoice_headers?.invoice_number ?? '',
        vendor: r.invoice_headers?.vendor ?? '',
      })))
    }
    setLoading(false)
  }

  const totalSpend = results.reduce((s, r) => s + (r.total || 0), 0)
  const avgPrice = results.length ? results.reduce((s, r) => s + (r.unit_price || 0), 0) / results.length : 0

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Item Search</h1>
      <p className="text-ink-muted text-sm mb-6">Search any ingredient across all invoices.</p>

      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. chicken, shrimp, cauliflower..."
            className="w-full border border-ink/[0.16] bg-cream-surface rounded-[9px] pl-9 pr-4 py-2 text-sm text-ink focus:outline-none focus:border-terracotta"
          />
        </div>
        <button onClick={search}
          className="px-5 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover transition">
          Search
        </button>
      </div>

      {searched && !loading && results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-3">
          {[
            { label: 'Purchases found', value: results.length.toString() },
            { label: 'Total spend', value: `$${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
            { label: 'Avg unit price', value: `$${avgPrice.toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-4">
              <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">{label}</div>
              <div className="font-display text-xl font-extrabold text-ink">{value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-ink-muted">Searching...</div>
      ) : searched && results.length === 0 ? (
        <div className="text-center py-12 text-ink-muted">No results found for “{query}”</div>
      ) : results.length > 0 ? (
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
              <tr className="text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Invoice #</th>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Unit Price</th>
                <th className="text-right px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt">
                  <td className="px-4 py-3 text-ink-muted">{r.invoice_date}</td>
                  <td className="px-4 py-3 font-mono text-ink-3">#{r.invoice_number}</td>
                  <td className="px-4 py-3 font-medium text-ink">{r.display_name}</td>
                  <td className="px-4 py-3">
                    <span className="bg-pop/10 text-pop text-xs px-2 py-0.5 rounded-full">{r.category}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink-2">${(r.unit_price ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-ink">${(r.total ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
