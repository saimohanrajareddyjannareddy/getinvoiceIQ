'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { ClipboardCheck, CheckCircle, AlertTriangle, ArrowRight, Pencil } from 'lucide-react'

type ReviewInvoice = {
  id: string
  vendor: string
  invoice_number: string | null
  invoice_date: string | null
  total: number | null
  review_reason: string | null
}

/*
 * Review queue — invoices whose AI extraction failed a reconciliation
 * check at save time (line items don't add up to the stated total,
 * qty x price != line total, missing vendor/date). A human checks the
 * invoice against the original and approves it, so extraction errors
 * get caught here instead of silently landing in the books.
 *
 * Requires sql/010_review_queue.sql. Until that runs, this page shows
 * a setup notice instead of erroring.
 */
export default function ReviewPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [rows, setRows] = useState<ReviewInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [setupPending, setSetupPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [denyingId, setDenyingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [savingNameId, setSavingNameId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('invoice_headers')
      .select('id, vendor, invoice_number, invoice_date, total, review_reason')
      .eq('restaurant_id', restaurantId)
      .eq('review_status', 'needs_review')
      .order('invoice_date', { ascending: false })
    if (error) {
      if (error.message.includes('review_status')) setSetupPending(true)
      else setErrorMsg(error.message)
    } else {
      setRows((data as ReviewInvoice[]) || [])
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    load()
  }, [load])

  // The parser stores 'Unknown' when it can't read a supplier (the
  // same rule lib/review-flags flags). Such an invoice must be
  // nameable HERE — before this, the name could only be fixed in the
  // upload preview, so email-scanned invoices were stuck as Unknown.
  function missingVendor(v: string | null): boolean {
    return !v || v.trim().toLowerCase() === 'unknown'
  }

  async function saveName(r: ReviewInvoice) {
    const name = nameDraft.trim()
    if (!name) return
    setSavingNameId(r.id)
    setErrorMsg('')
    // Drop the supplier clause from the stored reason; other flags stay.
    const remaining = (r.review_reason || '')
      .split('; ')
      .filter((f) => f && f !== 'Supplier name could not be read')
    const { error } = await supabase
      .from('invoice_headers')
      .update({ vendor: name, review_reason: remaining.length ? remaining.join('; ') : null })
      .eq('id', r.id)
    if (error) {
      setErrorMsg(error.message)
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === r.id
            ? { ...row, vendor: name, review_reason: remaining.length ? remaining.join('; ') : null }
            : row
        )
      )
      setEditingId(null)
    }
    setSavingNameId(null)
  }

  async function approve(id: string) {
    setApprovingId(id)
    setErrorMsg('')
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('invoice_headers')
      .update({
        review_status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: userData.user?.id ?? null,
      })
      .eq('id', id)
    if (error) {
      setErrorMsg(error.message)
    } else {
      setRows((prev) => prev.filter((r) => r.id !== id))
    }
    setApprovingId(null)
  }

  // Deny = this is not a supplier invoice (personal bill, junk
  // mail, wrong restaurant). Deletes the invoice from the books via
  // the deny_invoice RPC (sql/014); the invoice_files tombstone is
  // kept so an email scan never re-imports it.
  async function deny(id: string) {
    if (!restaurantId) return
    if (
      !window.confirm(
        "Deny and delete this invoice? It leaves your books entirely, and email scans won't import it again."
      )
    )
      return
    setDenyingId(id)
    setErrorMsg('')
    const { error } = await supabase.rpc('deny_invoice', {
      p_restaurant_id: restaurantId,
      p_header_id: id,
    })
    if (error) {
      if (error.message.includes('deny_invoice')) {
        setErrorMsg(
          'Deny needs one database step first: run sql/014_deny_invoice.sql in the Supabase SQL editor, then try again.'
        )
      } else {
        setErrorMsg(error.message)
      }
    } else {
      setRows((prev) => prev.filter((r) => r.id !== id))
    }
    setDenyingId(null)
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1 flex items-center gap-2">
          <ClipboardCheck className="text-pop" /> Review Queue
        </h1>
        <p className="text-ink-muted text-sm">
          Uploads whose numbers don&apos;t add up — and <span className="font-medium text-ink-2">every invoice that arrives by email</span> —
          wait here. Approve the real supplier invoices; deny anything that isn&apos;t one.
        </p>
      </div>

      {setupPending ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-start gap-4">
          <AlertTriangle size={22} className="text-pop mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-800 mb-1">One database step left</div>
            <p className="text-sm text-amber-700">
              The review queue needs <span className="font-mono">sql/010_review_queue.sql</span> run once in the
              Supabase SQL editor. Until then, uploads keep working exactly as before — nothing is blocked.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-12 text-center text-ink-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 flex items-start gap-4">
          <CheckCircle size={24} className="text-green-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-green-800 mb-1">All caught up</div>
            <p className="text-sm text-green-600">
              No invoices are waiting for review. Email-scanned invoices and uploads that don&apos;t reconcile will appear here automatically.
            </p>
          </div>
        </div>
      ) : (
        <>
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{errorMsg}</div>
          )}
          <div className="hidden md:block bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
                <tr className="text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Vendor</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-left px-4 py-3">Why it&apos;s here</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt">
                    <td className="px-4 py-3">
                      {editingId === r.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveName(r)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            placeholder="Supplier name"
                            className="w-36 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-pop"
                          />
                          <button
                            onClick={() => saveName(r)}
                            disabled={savingNameId === r.id || !nameDraft.trim()}
                            className="px-2.5 py-1.5 bg-pop text-white rounded-lg text-xs font-medium hover:bg-pop-hover disabled:opacity-50 transition"
                          >
                            {savingNameId === r.id ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1.5 text-xs text-ink-muted hover:text-ink-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div>
                            <div className={`font-medium ${missingVendor(r.vendor) ? 'text-amber-700' : 'text-ink'}`}>
                              {missingVendor(r.vendor) ? 'Unknown' : r.vendor}
                            </div>
                            {r.invoice_number && <div className="text-xs text-ink-muted">#{r.invoice_number}</div>}
                          </div>
                          <button
                            onClick={() => {
                              setEditingId(r.id)
                              setNameDraft(missingVendor(r.vendor) ? '' : r.vendor)
                            }}
                            title={missingVendor(r.vendor) ? 'Add supplier name' : 'Edit supplier name'}
                            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                              missingVendor(r.vendor)
                                ? 'bg-pop text-white hover:bg-pop-hover'
                                : 'text-ink-muted hover:bg-cream-surface-alt hover:text-ink-2'
                            }`}
                          >
                            <Pencil size={11} />
                            {missingVendor(r.vendor) ? 'Add name' : ''}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-3">{r.invoice_date || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-ink">
                      {r.total != null ? `$${r.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-amber-700">{r.review_reason || 'Flagged for review'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/dashboard/invoices/${r.id}`}
                          className="flex items-center gap-1 px-3 py-1.5 border border-ink/[0.12] bg-cream-surface rounded-[9px] text-xs text-ink-3 hover:bg-cream-surface-alt transition"
                        >
                          Inspect <ArrowRight size={12} />
                        </Link>
                        <button
                          onClick={() => deny(r.id)}
                          disabled={denyingId === r.id}
                          className="px-3 py-1.5 bg-cream-surface border border-red-200 text-red-600 rounded-[9px] text-xs font-medium hover:bg-red-50 disabled:opacity-50 transition"
                        >
                          {denyingId === r.id ? 'Denying…' : 'Deny'}
                        </button>
                        <button
                          onClick={() => approve(r.id)}
                          disabled={approvingId === r.id}
                          className="px-3 py-1.5 bg-pop text-white rounded-[9px] text-xs font-medium hover:bg-pop-hover disabled:opacity-50 transition"
                        >
                          {approvingId === r.id ? 'Approving…' : 'Approve'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Mobile: stacked cards — no sideways table on a phone. */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`font-semibold ${missingVendor(r.vendor) ? 'text-amber-700' : 'text-ink'}`}>
                      {missingVendor(r.vendor) ? 'Unknown' : r.vendor}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {r.invoice_date || 'No date'}
                      {r.invoice_number ? ` · #${r.invoice_number}` : ''}
                    </div>
                  </div>
                  <div className="font-mono text-lg font-bold text-ink">
                    {r.total != null ? `$${r.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                  </div>
                </div>

                {editingId === r.id ? (
                  <div className="mt-3 flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName(r)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      placeholder="Supplier name"
                      className="min-w-0 flex-1 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink outline-none focus:border-pop"
                    />
                    <button
                      onClick={() => saveName(r)}
                      disabled={savingNameId === r.id || !nameDraft.trim()}
                      className="px-3 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover disabled:opacity-50 transition"
                    >
                      {savingNameId === r.id ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-2 text-sm text-ink-muted">
                      Cancel
                    </button>
                  </div>
                ) : (
                  missingVendor(r.vendor) && (
                    <button
                      onClick={() => {
                        setEditingId(r.id)
                        setNameDraft('')
                      }}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-pop px-3 py-2 text-sm font-medium text-white hover:bg-pop-hover"
                    >
                      <Pencil size={13} /> Add supplier name
                    </button>
                  )
                )}

                <p className="mt-3 text-sm text-amber-700">{r.review_reason || 'Flagged for review'}</p>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => approve(r.id)}
                    disabled={approvingId === r.id}
                    className="flex-1 px-3 py-2.5 bg-pop text-white rounded-[9px] text-sm font-medium hover:bg-pop-hover disabled:opacity-50 transition"
                  >
                    {approvingId === r.id ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => deny(r.id)}
                    disabled={denyingId === r.id}
                    className="px-3 py-2.5 bg-cream-surface border border-red-200 text-red-600 rounded-[9px] text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition"
                  >
                    {denyingId === r.id ? 'Denying…' : 'Deny'}
                  </button>
                  <Link
                    href={`/dashboard/invoices/${r.id}`}
                    className="flex items-center gap-1 px-3 py-2.5 border border-ink/[0.12] bg-cream-surface rounded-[9px] text-sm text-ink-3 hover:bg-cream-surface-alt transition"
                  >
                    Inspect <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
