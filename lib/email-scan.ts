import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from './token-crypto'
import {
  extractEmailAddress,
  getAttachmentBytes,
  getMessage,
  listMessagesWithAttachments,
  refreshGoogleAccessToken,
} from './gmail'
import { parseInvoiceBytes } from './parse-invoice'
import { reviewFlagsFor } from './review-flags'
import { loadCategoryMemory, applyCategoryMemory } from './category-memory'

/*
 * Email scanner core. For one restaurant with a connected mailbox:
 * find recent emails with attachments, keep the ones that look like
 * supplier invoices (sender matches a known supplier alias, or the
 * subject/filename says invoice/receipt/statement), download each
 * attachment, dedupe (Gmail message id + content hash — the hash
 * check happens BEFORE the AI parse so duplicates are free), parse,
 * and save through the same records the upload flow creates —
 * including vendor registration and the review-queue flags.
 */

export type ScanResult = {
  scanned: number
  imported: number
  flagged: number
  skipped: number
  errors: string[]
}

const PARSEABLE = (mime: string, filename: string) =>
  mime === 'application/pdf' ||
  mime.startsWith('image/') ||
  mime === 'text/csv' ||
  /\.(pdf|png|jpe?g|webp|gif|csv)$/i.test(filename)

const GENERIC_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'live.com',
  'msn.com',
])

// Senders whose "invoices" are the restaurant's OWN bills, never
// supplier invoices. A connected mailbox is usually a mixed
// personal/business inbox (Anthropic, Apple, H&M receipts...) and
// the subject-keyword filter alone happily imports those, so known
// consumer/billing senders are skipped before parsing. Starter list.
const NON_SUPPLIER_DOMAINS = new Set([
  'anthropic.com',
  'openai.com',
  'apple.com',
  'hm.com',
  'paypal.com',
  'stripe.com',
  'adobe.com',
  'microsoft.com',
  'intuit.com',
  'google.com',
])

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'vendor'
  )
}

type SettingsRow = {
  mailbox_token_enc: string | null
  mailbox_last_scan_at: string | null
}

export async function scanRestaurantMailbox(
  sb: SupabaseClient,
  restaurantId: string
): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, imported: 0, flagged: 0, skipped: 0, errors: [] }

  const { data: settings, error: settingsError } = await sb
    .from('restaurant_settings')
    .select('mailbox_token_enc, mailbox_last_scan_at')
    .eq('restaurant_id', restaurantId)
    .single()
  if (settingsError) {
    throw new Error(
      settingsError.message.includes('mailbox_token_enc')
        ? 'migration_needed'
        : settingsError.message
    )
  }
  const row = settings as SettingsRow
  if (!row?.mailbox_token_enc) throw new Error('mailbox_not_connected')

  const scanStart = new Date()
  const pack = JSON.parse(decryptToken(row.mailbox_token_enc)) as {
    refresh_token?: string
  }
  if (!pack.refresh_token) throw new Error('mailbox_not_connected')
  const accessToken = await refreshGoogleAccessToken(pack.refresh_token)

  // 48h overlap behind the last scan: messages that failed to parse
  // (or arrived mid-scan) get retried instead of being skipped
  // forever once last_scan_at moves past them. Imports are deduped
  // by Gmail message id + content hash, so re-seeing a message that
  // already imported is a cheap no-op.
  const since = row.mailbox_last_scan_at
    ? new Date(new Date(row.mailbox_last_scan_at).getTime() - 48 * 60 * 60 * 1000)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const messageIds = await listMessagesWithAttachments(
    accessToken,
    Math.floor(since.getTime() / 1000)
  )

  // Supplier recognition: sender patterns from vendor_aliases
  // (global + this restaurant's), plus the vendor directory for
  // turning a matched alias into a display name.
  const { data: aliasRows } = await sb
    .from('vendor_aliases')
    .select('vendor_id, sender_pattern')
    .not('sender_pattern', 'is', null)
    .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
  const patterns = (aliasRows ?? [])
    .filter((a) => a.sender_pattern)
    .map((a) => ({
      vendorId: a.vendor_id as string,
      pattern: (a.sender_pattern as string).toLowerCase(),
    }))
  const { data: vendorRows } = await sb.from('vendors').select('id, display_name')
  const vendorNameById = new Map<string, string>(
    (vendorRows ?? []).map((v) => [v.id as string, v.display_name as string])
  )
  const vendorIdByName = new Map<string, string>(
    (vendorRows ?? []).map((v) => [
      (v.display_name as string).toLowerCase(),
      v.id as string,
    ])
  )

  async function ensureVendorLink(vendorId: string) {
    await sb
      .from('restaurant_vendors')
      .upsert(
        { restaurant_id: restaurantId, vendor_id: vendorId },
        { onConflict: 'restaurant_id,vendor_id', ignoreDuplicates: true }
      )
  }

  async function registerVendor(
    displayName: string,
    aliasText: string | null,
    senderDomain: string | null
  ): Promise<{ id: string; name: string }> {
    const byName = vendorIdByName.get(displayName.toLowerCase())
    if (byName) {
      await ensureVendorLink(byName)
      return { id: byName, name: vendorNameById.get(byName) ?? displayName }
    }
    const key = `${slugify(displayName)}_r${restaurantId.replace(/-/g, '').slice(0, 8)}`
    const { data: created } = await sb
      .from('vendors')
      .upsert(
        {
          name: key,
          display_name: displayName,
          ingestion_method: 'email',
          is_global: false,
          notes: 'Auto-created by the email scanner',
        },
        { onConflict: 'name' }
      )
      .select('id')
      .single()
    let vendorId = created?.id as string | undefined
    if (!vendorId) {
      const { data: existing } = await sb
        .from('vendors')
        .select('id')
        .eq('name', key)
        .single()
      vendorId = existing?.id
    }
    if (!vendorId) return { id: '', name: displayName }
    vendorNameById.set(vendorId, displayName)
    vendorIdByName.set(displayName.toLowerCase(), vendorId)
    await ensureVendorLink(vendorId)
    if (aliasText && aliasText.toLowerCase() !== displayName.toLowerCase()) {
      await sb.from('vendor_aliases').insert({
        vendor_id: vendorId,
        alias_text: aliasText,
        restaurant_id: restaurantId,
        confidence: 'data_inferred',
      })
    }
    if (senderDomain && !GENERIC_DOMAINS.has(senderDomain)) {
      await sb.from('vendor_aliases').insert({
        vendor_id: vendorId,
        sender_pattern: `@${senderDomain}`,
        restaurant_id: restaurantId,
        confidence: 'data_inferred',
      })
    }
    return { id: vendorId, name: displayName }
  }

  for (const messageId of messageIds) {
    try {
      const msg = await getMessage(accessToken, messageId)
      result.scanned++
      const senderEmail = extractEmailAddress(msg.from)
      const senderDomain = senderEmail.split('@')[1] ?? ''
      const matchedPattern = patterns.find((p) =>
        p.pattern.startsWith('@')
          ? senderEmail.endsWith(p.pattern)
          : senderEmail.includes(p.pattern)
      )
      const looksLikeInvoice = /invoice|receipt|statement|bill/i.test(msg.subject)
      if (NON_SUPPLIER_DOMAINS.has(senderDomain)) {
        result.skipped++
        continue
      }

      for (const att of msg.attachments) {
        if (!PARSEABLE(att.mimeType, att.filename)) {
          result.skipped++
          continue
        }
        if (
          !matchedPattern &&
          !looksLikeInvoice &&
          !/invoice|receipt|statement/i.test(att.filename)
        ) {
          result.skipped++
          continue
        }

        const fileKey = `gmail-${messageId}-${att.attachmentId}`
        const { data: dupe } = await sb
          .from('invoice_files')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('drive_file_id', fileKey)
          .maybeSingle()
        if (dupe) {
          result.skipped++
          continue
        }

        const bytes = await getAttachmentBytes(accessToken, messageId, att.attachmentId)
        const sha = createHash('sha256').update(bytes).digest('hex')
        const { data: hashDupe } = await sb
          .from('invoice_files')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('content_sha256', sha)
          .maybeSingle()
        if (hashDupe) {
          result.skipped++
          continue
        }

        let parsed
        try {
          parsed = await parseInvoiceBytes(bytes, att.mimeType)
        } catch (e) {
          result.errors.push(
            `${att.filename}: ${e instanceof Error ? e.message : 'parse failed'}`
          )
          continue
        }

        // Supplier-likeness: a real supplier invoice has at least
        // one line the categorizer recognizes (food, packaging...).
        // A personal bill (software, clothing, utilities) parses to
        // all-"Other" lines — those get quarantined below instead
        // of being registered as suppliers.
        const supplierLike =
          parsed.items.length > 0 &&
          parsed.items.some((i) => i.category && i.category !== 'Other')

        // Vendor: the sender match beats whatever the AI read.
        let vendorId = ''
        let vendorName = (parsed.vendor || 'Unknown').trim()
        if (matchedPattern) {
          vendorId = matchedPattern.vendorId
          vendorName = vendorNameById.get(vendorId) ?? vendorName
          await ensureVendorLink(vendorId)
        } else if (vendorName && vendorName.toLowerCase() !== 'unknown' && supplierLike) {
          const reg = await registerVendor(vendorName, parsed.vendor, senderDomain || null)
          vendorId = reg.id
          vendorName = reg.name
        }

        const total =
          parsed.total ?? parsed.items.reduce((s, i) => s + (i.total || 0), 0)
        const { data: fileRow, error: fileError } = await sb
          .from('invoice_files')
          .insert({
            restaurant_id: restaurantId,
            drive_file_id: fileKey,
            filename: att.filename,
            file_date: parsed.invoice_date,
            file_total: total,
            status: 'done',
            source: 'email',
            vendor_id: vendorId || null,
            content_sha256: sha,
            processed_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        if (fileError || !fileRow) {
          result.errors.push(`${att.filename}: ${fileError?.message ?? 'file save failed'}`)
          continue
        }

        // Per-supplier category memory (shared lib, same as uploads):
        // repeat items inherit the category past approved invoices
        // from this supplier were saved with.
        const catMem = await loadCategoryMemory(sb, restaurantId)
        if (catMem.size > 0) {
          parsed.items = applyCategoryMemory(
            { ...parsed, vendor: vendorName },
            catMem
          ).items
        }

        const flags = reviewFlagsFor(parsed)
        if (!matchedPattern && !supplierLike) {
          flags.push('Unrecognized sender — confirm this is a supplier invoice')
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
        }
        // Email is an untrusted channel: EVERY scanned invoice waits
        // in the review queue for the owner's approval before it
        // counts in the books, whatever the reconciliation checks
        // say. (Direct uploads still flow straight in unless their
        // numbers don't reconcile.)
        headerPayload.review_status = 'needs_review'
        headerPayload.review_reason =
          flags.length > 0
            ? `Email scan: ${flags.join('; ')}`
            : 'Email scan: awaiting approval'
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
          result.errors.push(
            `${att.filename}: ${headerError?.message ?? 'invoice save failed'}`
          )
          continue
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
            item.purchase_unit === 'lb' || item.purchase_unit === 'each'
              ? item.quantity
              : 0,
          case_qty: item.purchase_unit === 'case' ? item.quantity : 0,
          unit_price: item.unit_price,
          total: item.total,
          canonical_item_id: null as string | null,
        }))
        // Resolve lines to the canonical catalog (see upload path).
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
          result.errors.push(`${att.filename}: ${linesError.message}`)
          continue
        }

        result.imported++
        result.flagged++
      }
    } catch (e) {
      result.errors.push(
        `message ${messageId}: ${e instanceof Error ? e.message : 'scan failed'}`
      )
    }
  }

  await sb
    .from('restaurant_settings')
    .update({ mailbox_last_scan_at: scanStart.toISOString() })
    .eq('restaurant_id', restaurantId)

  return result
}
