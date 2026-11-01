import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  downloadWhatsappMedia,
  sendWhatsappText,
  verifyWhatsappSignature,
  whatsappConfigured,
  whatsappVerifyToken,
} from '@/lib/whatsapp'
import { importWhatsappInvoice } from '@/lib/whatsapp-intake'

/*
 * WhatsApp intake webhook (Meta WhatsApp Business Platform).
 *
 * GET  — Meta's verification handshake (hub.challenge echo).
 * POST — message deliveries. Signature-checked when the app
 * secret is configured. Each message is claimed in
 * whatsapp_messages by its wamid before any work happens, so
 * Meta's retries can never double-import an invoice.
 *
 * Routing: the sender's phone number must be registered in
 * whatsapp_senders (Settings → WhatsApp invoices); it files into
 * exactly one restaurant and lands in Review (untrusted channel).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

type WaMessage = {
  from?: string
  id?: string
  type?: string
  image?: { id?: string; mime_type?: string }
  document?: { id?: string; mime_type?: string; filename?: string }
  text?: { body?: string }
}

type WaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WaMessage[]
        metadata?: { phone_number_id?: string }
      }
    }>
  }>
}

export async function GET(req: NextRequest) {
  const token = whatsappVerifyToken()
  if (!token) {
    return NextResponse.json(
      { error: 'WHATSAPP_VERIFY_TOKEN not set' },
      { status: 500 }
    )
  }
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const provided = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (mode === 'subscribe' && provided === token && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 })
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
}

async function setLog(
  sb: SupabaseClient,
  wamid: string,
  patch: Record<string, unknown>
) {
  await sb
    .from('whatsapp_messages')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('wa_message_id', wamid)
}

async function reply(to: string, body: string) {
  try {
    await sendWhatsappText(to, body)
  } catch (e) {
    console.error('whatsapp reply failed', e)
  }
}

async function processMessage(sb: SupabaseClient, msg: WaMessage) {
  const wamid = msg.id
  const from = msg.from
  if (!wamid || !from) return

  // Claim the delivery. A unique-violation means Meta re-sent a
  // message we already hold: skip it unless the earlier attempt
  // died mid-processing (>3 min in 'processing').
  const { error: claimError } = await sb.from('whatsapp_messages').insert({
    wa_message_id: wamid,
    sender_phone: from,
    status: 'processing',
  })
  if (claimError) {
    const { data: existing } = await sb
      .from('whatsapp_messages')
      .select('status, created_at')
      .eq('wa_message_id', wamid)
      .maybeSingle()
    const stale =
      existing?.status === 'processing' &&
      Date.now() - new Date(existing.created_at as string).getTime() > 3 * 60 * 1000
    if (!stale) return
    await setLog(sb, wamid, { status: 'processing', detail: 'retry takeover' })
  }

  // Route by sender number.
  const { data: sender } = await sb
    .from('whatsapp_senders')
    .select('restaurant_id')
    .eq('phone', from)
    .maybeSingle()
  const restaurantId = (sender?.restaurant_id as string | undefined) ?? null
  await setLog(sb, wamid, { restaurant_id: restaurantId })

  if (!restaurantId) {
    await setLog(sb, wamid, {
      status: 'ignored',
      detail: 'sender number not registered',
    })
    await reply(
      from,
      "This number isn't registered with an getinvoiceIQ restaurant yet, so I can't file receipts from it. Ask the owner to add your number in getinvoiceIQ Settings → WhatsApp invoices."
    )
    return
  }

  const media =
    msg.type === 'image' && msg.image?.id
      ? { id: msg.image.id, mime: msg.image.mime_type || 'image/jpeg', filename: `whatsapp-${wamid}.jpg` }
      : msg.type === 'document' && msg.document?.id
        ? {
            id: msg.document.id,
            mime: msg.document.mime_type || 'application/pdf',
            filename: msg.document.filename || `whatsapp-${wamid}.pdf`,
          }
        : null

  if (!media) {
    await setLog(sb, wamid, { status: 'ignored', detail: `type=${msg.type ?? 'unknown'}` })
    await reply(
      from,
      'Send me a photo or PDF of a supplier invoice and I will read it into your Review queue. Text messages I can only answer with this note.'
    )
    return
  }

  await setLog(sb, wamid, { media_id: media.id })

  let downloaded
  try {
    downloaded = await downloadWhatsappMedia(media.id)
  } catch (e) {
    await setLog(sb, wamid, {
      status: 'error',
      detail: e instanceof Error ? e.message : 'media download failed',
    })
    await reply(from, "I couldn't download that file from WhatsApp. Please try sending it once more.")
    return
  }

  const result = await importWhatsappInvoice(sb, {
    restaurantId,
    bytes: downloaded.bytes,
    mime: downloaded.mime || media.mime,
    filename: media.filename,
    waMessageId: wamid,
  })

  if (result.outcome === 'imported') {
    await setLog(sb, wamid, {
      status: 'processed',
      detail: `${result.vendorName} $${result.total.toFixed(2)} (${result.itemCount} items)`,
    })
    await reply(
      from,
      `Got it — ${result.vendorName} · $${result.total.toFixed(2)} · ${result.itemCount} items. It's in Review for approval.`
    )
  } else if (result.outcome === 'duplicate') {
    await setLog(sb, wamid, { status: 'duplicate', detail: 'already imported' })
    await reply(from, 'That receipt is already in getinvoiceIQ — skipped it as a duplicate.')
  } else {
    await setLog(sb, wamid, { status: 'error', detail: result.message })
    await reply(
      from,
      "I couldn't read that one. Try a clearer, straight-on photo — or upload it in the app and I'll take it from there."
    )
  }
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_KEY not set' }, { status: 500 })
  }
  if (!whatsappConfigured()) {
    return NextResponse.json(
      { error: 'WhatsApp intake is not configured' },
      { status: 503 }
    )
  }

  const raw = await req.text()
  if (!verifyWhatsappSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.warn('whatsapp webhook: WHATSAPP_APP_SECRET not set — signature check skipped (test mode)')
  }

  let payload: WaPayload
  try {
    payload = JSON.parse(raw) as WaPayload
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const sb = serviceClient()
  const messages: WaMessage[] = []
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) messages.push(m)
    }
  }

  for (const msg of messages) {
    try {
      await processMessage(sb, msg)
    } catch (e) {
      console.error('whatsapp message processing failed', msg.id, e)
      if (msg.id) {
        await setLog(sb, msg.id, {
          status: 'error',
          detail: e instanceof Error ? e.message : 'processing failed',
        }).catch(() => {})
      }
    }
  }

  // Always 200 once the payload is accepted: Meta retries on
  // non-200s, and per-message outcomes are recorded in the log.
  return NextResponse.json({ received: messages.length })
}
