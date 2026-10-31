'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Printer, Trash2 } from 'lucide-react'

type Line = {
  id: string
  item_name: string
  display_name: string | null
  category: string
  purchase_unit: string | null
  unit_qty: number
  case_qty: number
  unit_price: number
  total: number
  canonical_item_id: string | null
  canonical_items: { name: string; default_unit: string | null } | null
}
type Header = { restaurant_id: string; invoice_date: string; invoice_number: string; vendor: string; total: number }

const CATEGORY_COLORS: Record<string, string> = {
  Proteins: 'bg-red-100 text-red-700',
  Produce: 'bg-green-100 text-green-700',
  Dairy: 'bg-blue-100 text-blue-700',
  'Dry Goods': 'bg-yellow-100 text-yellow-700',
  Beverages: 'bg-cyan-100 text-cyan-700',
  Packaging: 'bg-gray-100 text-gray-600',
  Cleaning: 'bg-teal-100 text-teal-700',
  Credits: 'bg-rose-100 text-rose-700',
  Other: 'bg-amber-100 text-amber-700',
}

function qtyLabel(line: Line): string {
  const unit = (line.purchase_unit || '').toLowerCase()
  const fallback = (line.canonical_items?.default_unit || '').toLowerCase()
  const q = line.unit_qty
  const c = line.case_qty
  if ((unit === 'lb' || unit === 'lbs') && q) return `${q} lb`
  if (unit === 'case' && c) return `${c} case`
  if ((unit === 'each' || unit === 'ea') && q) return `${q} ea`
  // Any other explicit unit the extractor captured (gal, oz, ct, ...).
  if (unit && unit !== 'case' && q) return `${q} ${unit}`
  // No usable unit from extraction: fall back to the canonical item's unit
  // ("40" + chicken thigh meat -> "40 lb"). Never print a bare number.
  if (q && fallback) return `${q} ${fallback}`
  if (q) return `${q}`
  if (c) return `${c} case`
  return '—'
}

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [header, setHeader] = useState<Header | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteNotice, setDeleteNotice] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('invoice_headers').select('*').eq('id', id).single(),
      supabase.from('invoice_lines')
        .select('*, canonical_items!canonical_item_id(name, default_unit)')
        .eq('header_id', id).order('total', { ascending: false }),
    ]).then(([{ data: h }, { data: l }]) => {
      setHeader(h)
      setLines(l || [])
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="p-8 text-ink-muted">Loading...</div>
  if (!header) return <div className="p-8 text-ink-muted">Invoice not found.</div>

  // Permanent delete via the delete_invoice RPC (sql/015) — members
  // have no direct DELETE policy. The invoice_files row is kept as a
  // tombstone so an email-scanned invoice never re-imports itself.
  async function handleDelete() {
    if (!header) return
    if (!window.confirm('Delete this invoice permanently? Its line items leave your books and totals recompute without it. This cannot be undone.')) return
    setDeleting(true)
    setDeleteNotice('')
    const { error } = await supabase.rpc('delete_invoice', {
      p_restaurant_id: header.restaurant_id,
      p_header_id: id,
    })
    if (error) {
      setDeleting(false)
      setDeleteNotice(
        error.message.includes('delete_invoice')
          ? 'Delete needs one database step first: run sql/015_delete_invoice.sql in the Supabase SQL editor, then try again.'
          : error.message
      )
      return
    }
    router.push('/dashboard/invoices')
  }

  const regular = lines.filter(l => (l.total || 0) >= 0)
  const credits = lines.filter(l => (l.total || 0) < 0)
  const creditTotal = credits.reduce((s, l) => s + (l.total || 0), 0)

  return (
    <div className="p-8 print:p-4">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-ink-3 hover:text-ink text-sm transition">
          <ArrowLeft size={14} /> Back to Invoices
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 border border-ink/[0.12] bg-cream-surface rounded-[9px] text-sm text-ink-3 hover:bg-cream-surface-alt transition">
            <Printer size={14} /> Print / PDF
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 bg-cream-surface border border-red-200 rounded-[9px] text-sm text-red-600 hover:bg-red-50 transition disabled:opacity-50">
            <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {deleteNotice && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          {deleteNotice}
        </div>
      )}

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6 print:border-0 print:p-0 print:mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.5px] text-ink">Invoice #{header.invoice_number}</h1>
            <p className="text-ink-muted text-sm mt-1">{header.vendor} · {header.invoice_date}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-muted uppercase tracking-wide">Invoice Total</div>
            <div className="text-3xl font-bold text-pop">${Number(header.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            {credits.length > 0 && (
              <div className="text-sm text-red-500 mt-0.5">
                Incl. {credits.length} credit{credits.length > 1 ? 's' : ''} (${creditTotal.toFixed(2)})
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden print:border-0">
        {regular.length > 0 && (
          <>
            <div className="px-5 py-3 border-b border-ink/[0.08] bg-cream-surface-alt">
              <h2 className="font-semibold text-ink-2 text-sm">{regular.length} Line Items</h2>
            </div>
            <div className="hidden md:block print:block overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Item</th>
                  <th className="text-left px-5 py-3">Category</th>
                  <th className="text-right px-5 py-3">Qty</th>
                  <th className="text-right px-5 py-3">Unit Price</th>
                  <th className="text-right px-5 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {regular.map(line => (
                  <tr key={line.id} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt print:hover:bg-white">
                    <td className="px-5 py-3 font-medium text-ink">{line.display_name || line.item_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[line.category] || CATEGORY_COLORS.Other}`}>
                        {line.category || 'Other'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-ink-3">{qtyLabel(line)}</td>
                    <td className="px-5 py-3 text-right font-mono text-ink-3">{line.unit_price ? `$${Number(line.unit_price).toFixed(2)}` : '—'}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-ink">${Number(line.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="divide-y md:hidden print:hidden">
              {regular.map(line => (
                <div key={line.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">{line.display_name || line.item_name}</span>
                    <span className="font-mono font-semibold text-ink">${Number(line.total).toFixed(2)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span className={`px-2 py-0.5 rounded-full ${CATEGORY_COLORS[line.category] || CATEGORY_COLORS.Other}`}>
                      {line.category || 'Other'}
                    </span>
                    <span>{qtyLabel(line)}</span>
                    {line.unit_price ? <span>@ ${Number(line.unit_price).toFixed(2)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {credits.length > 0 && (
          <>
            <div className="px-5 py-3 border-t border-b bg-red-50">
              <h2 className="font-semibold text-red-700 text-sm">{credits.length} Credit{credits.length > 1 ? 's' : ''} / Return{credits.length > 1 ? 's' : ''}</h2>
            </div>
            <div className="hidden md:block print:block overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full text-sm">
              <thead className="border-b bg-red-50">
                <tr className="text-red-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Item</th>
                  <th className="text-left px-5 py-3">Category</th>
                  <th className="text-right px-5 py-3">Qty</th>
                  <th className="text-right px-5 py-3">Unit Price</th>
                  <th className="text-right px-5 py-3">Credit</th>
                </tr>
              </thead>
              <tbody>
                {credits.map(line => (
                  <tr key={line.id} className="border-b last:border-0 bg-red-50/50">
                    <td className="px-5 py-3 font-medium text-red-800">{line.display_name || line.item_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[line.category] || CATEGORY_COLORS.Other}`}>
                        {line.category || 'Other'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-red-600">{qtyLabel(line)}</td>
                    <td className="px-5 py-3 text-right text-red-600">{line.unit_price ? `$${Number(line.unit_price).toFixed(2)}` : '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-red-600">${Number(line.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="divide-y md:hidden print:hidden">
              {credits.map(line => (
                <div key={line.id} className="bg-red-50/50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-red-800">{line.display_name || line.item_name}</span>
                    <span className="font-semibold text-red-600">${Number(line.total).toFixed(2)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-red-600">
                    <span className={`px-2 py-0.5 rounded-full ${CATEGORY_COLORS[line.category] || CATEGORY_COLORS.Other}`}>
                      {line.category || 'Other'}
                    </span>
                    <span>{qtyLabel(line)}</span>
                    {line.unit_price ? <span>@ ${Number(line.unit_price).toFixed(2)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t bg-red-50 text-right text-sm font-semibold text-red-700">
              Total Credits: ${creditTotal.toFixed(2)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
