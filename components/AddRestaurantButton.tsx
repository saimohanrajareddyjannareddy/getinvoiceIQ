'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useRestaurant } from '@/lib/restaurant'

export default function AddRestaurantButton() {
  const { createRestaurant } = useRestaurant()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setName('')
    setErr(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await createRestaurant(name.trim())
      close()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create restaurant')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Add restaurant"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover transition shadow-sm"
      >
        <Plus size={14} strokeWidth={2.5} />
        {/* Icon-only below md so the shell header fits a mobile viewport (label preserved at md+). */}
        <span className="hidden md:inline">Add Restaurant</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="bg-cream-surface rounded-[14px] shadow-xl border border-ink/[0.1] w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Add a new restaurant
                </h2>
                <p className="text-sm text-ink-muted mt-0.5">
                  You&apos;ll be added as the owner and can switch to it from the top bar.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="text-ink-muted hover:text-ink-2 p-1 rounded-md hover:bg-cream-surface-alt"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-3 mb-1.5 uppercase tracking-wide">
                Restaurant Name
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Turmeric STL — Westport"
                className="w-full bg-cream-surface border border-ink/[0.16] rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-terracotta"
              />
            </div>

            {err && (
              <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-100">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 bg-cream-surface border border-ink/[0.12] text-ink-2 rounded-lg text-sm font-medium hover:bg-cream-surface-alt transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="px-4 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover transition disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create restaurant'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
