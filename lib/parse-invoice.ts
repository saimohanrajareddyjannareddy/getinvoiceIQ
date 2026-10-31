import { categorize } from './categorize'

/*
 * Invoice extraction core, shared by the upload route and the email
 * scanner. Bytes + MIME type in, structured invoice out (Claude
 * vision/document parsing, then the same item normalization the
 * upload flow has always applied).
 */

export type ParsedItem = {
  item_name: string
  display_name: string
  category: string
  quantity: number
  purchase_unit: string
  unit_price: number
  total: number
}

export type ParsedInvoice = {
  vendor: string
  invoice_number: string | null
  invoice_date: string | null
  subtotal: number | null
  tax: number | null
  total: number | null
  items: ParsedItem[]
}

const SYSTEM_PROMPT = `You are an invoice parser. Extract all line items from the invoice and return ONLY valid JSON.

Output this exact schema (no markdown, no explanation):
{
  "vendor": "vendor name",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "subtotal": number or null,
  "tax": number or null,
  "total": number or null,
  "items": [
    {
      "item_name": "exact name from invoice",
      "display_name": "clean readable name (expand abbreviations, proper case)",
      "quantity": number,
      "purchase_unit": "lb | each | case",
      "unit_price": number,
      "total": number,
      "category": "Proteins | Produce | Dairy | Dry Goods | Beverages | Packaging | Cleaning | Other"
    }
  ]
}

Rules:
- category: judge by what the item IS — meats and seafood → Proteins; milk, cheese, butter, yogurt, paneer, cream, eggs → Dairy; fresh vegetables, fruits and herbs → Produce; rice, flour, spices, masalas, oils, nuts, canned goods and other shelf-stable foods → Dry Goods; drinks → Beverages; containers, cups, bags, foil → Packaging; soaps and cleaning chemicals → Cleaning; anything else → Other
- purchase_unit: "lb" if sold by weight, "case" if sold as a case of multiple units, "each" for everything else
- Skip non-product rows: taxes, fees, subtotals, payment rows, tips
- display_name: expand abbreviations (SHR→Shrimp, CHIX→Chicken, BTR→Butter, BNLS→Boneless, BRST→Breast, THGH→Thigh, PROD→remove, FZ→Frozen, GARLC→Garlic, HAL→Halal, etc.)
- Negative lines are NOT all the same — read them carefully:
  - DISCOUNT: a line with quantity 0 (or no quantity) and a negative amount naming an item that is also purchased on this invoice is a price discount on that item (Restaurant Depot prints e.g. "0  25  -$19.40", meaning 25% off the item above). Do NOT emit it as its own item — subtract it from the matching item's total and recompute that item's unit_price; its quantity does not change.
  - RETURN: a line with a NEGATIVE quantity is goods the buyer gave back. Net it against the matching purchased item: reduce that item's quantity and total by the returned amounts, and if the net quantity reaches 0, omit the item entirely. Emit a standalone negative item ONLY when the returned item was not purchased on this same invoice. A PARTIAL return (returned quantity smaller than purchased quantity) still leaves the item on the invoice with its remaining quantity and total — e.g. bought 2 cases for $126.80, returned 1 case for $63.40 → the item stays: quantity 1 case, total $63.40. Never drop a partially returned item. Returns can appear ANYWHERE in the receipt — including between two purchases of the same item — not only at the end; check every single line for a negative quantity.
  - "Previous Balance" and similar account-balance rows are not products and are not part of this invoice's subtotal — skip them entirely.
- If quantity is missing assume 1
- All numbers as floats, no currency symbols`

/* Handwriting digit confusions, both directions. */
const CONFUSION_PAIRS: Record<string, string[]> = {
  '3': ['5', '8'],
  '5': ['3', '6'],
  '8': ['3', '0'],
  '6': ['5', '0'],
  '0': ['6', '8'],
  '1': ['7'],
  '7': ['1'],
}

/* Every number reachable from n by swapping ONE digit of its
 * 2-decimal form for a commonly confused handwritten digit. */
function digitVariants(n: number): number[] {
  const s = n.toFixed(2)
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const alts = CONFUSION_PAIRS[s[i]]
    if (!alts) continue
    for (const alt of alts) {
      const v = parseFloat(s.slice(0, i) + alt + s.slice(i + 1))
      if (Number.isFinite(v) && v !== n) out.push(v)
    }
  }
  return out
}

/*
 * Reconciliation repair: if the items don't add up to the stated
 * subtotal, but a SINGLE digit confusion in ONE line explains the
 * whole difference, apply it. The corrected unit price must carry
 * the same confused digit and still multiply out to the corrected
 * total (on paper slips the price and amount columns are the same
 * handwriting read twice — a real fix is consistent across both).
 * Only a unique fix is applied; anything ambiguous is left alone
 * and the review queue catches it, as before.
 */
function repairReconciliation(parsed: ParsedInvoice): void {
  const items = parsed.items || []
  if (items.length === 0) return
  // The target is the SUBTOTAL — line items are pre-tax amounts, so
  // they can only ever add up to the subtotal. (This used to aim at
  // the tax-inclusive total, which sent the repair hunting for a
  // digit fix to bridge the tax gap on every taxed invoice.) When
  // the subtotal wasn't read, reconstruct it as total - tax.
  const target =
    parsed.subtotal ??
    (parsed.total != null && parsed.tax != null
      ? parsed.total - parsed.tax
      : parsed.total)
  if (target == null) return
  const sum = items.reduce((s, i) => s + (i.total || 0), 0)
  if (Math.abs(target - sum) <= 0.02) return

  type Fix = { idx: number; newTotal: number; newUnit: number }
  const fixes: Fix[] = []
  items.forEach((item, idx) => {
    const total = item.total || 0
    const unit = item.unit_price || 0
    const qty = item.quantity || 1
    const unitOptions = [unit, ...digitVariants(unit)]
    for (const candTotal of digitVariants(total)) {
      if (Math.abs(sum - total + candTotal - target) > 0.02) continue
      for (const candUnit of unitOptions) {
        if (Math.abs(qty * candUnit - candTotal) <= 0.02) {
          fixes.push({ idx, newTotal: candTotal, newUnit: candUnit })
        }
      }
    }
  })
  if (fixes.length !== 1) return
  const f = fixes[0]
  items[f.idx].total = f.newTotal
  items[f.idx].unit_price = f.newUnit
}

const KNOWN_CATEGORIES = ['Proteins', 'Produce', 'Dairy', 'Dry Goods', 'Beverages', 'Packaging', 'Cleaning', 'Credits', 'Other']
const CATEGORY_ALIASES: Record<string, string> = {
  protein: 'Proteins', meat: 'Proteins', meats: 'Proteins', seafood: 'Proteins',
  vegetable: 'Produce', vegetables: 'Produce', fruit: 'Produce', fruits: 'Produce',
  pantry: 'Dry Goods', spice: 'Dry Goods', spices: 'Dry Goods', grocery: 'Dry Goods', groceries: 'Dry Goods', frozen: 'Dry Goods',
  beverage: 'Beverages', drink: 'Beverages', drinks: 'Beverages',
  supplies: 'Packaging', disposable: 'Packaging', disposables: 'Packaging', janitorial: 'Cleaning',
}

/*
 * Category resolution: the AI reader judges by what an item IS (it
 * knows okra is produce and cashews are dry goods); the dictionary
 * knows the house vocabulary for supplier codes. A known AI label
 * wins, then the dictionary, then any specific AI label, else Other.
 */
function resolveCategory(aiCategory: string | undefined, itemName: string): string {
  const raw = (aiCategory || '').trim()
  if (raw) {
    const known = KNOWN_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase())
    if (known) return known
    const alias = CATEGORY_ALIASES[raw.toLowerCase()]
    if (alias) return alias
  }
  const dict = categorize(itemName)
  if (dict !== 'Other') return dict
  return raw && raw.toLowerCase() !== 'other' ? raw : 'Other'
}

/* ------------------------------------------------------------------ */
/* Post-processing shared by both readers: category assignment,       */
/* display-name fallback, qty x price completion, and the discount    */
/* backstop.                                                          */
/* ------------------------------------------------------------------ */
function postProcess(parsed: ParsedInvoice): ParsedInvoice {
  for (const item of parsed.items || []) {
    item.category = resolveCategory(item.category, item.item_name || '')
    item.display_name = item.display_name || item.item_name
    item.purchase_unit = item.purchase_unit || 'each'
    const qty = item.quantity || 1
    const price = item.unit_price || 0
    const total = item.total || 0
    if (price && !total) item.total = Math.round(price * qty * 100) / 100
    else if (total && !price)
      item.unit_price = Math.round((total / qty) * 10000) / 10000
  }

  repairReconciliation(parsed)

  // Discount backstop: a negative line with quantity 0 naming a
  // purchased item is a register discount (see the prompt rules) —
  // fold it into that item even if the model emitted it separately.
  // Genuine returns carry a negative quantity and are left alone.
  if (parsed.items) {
    const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const kept: typeof parsed.items = []
    for (const item of parsed.items) {
      if ((item.total || 0) < 0 && !item.quantity) {
        const parent = kept.find(
          (k) => (k.total || 0) > 0 && norm(k.item_name) === norm(item.item_name)
        )
        if (parent) {
          parent.total = Math.round(((parent.total || 0) + item.total) * 100) / 100
          const q = parent.quantity || 1
          parent.unit_price = Math.round((parent.total / q) * 10000) / 10000
          continue
        }
      }
      kept.push(item)
    }
    parsed.items = kept
  }

  return parsed
}

/* ------------------------------------------------------------------ */
/* Restaurant Depot CSV exports: deterministic parse.                 */
/*                                                                    */
/* The register's negative-line math is pure arithmetic, and the AI   */
/* reader intermittently drops a return that sits BETWEEN purchases   */
/* of the same item — so for this exact export shape the numbers are  */
/* computed in code instead: purchases and returns net by quantity,   */
/* qty-0 negative rows (the case column holds a percent) fold in as   */
/* discounts, Previous Balance is skipped, and Sub-Total/Tax/Total    */
/* are read straight from the trailer rows. Anything that is not      */
/* this shape returns null and the AI reader handles it.              */
/* ------------------------------------------------------------------ */

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function moneyOf(s: string): number {
  const n = parseFloat((s || '').replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const NAME_TOKENS: Record<string, string> = {
  CHIX: 'Chicken', BNLS: 'Boneless', BRST: 'Breast', THGH: 'Thigh', HAL: 'Halal',
  SHR: 'Shrimp', BTR: 'Butter', CHS: 'Cheese', YOG: 'Yogurt', GARLC: 'Garlic',
  FZ: 'Frozen', PROD: '', PD: '', JF: '', CQ: '',
}

function expandName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => {
      const mapped = NAME_TOKENS[w.toUpperCase()]
      if (mapped !== undefined) return mapped
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .filter(Boolean)
    .join(' ')
}

function tryParseRdCsv(bytes: Buffer): ParsedInvoice | null {
  const text = bytes.toString('utf-8')
  if (!/Restaurant Depot/i.test(text)) return null
  const rows = parseCsvRows(text)
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => c.trim() === 'UPC') && r.some((c) => c.trim() === 'Unit Qty')
  )
  if (headerIdx < 0) return null

  let invoiceNumber: string | null = null
  let invoiceDate: string | null = null
  for (const r of rows.slice(0, headerIdx)) {
    for (const cell of r) {
      const inv = cell.match(/Invoice:\s*(\S+)/i)
      if (inv) invoiceNumber = inv[1]
      const dt = cell.match(/(\d{4})\/(\d{2})\/(\d{2})/)
      if (dt) invoiceDate = `${dt[1]}-${dt[2]}-${dt[3]}`
    }
  }

  let subtotal: number | null = null
  let tax: number | null = null
  let total: number | null = null

  type Group = { item_name: string; quantity: number; purchase_unit: string; total: number }
  const groups = new Map<string, Group>()

  for (const r of rows.slice(headerIdx + 1)) {
    const [upcRaw, descRaw, unitQtyRaw, caseQtyRaw, priceRaw] = r
    const upc = (upcRaw || '').trim()
    const desc = (descRaw || '').trim()
    const price = moneyOf(priceRaw || '')

    if (upc === '0' || !desc) {
      const label = desc.toLowerCase()
      if (label === 'sub-total' || label === 'subtotal') subtotal = price
      else if (label === 'tax') tax = price
      else if (label === 'total') total = price
      continue
    }
    if (/previous balance/i.test(desc)) continue

    const unitQty = parseFloat(unitQtyRaw || '0') || 0
    const caseQty = parseFloat(caseQtyRaw || '0') || 0
    const key = `${upc}|${desc.toLowerCase()}`
    const g = groups.get(key) ?? { item_name: desc, quantity: 0, purchase_unit: 'each', total: 0 }

    if (unitQty === 0 && caseQty > 0 && price < 0) {
      // Register discount — folds into cost; quantity untouched.
      g.total += price
    } else if (unitQty !== 0) {
      g.quantity += unitQty
      g.total += price
      if (unitQty > 0) g.purchase_unit = upc.startsWith('2') ? 'lb' : 'each'
    } else if (caseQty !== 0) {
      g.quantity += caseQty
      g.total += price
      if (caseQty > 0) g.purchase_unit = 'case'
    }
    groups.set(key, g)
  }

  const items: ParsedItem[] = []
  for (const g of groups.values()) {
    if (g.quantity <= 0) continue // fully returned
    const totalRounded = Math.round(g.total * 100) / 100
    items.push({
      item_name: g.item_name,
      display_name: expandName(g.item_name),
      category: '',
      quantity: g.quantity,
      purchase_unit: g.purchase_unit,
      unit_price: Math.round((totalRounded / g.quantity) * 10000) / 10000,
      total: totalRounded,
    })
  }
  if (items.length === 0) return null
  return {
    vendor: 'Restaurant Depot',
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    subtotal,
    tax,
    total,
    items,
  }
}

export async function parseInvoiceBytes(
  bytes: Buffer,
  mime: string
): Promise<ParsedInvoice> {
  // RD CSV exports are parsed deterministically (see above); every
  // other shape goes to the AI reader.
  if (mime === 'text/csv' || mime === 'text/plain') {
    const det = tryParseRdCsv(bytes)
    if (det) return postProcess(det)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment')

  const base64 = bytes.toString('base64')
  let contentBlock: Record<string, unknown>
  if (mime === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    }
  } else if (mime.startsWith('image/')) {
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mime, data: base64 },
    }
  } else {
    contentBlock = {
      type: 'text',
      text: `Invoice content:\n\n${bytes.toString('utf-8')}`,
    }
  }

  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: 'Parse this invoice and return the JSON.' },
          ],
        },
      ],
    }),
  })

  if (!claudeResp.ok) {
    const err = await claudeResp.text()
    throw new Error(`Claude API error (${claudeResp.status}): ${err}`)
  }

  const result = await claudeResp.json()
  if (result.stop_reason === 'max_tokens') {
    // A many-line invoice overflowed the response budget — say so
    // plainly instead of failing JSON.parse on a truncated string.
    throw new Error(
      'This invoice has too many lines to read in one pass. Try uploading it as two parts.'
    )
  }
  let raw: string = result.content[0].text.trim()
  raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(raw) as ParsedInvoice

  return postProcess(parsed)
}
