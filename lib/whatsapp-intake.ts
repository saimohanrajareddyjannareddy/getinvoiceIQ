import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseInvoiceBytes } from './parse-invoice'
import { reviewFlagsFor } from './review-flags'
import { loadCategoryMemory, applyCategoryMemory } from './category-memory'

/*
 * WhatsApp intake core. One received file (photo or PDF) for one
 * restaurant: dedupe (WhatsApp message id + content hash — the
 * hash check happens BEFORE the AI parse so duplicates are free),
 * parse through the shared pipeline, register the vendor the same
 * way the email scanner does, and save.
 *
 * WhatsApp is an untrusted channel: EVERY import waits in the
 * review queue (needs_review) and counts only after the owner
 * approves it — the same rule as email, unlike direct uploads.
 */

export type WhatsappImportResult =
  | { outcome: 'imported'; vendorName: string; total: number; itemCount: number }
  | { outcome: 'duplicate' }
  | { outcome: 'error'; message: string }

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'vendor'
  )
}

export async function importWhatsappInvoice(
  sb: SupabaseClient,
  input: {
    restaurantId: string
    bytes: Buffer
    mime: string
    filename: string
    waMessageId: string
  }
): Promise<WhatsappImportResult> {
  const { restaurantId, bytes, mime, filename, waMessageId } = input
  const fileKey = `wa-${waMessageId}`

  const { data: dupe } = await sb
    .from('invoice_files')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('drive_file_id', fileKey)
    .maybeSingle()
  if (dupe) return { outcome: 'duplicate' }

  const sha = createHash('sha256').update(bytes).digest('hex')
  const { data: hashDupe } = await sb
    .from('invoice_files')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('content_sha256', sha)
    .maybeSingle()
  if (hashDupe) return { outcome: 'duplicate' }

  let parsed
  try {
    parsed = await parseInvoiceBytes(bytes, mime)
  } catch (e) {
    return {
      outcome: 'error',
      message: e instanceof Error ? e.message : 'parse failed',
    }
  }

  const supplierLike =
    parsed.items.length > 0 &&
    parsed.items.some((i) => i.category && i.category !== 'Other')

  // Vendor registration (mirrors the email scanner): reuse an
  // existing vendor with the same display name, else create one
  // scoped to this restaurant and link it.
  let vendorId = ''
  let vendorName = (parsed.vendor || 'Unknown').trim()
  if (vendorName && vendorName.toLowerCase() !== 'unknown' && supplierLike) {
    const { data: existing } = await sb
      .from('vendors')
      .select('id, display_name')
      .ilike('display_name', vendorName)
      .limit(1)
    if (existing && existing.length > 0) {
      vendorId = existing[0].id as string
      vendorName = existing[0].display_name as string
    } else {
      const key = `${slugify(vendorName)}_r${restaurantId.replace(/-/g, '').slice(0, 8)}`
      const { data: created } = await sb
        .from('vendors')
        .upsert(
          {
            name: key,
            display_name: vendorName,
            ingestion_method: 'whatsapp',
            is_global: false,
            notes: 'Auto-created by the WhatsApp intake',
          },
          { onConflict: 'name' }
        )
        .select('id')
        .single()
      vendorId = (created?.id as string | undefined) ?? ''
      if (!vendorId) {
        const { data: again } = await sb
          .from('vendors')
          .select('id')
          .eq('name', key)
          .single()
        vendorId = (again?.id as string | undefined) ?? ''
      }
    }
    if (vendorId) {
      await sb
        .from('restaurant_vendors')
        .upsert(
          { restaurant_id: restaurantId, vendor_id: vendorId },
          { onConflict: 'restaurant_id,vendor_id', ignoreDuplicates: true }
        )
      const readName = (parsed.vendor || '').trim()
      if (readName && readName !== vendorName) {
        await sb.from('vendor_aliases').insert({
          vendor_id: vendorId,
          alias_text: readName,
          restaurant_id: restaurantId,
          confidence: 'data_inferred',
        })
      }
    }
  }

  const total = parsed.total ?? parsed.items.reduce((s, i) => s + (i.total || 0), 0)
  const { data: fileRow, error: fileError } = await sb
    .from('invoice_files')
    .insert({
      restaurant_id: restaurantId,
      drive_file_id: fileKey,
      filename,
      file_date: parsed.invoice_date,
      file_total: total,
      status: 'done',
      source: 'whatsapp',
      vendor_id: vendorId || null,
      content_sha256: sha,
      processed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (fileError || !fileRow) {
    return { outcome: 'error', message: fileError?.message ?? 'file save failed' }
  }

  // Per-supplier category memory (shared lib, same as uploads):
  // repeat items inherit the category past approved invoices from
  // this supplier were saved with.
  const catMem = await loadCategoryMemory(sb, restaurantId)
  if (catMem.size > 0) {
    parsed.items = applyCategoryMemory(
      { ...parsed, vendor: vendorName },
      catMem
    ).items
  }

  const flags = reviewFlagsFor(parsed)
  if (!supplierLike) {
    flags.push('Unrecognized document — confirm this is a supplier invoice')
  }
  const headerPayload: Record<string, unknown> = {
    restaurant_id: restaurantId,
    file_id: fileRow.id,
    vendor: vendorName,
    invoice_number: parsed.invoice_number,
    invoice_date: parsed.invoice_date,
    subtotal: parsed.subtotal,
    tax: parsed.tax,
    total,
    review_status: 'needs_review',
    review_reason:
      flags.length > 0 ? `WhatsApp: ${flags.join('; ')}` : 'WhatsApp: awaiting approval',
  }
  let { data: header, error: headerError } = await sb
    .from('invoice_headers')
    .insert(headerPayload)
    .select('id')
    .single()
  if (headerError && headerError.message.includes('review_status')) {
    delete headerPayload.review_status
    delete headerPayload.review_reason
    ;({ data: header, error: headerError } = await sb
      .from('invoice_headers')
      .insert(headerPayload)
      .select('id')
      .single())
  }
  if (headerError || !header) {
    return { outcome: 'error', message: headerError?.message ?? 'invoice save failed' }
  }

  const lineItems = parsed.items.map((item) => ({
    header_id: header.id,
    restaurant_id: restaurantId,
    invoice_date: parsed.invoice_date,
    item_name: item.item_name,
    display_name: item.display_name,
    category: item.category,
    purchase_unit: item.purchase_unit,
    unit_qty:
      item.purchase_unit === 'lb' || item.purchase_unit === 'each' ? item.quantity : 0,
    case_qty: item.purchase_unit === 'case' ? item.quantity : 0,
    unit_price: item.unit_price,
    total: item.total,
    canonical_item_id: null as string | null,
  }))
  {
    const resolved = new Map<string, string | null>()
    for (const li of lineItems) {
      if (!resolved.has(li.item_name)) {
        const { data: cid } = await sb.rpc('resolve_canonical_item', {
          p_raw: li.item_name,
          p_restaurant_id: restaurantId,
        })
        resolved.set(li.item_name, (cid as string | null) ?? null)
      }
      li.canonical_item_id = resolved.get(li.item_name) ?? null
    }
  }
  const { error: linesError } = await sb.from('invoice_lines').insert(lineItems)
  if (linesError) {
    return { outcome: 'error', message: linesError.message }
  }

  await sb.from('processing_logs').insert({
    restaurant_id: restaurantId,
    stage: 'intake',
    status: 'success',
    message: `WhatsApp intake: ${filename} → ${vendorName} $${total.toFixed(2)} (${lineItems.length} items, awaiting review)`,
  })

  return {
    outcome: 'imported',
    vendorName,
    total,
    itemCount: lineItems.length,
  }
}
