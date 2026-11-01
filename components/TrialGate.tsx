'use client'
import { useEffect, useState } from 'react'
import DeleteAccountBox from '@/components/DeleteAccountBox'

/**
 * TrialGate — the "ask for a card when the trial ends" screen.
 *
 * Sai's billing model: no card during the 14-day trial, and never
 * a charge before it ends. When the trial is over and the
 * restaurant has no live subscription, the dashboard layout swaps
 * its content for this card. Adding a card runs the same Stripe
 * Checkout as the Settings Subscribe button; because the trial
 * has already ended, checkout passes no trial_end and the first
 * $99 is charged at subscribe time, then monthly.
 *
 * While the gate is up it polls the billing status endpoint —
 * when the Stripe webhook lands the subscription, the restaurant
 * list refreshes and the layout lifts the gate on its own.
 * Escape hatches mirror the first-run welcome: the sidebar (with
 * the restaurant switcher and sign-out) stays visible around this
 * card, and account deletion lives here because Settings is
 * behind the gate.
 */
export default function TrialGate({
  restaurantId,
  restaurantName,
  trialEndsAt,
  email,
  hasSubId,
  onSubscribed,
}: {
  restaurantId: string
  restaurantName: string
  trialEndsAt: string
  email?: string
  hasSubId: boolean
  onSubscribed: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Returning from a cancelled checkout lands on
  // /dashboard/settings?billing=cancelled — behind this gate, so
  // surface the same reassurance here. A success return is handled
  // by the status poll below lifting the gate.
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('billing')
    if (b === 'cancelled') {
      setMsg('Checkout was cancelled — nothing was charged. Add a card whenever you are ready.')
    }
  }, [])

  // Auto-unlock: only while no subscription id is known yet (a
  // cancelled subscription keeps its id, and then there is nothing
  // to wait for — the Subscribe button is the way back).
  useEffect(() => {
    if (hasSubId) return
    const t = setInterval(() => {
      fetch(`/api/billing/status?restaurant_id=${restaurantId}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.has_subscription) onSubscribed()
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [restaurantId, hasSubId, onSubscribed])

  async function startCheckout() {
    setBusy(true)
    setMsg(null)
    try {
      const resp = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.url) {
        throw new Error(json.error || `Checkout failed (HTTP ${resp.status})`)
      }
      window.location.href = json.url
    } catch (e: any) {
      setMsg(e?.message || 'Checkout failed')
      setBusy(false)
    }
  }

  const endedLabel = new Date(trialEndsAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-[620px] rounded-[20px] border border-ink/[0.08] bg-cream-surface p-8 text-center shadow-[0_12px_40px_rgba(23,19,16,0.07)] md:p-10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pop">
          Free trial ended
        </div>
        <h2 className="mt-3 font-display text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-ink">
          Your 14 days are up
        </h2>
        <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-relaxed text-ink-3">
          <span className="font-medium text-ink-2">{restaurantName}</span>&rsquo;s
          free trial ended on {endedLabel}. Everything you added — invoices,
          prices, recipes — is saved and waiting. Add a card to pick up
          right where you left off.
        </p>

        <div className="mx-auto mt-7 max-w-[420px] rounded-[14px] border border-ink/[0.08] bg-cream-surface-alt px-5 py-4 text-left">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold text-ink">Per-location plan</span>
            <span className="font-display text-[20px] font-extrabold text-ink">
              $99<span className="text-[13px] font-semibold text-ink-muted">/month</span>
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            Charged today, then monthly. No charge was made during your
            trial. Cancel anytime from Settings.
          </p>
        </div>

        {msg && (
          <div className="mx-auto mt-5 max-w-[420px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
            {msg}
          </div>
        )}

        <button
          type="button"
          onClick={startCheckout}
          disabled={busy}
          className="mt-7 rounded-[10px] bg-pop px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-pop-hover disabled:opacity-50"
        >
          {busy ? 'Opening checkout…' : 'Add a card to continue'}
        </button>
        <p className="mt-3 text-[12px] text-ink-muted">
          Secure checkout runs on Stripe — we never see or store your card number.
        </p>

        {/* Escape hatches, same rule as the first-run welcome: a
            gated screen never traps the account. The sidebar's
            switcher and sign-out stay reachable around this card;
            deletion lives here because Settings is behind the gate. */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.08] pt-5 text-left">
          <p className="max-w-[300px] text-[13px] text-ink-muted">
            Have another restaurant? Switch to it from the sidebar — each
            location has its own trial.
          </p>
          <DeleteAccountBox email={email} />
        </div>
      </div>
    </main>
  )
}
