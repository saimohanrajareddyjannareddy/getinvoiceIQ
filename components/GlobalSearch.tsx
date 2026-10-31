'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, FileText, Package, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'

/*
 * Global search — the top-bar magnifier, made real. Searches the
 * current restaurant's invoices (vendor / invoice number), line
 * items (by name) and suppliers, and jumps to the matching page.
 */

type InvoiceHit = { id: string; vendor: string; invoice_number: string | null; invoice_date: string; total: number }
type ItemHit = { name: string; category: string; unit_price: number | null; date: string | null }

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { current } = useRestaurant()
  const restaurantId = current?.id
  const [q, setQ] = useState('')
  const [invoices, setInvoices] = useState<InvoiceHit[]>([])
  const [items, setItems] = useState<ItemHit[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setInvoices([])
      setItems([])
      setVendors([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open ])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    const query = q.trim()
    if (!open || !restaurantId || query.length < 2) {
      setInvoices([])
      setItems([])
      setVendors([])
      return
    }
    const safe = query.replace(/[%_,()\\]/g, ' ').trim()
    if (!safe) return
    setSearching(true)
    const t = setTimeout(async () => {
      const [invRes, lineRes, vendRes] = await Promise.all([
        supabase
          .from('invoice_headers')
          .select('id, vendor, invoice_number, invoice_date, total')
          .eq('restaurant_id', restaurantId)
          .or(`vendor.ilike.%${safe}%,invoice_number.ilike.%${safe}%`)
          .order('invoice_date', { ascending: false })
          .limit(6),
        supabase
          .from('invoice_lines')
          .select('item_name, display_name, category, unit_price, invoice_headers!header_id(invoice_date)')
          .eq('restaurant_id', restaurantId)
          .or(`item_name.ilike.%${safe}%,display_name.ilike.%${safe}%`)
          .limit(40),
        supabase
          .from('invoice_headers')
          .select('vendor')
          .eq('restaurant_id', restaurantId)
          .ilike('vendor', `%${safe}%`)
          .limit(25),
      ])
      setInvoices((invRes.data as InvoiceHit[]) || [])
      // Dedupe items by display name, keeping the most recent price seen.
      const byName = new Map<string, ItemHit>()
      for (const l of (lineRes.data as unknown as { display_name: string | null; item_name: string; category: string; unit_price: number | null; invoice_headers: { invoice_date: string } | null }[]) || []) {
        const name = l.display_name || l.item_name
        const date = l.invoice_headers?.invoice_date || null
        const prev = byName.get(name)
        if (!prev || (date && (!prev.date || date > prev.date))) {
          byName.set(name, { name, category: l.category, unit_price: l.unit_price, date })
        }
      }
      setItems([...byName.values()].slice(0, 8))
      setVendors([...new Set(((vendRes.data as { vendor: string }[]) || []).map((v) => v.vendor).filter(Boolean))].slice(0, 5))
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q, open, restaurantId])

  if (!open) return null

  const hasResults = invoices.length > 0 || items.length > 0 || vendors.length > 0
  const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

  function go(path: string) {
    onClose()
    router.push(path)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-x-0 top-[8vh] z-50 mx-auto w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-ink/[0.1] bg-cream-surface shadow-2xl">
        <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
          <Search size={17} className="shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search invoices, items, suppliers…"
            className="min-w-0 flex-1 text-[15px] focus:outline-none"
          />
          {searching && <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />}
          <button onClick={onClose} className="shrink-0 text-ink-muted transition hover:text-ink-2">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              Type at least 2 characters — try a supplier (“depot”), an item (“chicken”), or an invoice number.
            </p>
          ) : !hasResults && !searching ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              No matches in {current?.name || 'this restaurant'} for “{q.trim()}”.
            </p>
          ) : (
            <>
              {vendors.length > 0 && (
                <div className="py-2">
                  <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Suppliers</div>
                  {vendors.map((v) => (
                    <button key={v} onClick={() => go('/dashboard/vendors')} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-cream-surface-alt">
                      <Building2 size={14} className="shrink-0 text-ink-muted" />
                      <span className="font-medium text-ink">{v}</span>
                    </button>
                  ))}
                </div>
              )}
              {invoices.length > 0 && (
                <div className="py-2">
                  <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Invoices</div>
                  {invoices.map((inv) => (
                    <button key={inv.id} onClick={() => go(`/dashboard/invoices/${inv.id}`)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-cream-surface-alt">
                      <FileText size={14} className="shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        <span className="font-medium">{inv.vendor}</span>
                        {inv.invoice_number ? ` · #${inv.invoice_number}` : ''} · {inv.invoice_date}
                      </span>
                      <span className="shrink-0 font-mono font-medium text-ink-2">{money(inv.total)}</span>
                    </button>
                  ))}
                </div>
              )}
              {items.length > 0 && (
                <div className="py-2">
                  <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Items</div>
                  {items.map((it) => (
                    <button key={it.name} onClick={() => go('/dashboard/price-tracker')} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-cream-surface-alt">
                      <Package size={14} className="shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1 truncate text-ink">{it.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted">{it.category}</span>
                      {it.unit_price != null && <span className="shrink-0 font-mono font-medium text-ink-2">{money(it.unit_price)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
