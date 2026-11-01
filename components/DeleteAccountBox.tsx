'use client'

import { useState } from 'react'
import { AlertCircle, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * getinvoiceIQ — self-serve account deletion, reachable trigger + confirm
 * box. Extracted from the Settings danger zone so it can also live on
 * the first-run welcome: a brand-new account has no restaurant, and
 * the dashboard gate makes Settings unreachable until one exists —
 * deletion must not be trapped behind creating a restaurant.
 * Same contract as Settings: type the account email exactly, POST to
 * /api/account/delete with the session token (the server verifies
 * the email against the token's user too), then sign out to /login.
 */
export default function DeleteAccountBox({
  email,
  triggerClassName,
}: {
  email?: string | null
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [confirmEmailText, setConfirmEmailText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteAccount() {
    if (!email || confirmEmailText.trim().toLowerCase() !== email.toLowerCase()) {
      setErr('Type your account email exactly to confirm.')
      return
    }
    setDeleting(true)
    setErr(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in required')
      const resp = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm_email: confirmEmailText.trim() }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || 'Account deletion failed')
      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Account deletion failed')
      setDeleting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          'text-[13px] font-medium text-red-600 underline-offset-2 transition hover:underline'
        }
      >
        Delete account
      </button>
    )
  }

  return (
    <div className="w-full basis-full rounded-lg border border-red-100 bg-red-50/50 p-4 text-left">
      <div className="mb-1 font-display font-bold text-ink">Delete your account</div>
      <div className="mb-3 text-sm text-ink-3">
        Permanently delete your getinvoiceIQ account
        {email && (
          <>
            {' '}(<span className="font-semibold text-ink">{email}</span>)
          </>
        )}
        . Every restaurant you <span className="font-semibold text-ink">own</span> is
        deleted with all of its invoices, sales and recipes; you will be removed from any
        restaurant you only belong to. This cannot be undone.
      </div>

      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-3">
        Type your account email to confirm
      </label>
      <input
        value={confirmEmailText}
        onChange={(e) => { setConfirmEmailText(e.target.value); setErr(null) }}
        placeholder={email ?? 'you@example.com'}
        className="mb-3 w-full rounded-lg border border-red-200 px-3 py-2 text-sm text-ink-2 focus:border-red-400 focus:outline-none"
      />

      {err && (
        <div className="mb-3 flex items-start gap-2 rounded bg-red-100 p-2.5 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {err}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={deleting || !email || confirmEmailText.trim().toLowerCase() !== email.toLowerCase()}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size={14} />
          {deleting ? 'Deleting…' : 'Delete account permanently'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-ink-3 underline-offset-2 transition hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
