import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchTrialGated } from '@/lib/billing-gate'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const WEBHOOK_SECRET = process.env.MISE_EMAIL_WEBHOOK_SECRET!

interface AttachmentIn {
  filename: string
  drive_file_id: string
  mime_type?: string
  size?: number
}

interface RequestBody {
  restaurant_id: string
  sender: string
  subject?: string
  received_at?: string
  email_message_id?: string
  attachments: AttachmentIn[]
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_KEY not set' }, { status: 500 })
  }
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'MISE_EMAIL_WEBHOOK_SECRET not set' }, { status: 500 })
  }

  const provided = req.headers.get('x-mise-webhook-secret')
  if (provided !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { restaurant_id, sender, attachments } = body
  if (!restaurant_id || !sender || !Array.isArray(attachments) || attachments.length === 0) {
    return NextResponse.json(
      { error: 'restaurant_id, sender, and non-empty attachments are required' },
      { status: 400 },
    )
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Trial gate: intake pauses for a restaurant whose trial ended
  // without a card (the standard lapsed-account freeze). A 200
  // with a skip marker, so callers don't retry — the original
  // email stays in the owner's mailbox and can be re-sent after
  // subscribing.
  if (await fetchTrialGated(sb, restaurant_id)) {
    return NextResponse.json({ inserted: 0, skipped: 0, gated: 'trial_ended' })
  }

  // Resolve vendor_id from sender against vendor_aliases.sender_pattern.
  // Considers global aliases (restaurant_id IS NULL) + restaurant-scoped ones.
  // Multiple matches: pick the longest pattern (most specific).
  const { data: aliases } = await sb
    .from('vendor_aliases')
    .select('vendor_id, sender_pattern, restaurant_id')
    .or(`restaurant_id.eq.${restaurant_id},restaurant_id.is.null`)
    .not('sender_pattern', 'is', null)

  const senderLower = sender.toLowerCase()
  const matched = (aliases ?? [])
    .filter((a): a is { vendor_id: string; sender_pattern: string; restaurant_id: string | null } =>
      Boolean(a.sender_pattern) && senderLower.includes(a.sender_pattern!.toLowerCase()),
    )
    .sort((a, b) => b.sender_pattern.length - a.sender_pattern.length)
  const vendor_id = matched[0]?.vendor_id ?? null

  const rows = attachments.map((a) => ({
    restaurant_id,
    drive_file_id: a.drive_file_id,
    filename: a.filename,
    source: 'email' as const,
    vendor_id,
    status: 'pending' as const,
  }))

  // drive_file_id is UNIQUE → upsert with ignoreDuplicates handles re-deliveries.
  const { data: inserted, error } = await sb
    .from('invoice_files')
    .upsert(rows, { onConflict: 'drive_file_id', ignoreDuplicates: true })
    .select('id, drive_file_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const insertedCount = inserted?.length ?? 0
  const skippedCount = rows.length - insertedCount

  if (insertedCount > 0) {
    await sb.from('processing_logs').insert({
      restaurant_id,
      stage: 'intake',
      status: 'success',
      message: `Email ingest from ${sender}: ${insertedCount} file(s) queued, ${skippedCount} dup(s) skipped${vendor_id ? '' : ' (no vendor match)'}`,
    })
  }

  return NextResponse.json({
    inserted: insertedCount,
    skipped: skippedCount,
    vendor_id,
    vendor_matched: vendor_id != null,
  })
}
