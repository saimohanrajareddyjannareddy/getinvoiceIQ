import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * getinvoiceIQ — the trial gate rule, in one place.
 *
 * Sai's billing model: the 14-day trial needs no card and is
 * never charged; when the trial ends, the product stops until a
 * card is added. A restaurant is GATED when its trial date has
 * passed and it has no live subscription:
 *   - never subscribed → no Stripe subscription id, or
 *   - subscription cancelled → the id remains but the status is
 *     'canceled' (Stripe only flips to canceled once the paid
 *     period has actually ended, so this never cuts a paid month
 *     short).
 * Restaurants still in trial, and subscribers in good standing
 * or inside Stripe's payment-retry window (past_due), are never
 * gated.
 *
 * Used by the dashboard layout (screen gate + countdown banner)
 * and by the server intake paths (WhatsApp webhook, email
 * ingest + daily scan, daily Clover sync), which pause for
 * gated restaurants the way apps generally freeze a lapsed
 * account: nothing new is processed until the card is added,
 * and everything already inside is kept.
 */

export type BillingFields = {
  trial_ends_at?: string | null
  stripe_subscription_id?: string | null
  subscription_status?: string | null
}

export function hasLiveSubscription(r: BillingFields): boolean {
  return !!r.stripe_subscription_id && r.subscription_status !== 'canceled'
}

export function isTrialGated(r: BillingFields, now: number = Date.now()): boolean {
  return (
    !hasLiveSubscription(r) &&
    !!r.trial_ends_at &&
    new Date(r.trial_ends_at).getTime() < now
  )
}

/** Whole days of trial left; negative once the trial has ended. */
export function trialDaysLeft(r: BillingFields, now: number = Date.now()): number | null {
  if (!r.trial_ends_at) return null
  return Math.ceil((new Date(r.trial_ends_at).getTime() - now) / 86400000)
}

const BILLING_COLUMNS = 'trial_ends_at, stripe_subscription_id, subscription_status'

/**
 * Server-side check for one restaurant. Fails OPEN (returns
 * false) on any read problem — a billing lookup hiccup must
 * never freeze a working restaurant's intake.
 */
export async function fetchTrialGated(
  sb: SupabaseClient,
  restaurantId: string
): Promise<boolean> {
  const { data, error } = await sb
    .from('restaurants')
    .select(BILLING_COLUMNS)
    .eq('id', restaurantId)
    .maybeSingle()
  if (error || !data) return false
  return isTrialGated(data as BillingFields)
}

/**
 * Batch version for the daily cron loops: returns the subset of
 * the given restaurant ids that is gated. Fails open (empty set)
 * on a read error.
 */
export async function fetchGatedIds(
  sb: SupabaseClient,
  restaurantIds: string[]
): Promise<Set<string>> {
  const gated = new Set<string>()
  if (restaurantIds.length === 0) return gated
  const { data, error } = await sb
    .from('restaurants')
    .select(`id, ${BILLING_COLUMNS}`)
    .in('id', restaurantIds)
  if (error || !data) return gated
  for (const row of data as Array<BillingFields & { id: string }>) {
    if (isTrialGated(row)) gated.add(row.id)
  }
  return gated
}
