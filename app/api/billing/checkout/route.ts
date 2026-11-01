import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe, resolvePriceId, stripeConfigured } from '@/lib/stripe'

/*
 * Creates a Stripe Checkout session for the restaurant's
 * subscription and returns its URL. Creates the Stripe Customer on
 * first use (named for the restaurant, emailed to the owner) and
 * remembers it on the restaurant row. If the restaurant is still
 * inside its 14-day trial window, the subscription's trial_end is
 * set to match so nobody is charged early.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured yet' }, { status: 503 })
  }
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'Server billing is not configured' }, { status: 500 })
  }
  const { restaurant_id } = await req.json()
  if (!restaurant_id) {
    return NextResponse.json({ error: 'restaurant_id required' }, { status: 400 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY
  )
  const { data: restaurant, error } = await sb
    .from('restaurants')
    .select('id, name, stripe_customer_id, trial_ends_at')
    .eq('id', restaurant_id)
    .single()
  if (error || !restaurant) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
  }

  const stripe = getStripe()

  // Stripe SDK errors (bad key, price from another account, …) must
  // come back as JSON — an unhandled throw makes Next return a
  // non-JSON 500 and the client can only say 'Unexpected end of JSON
  // input', hiding the real cause.
  try {
    return await createSession(sb, stripe, restaurant, restaurant_id, req)
  } catch (e: any) {
    return NextResponse.json(
      { error: `Stripe error: ${e?.message ?? 'unknown'}` },
      { status: 502 }
    )
  }
}

async function createSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  stripe: ReturnType<typeof getStripe>,
  restaurant: { stripe_customer_id: string | null; name: string; trial_ends_at: string | null },
  restaurant_id: string,
  req: NextRequest
) {
  // Resolve the price before creating a Customer, so a bad
  // STRIPE_PRICE_ID doesn't leave an orphan Customer behind.
  const priceId = await resolvePriceId(stripe)

  let customerId: string = restaurant.stripe_customer_id ?? ''
  if (!customerId) {
    // Owner's email for receipts: first owner membership on the restaurant.
    let ownerEmail: string | undefined
    const { data: ownerRow } = await sb
      .from('user_restaurants')
      .select('user_id')
      .eq('restaurant_id', restaurant_id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    if (ownerRow?.user_id) {
      const { data: userData } = await sb.auth.admin.getUserById(ownerRow.user_id)
      ownerEmail = userData.user?.email ?? undefined
    }
    const customer = await stripe.customers.create({
      name: restaurant.name,
      email: ownerEmail,
      metadata: { restaurant_id },
    })
    customerId = customer.id
    await sb
      .from('restaurants')
      .update({ stripe_customer_id: customerId })
      .eq('id', restaurant_id)
  }

  const origin = req.nextUrl.origin
  const trialEnd = restaurant.trial_ends_at
    ? Math.floor(new Date(restaurant.trial_ends_at).getTime() / 1000)
    : undefined
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { restaurant_id },
      ...(trialEnd && trialEnd > Math.floor(Date.now() / 1000)
        ? { trial_end: trialEnd }
        : {}),
    },
    metadata: { restaurant_id },
    success_url: `${origin}/dashboard/settings?billing=success`,
    cancel_url: `${origin}/dashboard/settings?billing=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}
