import type { ParsedInvoice } from './parse-invoice'

/*
 * Reconciliation checks on an extraction. Any failure flags the
 * invoice for the human review queue at save time — this is how AI
 * misreads (wrong totals, dropped lines) get caught instead of
 * landing silently in the books. Tolerances are loose on purpose:
 * flag real mismatches, not rounding noise. Used by the upload page
 * and the email scanner.
 */
export function reviewFlagsFor(p: ParsedInvoice): string[] {
  const flags: string[] = []
  const lineSum = p.items.reduce((s, i) => s + (i.total || 0), 0)
  // Line items are PRE-TAX amounts: they must add up to the subtotal,
  // not the tax-inclusive total. (The old check compared against
  // p.total, so any invoice whose tax exceeded the tolerance was
  // flagged even when it parsed perfectly.) When the subtotal wasn't
  // read, reconstruct it as total - tax; only when neither exists
  // fall back to comparing against the total.
  const expected =
    p.subtotal ??
    (p.total != null && p.tax != null ? p.total - p.tax : p.total)
  if (
    expected != null &&
    Math.abs(lineSum - expected) > Math.max(0.05, Math.abs(expected) * 0.01)
  ) {
    flags.push(
      `Line items add up to $${lineSum.toFixed(2)} but the invoice subtotal says $${expected.toFixed(2)}`
    )
  }
  const badLines = p.items.filter(
    (i) =>
      i.quantity > 0 &&
      i.unit_price > 0 &&
      Math.abs(i.quantity * i.unit_price - (i.total || 0)) >
        Math.max(0.05, Math.abs(i.total || 0) * 0.02)
  )
  if (badLines.length > 0) {
    flags.push(
      `${badLines.length} line${badLines.length > 1 ? 's have' : ' has'} qty × price that doesn't match the line total`
    )
  }
  if (!p.vendor || p.vendor.trim().toLowerCase() === 'unknown') {
    flags.push('Supplier name could not be read')
  }
  if (!p.invoice_date) {
    flags.push('Invoice date could not be read')
  }
  return flags
}
