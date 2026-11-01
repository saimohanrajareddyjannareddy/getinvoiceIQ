import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncRestaurantClover } from '@/lib/clover-sync'
import { fetchGatedIds } from '@/lib/billing-gate'

/*
 * Daily automatic Clover sync for every restaurant with a connected
 * POS. Invoked by Vercel Cron (see vercel.json), which sends
 * Authorization: Bearer <CRON_SECRET> when that env var is set.
 * Mirrors app/api/email/scan-all. One restaurant's failure is
 * recorded in the summary and never stops the others.
 */
async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — scheduled syncs are off' },
      { status: 500 }
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  // Restaurants with a Clover merchant AND some credential (OAuth
  // token or manual key). Fall back to the pre-sql/012 column set
  // when the encrypted-token column doesn't exist yet.
  let rows: Array<{ restaurant_id: string }> | null
  const wide = await sb
    .from('restaurant_settings')
    .select('restaurant_id')
    .not('clover_merchant_id', 'is', null)
    .or('clover_token_enc.not.is.null,clover_api_key.not.is.null')
  if (wide.error) {
    const legacy = await sb
      .from('restaurant_settings')
      .select('restaurant_id')
      .not('clover_merchant_id', 'is', null)
      .not('clover_api_key', 'is', null)
    if (legacy.error) {
      return NextResponse.json({ error: legacy.error.message }, { status: 500 })
    }
    rows = legacy.data
  } else {
    rows = wide.data
  }

  // Trial gate: the daily sync skips restaurants whose trial
  // ended without a card (lapsed-account freeze). Sales stay in
  // Clover and sync again after subscribing.
  const gated = await fetchGatedIds(
    sb,
    (rows ?? []).map((r) => r.restaurant_id as string)
  )

  const summary: Array<Record<string, unknown>> = []
  for (const row of rows ?? []) {
    const restaurantId = row.restaurant_id as string
    if (gated.has(restaurantId)) {
      summary.push({ restaurant_id: restaurantId, skipped: 'trial_ended' })
      continue
    }
    try {
      const result = await syncRestaurantClover(sb, restaurantId)
      summary.push({ restaurant_id: restaurantId, ...result })
    } catch (e) {
      summary.push({
        restaurant_id: restaurantId,
        error: e instanceof Error ? e.message : 'sync failed',
      })
    }
  }
  return NextResponse.json({ restaurants: summary.length, summary })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
