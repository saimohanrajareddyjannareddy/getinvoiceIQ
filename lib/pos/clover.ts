import type { PosAdapter, PosSaleRow } from './types'
import { computeDailySales, type CloverOrder as RefCloverOrder, type DailySales } from '../clover'

export interface CloverCreds {
  clover_merchant_id: string
  clover_api_key: string
  // 'sandbox' hits the Clover sandbox hosts (OAuth test merchants);
  // anything else uses production. Manual tokens historically always
  // used production, so this stays unset on that path.
  clover_env?: string
}

interface CloverLineItem {
  id?: string
  name?: string
  quantity?: number
  price?: number
  unitName?: string
  modifications?: { elements?: Array<{ name?: string }> }
}

interface CloverOrder {
  id?: string
  createdTime?: number
  lineItems?: { elements?: CloverLineItem[] }
}

// Clover stores price in cents and createdTime in ms-since-epoch.
// sale_date is UTC-derived; restaurant-tz handling is a future TODO once
// the restaurants table carries a tz column.
export const cloverAdapter: PosAdapter<CloverCreds> = {
  source: 'clover',

  async fetchSales({ restaurant_id, creds, sinceTs }) {
    if (!creds.clover_merchant_id || !creds.clover_api_key) {
      throw new Error('Clover credentials missing')
    }

    const apiHost =
    // Sandbox API calls go to sandbox.dev.clover.com — the same host
    // that mints the OAuth tokens. The legacy apisandbox gateway
    // serves base order reads to those tokens but 403s every field
    // expansion beyond lineItems (proven 2026-10-29: the ladder fell
    // to bare lineItems with Orders+Payments Read granted + saved).
    creds.clover_env === 'sandbox'
        ? 'https://sandbox.dev.clover.com'
        : 'https://api.clover.com'
    const url = `${apiHost}/v3/merchants/${creds.clover_merchant_id}/orders?filter=createdTime>=${sinceTs}&expand=lineItems&limit=1000`

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.clover_api_key}`,
        Accept: 'application/json',
      },
    })
    if (!resp.ok) {
      throw new Error(`Clover API ${resp.status}: ${await resp.text()}`)
    }

    const body = (await resp.json()) as { elements?: CloverOrder[] }
    const orders = body.elements ?? []

    const rows: PosSaleRow[] = []
    for (const order of orders) {
      const ts = order.createdTime
      const saleTs = ts ? new Date(ts).toISOString() : null
      const saleDate = ts
        ? new Date(ts).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10)

      for (const li of order.lineItems?.elements ?? []) {
        const modifierNames =
          li.modifications?.elements
            ?.map((m) => m.name)
            .filter((s): s is string => Boolean(s)) ?? []
        const unitPrice = li.price != null ? li.price / 100 : null
        const quantity = li.quantity ?? 1

        rows.push({
          restaurant_id,
          pos_source: 'clover',
          pos_order_id: order.id ?? null,
          pos_line_id: li.id ?? null,
          sale_date: saleDate,
          sale_ts: saleTs,
          item_name: li.name ?? 'Unknown',
          category: null,
          quantity,
          unit: li.unitName ?? null,
          unit_price: unitPrice,
          revenue: unitPrice != null ? unitPrice * quantity : 0,
          modifiers: modifierNames.length > 0 ? modifierNames : null,
          raw: li,
        })
      }
    }
    return rows
  },
}

/**
 * Sales aggregates for the same order window: daily totals (the
 * food-cost page, Home KPIs and the assistant read daily_sales, NOT
 * pos_sales) plus per-day breakdowns by channel (the order's Clover
 * order type: Dine In / To Go / Delivery / ...) and by tender
 * (Cash / Credit Card / ...).
 *
 * Math is the reference computeDailySales (lib/clover.ts:
 * net = gross \u2212 discounts \u2212 refunds, tax excluded), applied per
 * order so each order's net can be attributed to its channel and
 * allocated across its payments pro-rata by amount \u2014 the tender
 * rows for a day therefore sum to that day's net.
 *
 * Orders are bucketed by createdTime (server time) so the
 * aggregates always agree with pos_sales' sale_date. Real POS
 * devices stamp clientCreatedTime == createdTime; API-seeded test
 * orders set clientCreatedTime arbitrarily, which would scatter
 * the aggregates onto dates nothing else recognizes.
 */
export interface SalesBreakdownRow {
  date: string
  dimension: 'order_type' | 'tender'
  label: string
  netCents: number
  orderCount: number
}

export interface CloverSalesAggregates {
  daily: DailySales[]
  breakdowns: SalesBreakdownRow[]
  /** Which expansion set the API accepted (ladder winner). */
  expandUsed: string | null
  /**
   * Whether the returned orders actually CARRIED the breakdown
   * fields. Clover can silently omit expansions a token isn't
   * scoped for (200 OK, fields absent) — the ladder can't see
   * that, but this check can.
   */
  fields: { orderType: boolean; payments: boolean }
}

interface RichPayment {
  amount?: number
  result?: string
  tender?: { id?: string }
}
interface RichOrder {
  orderType?: { id?: string; label?: string }
  payments?: { elements?: RichPayment[] }
}

export async function fetchCloverSalesAggregates(
  creds: CloverCreds,
  sinceTs: number
): Promise<CloverSalesAggregates> {
  if (!creds.clover_merchant_id || !creds.clover_api_key) {
    throw new Error('Clover credentials missing')
  }
  const apiHost =
    creds.clover_env === 'sandbox'
      ? 'https://sandbox.dev.clover.com'
      : 'https://api.clover.com'
  const authHeader = 'Bearer ' + creds.clover_api_key

  const fetchOrders = async (expand: string): Promise<RefCloverOrder[]> => {
    const url = `${apiHost}/v3/merchants/${creds.clover_merchant_id}/orders?filter=createdTime>=${sinceTs}&expand=${expand}&limit=1000`
    const resp = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    })
    if (!resp.ok) {
      throw new Error(`Clover API ${resp.status}: ${await resp.text()}`)
    }
    const body = (await resp.json()) as { elements?: RefCloverOrder[] }
    return body.elements ?? []
  }

  let orders: RefCloverOrder[] | null = null
  let lastError: Error | null = null
  let expandUsed: string | null = null
  // Clover gates each expandable field behind an app permission and
  // 403s the WHOLE call ("Invalid permissions for expandable
  // fields") when one is missing \u2014 with no hint which. Walk down
  // from the full set to bare lineItems (which the pos_sales fetch
  // already proves this token can read): refunds drop first, then
  // the breakdown fields (orderType/payments), then discounts. A
  // lower rung degrades that slice (refunds read as zero, channel
  // reads 'Unspecified', tender rows skipped) instead of failing
  // the whole sync.
  // Ladder order matters: each optional field drops out on its own
  // before combinations do, so one blocked expansion (say payments)
  // can't take the channel split down with it.
  const EXPANSIONS = [
    'lineItems,discounts,refunds,orderType,payments',
    'lineItems,discounts,orderType,payments',
    'lineItems,discounts,refunds,orderType',
    'lineItems,discounts,orderType',
    'lineItems,discounts,refunds,payments',
    'lineItems,discounts,payments',
    'lineItems,discounts,refunds',
    'lineItems,discounts',
    'lineItems',
  ]
  for (const expand of EXPANSIONS) {
    try {
      orders = await fetchOrders(expand)
      expandUsed = expand
      break
    } catch (e) {
      lastError = e as Error
    }
  }
  if (!orders) throw lastError ?? new Error('Clover orders fetch failed')

  const normalized = orders.map((o) => ({ ...o, clientCreatedTime: o.createdTime }))
  const daily = computeDailySales(normalized)

  // Tender id \u2192 label, for the tender breakdown. Best-effort: if the
  // tenders list can't be read, the tender dimension is skipped.
  let tenderLabels: Map<string, string> | null = null
  try {
    const resp = await fetch(
      `${apiHost}/v3/merchants/${creds.clover_merchant_id}/tenders?limit=100`,
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    )
    if (resp.ok) {
      const body = (await resp.json()) as {
        elements?: Array<{ id?: string; label?: string }>
      }
      tenderLabels = new Map()
      for (const t of body.elements ?? []) {
        if (t.id) tenderLabels.set(t.id, t.label ?? 'Other')
      }
    }
  } catch {
    tenderLabels = null
  }

  const byKey = new Map<string, SalesBreakdownRow>()
  const add = (
    date: string,
    dimension: 'order_type' | 'tender',
    label: string,
    netCents: number
  ) => {
    const key = `${date}|${dimension}|${label}`
    const row = byKey.get(key) ?? { date, dimension, label, netCents: 0, orderCount: 0 }
    row.netCents += netCents
    row.orderCount += 1
    byKey.set(key, row)
  }

  for (const order of normalized) {
    const day = computeDailySales([order])[0]
    if (!day) continue
    const rich = order as unknown as RichOrder

    add(day.date, 'order_type', rich.orderType?.label?.trim() || 'Unspecified', day.netCents)

    // Allocate the order's net across its successful payments
    // pro-rata by payment amount (residual cents to the largest
    // payment), merged per tender label.
    const pays = (rich.payments?.elements ?? []).filter(
      (p) => p.result == null || p.result === 'SUCCESS'
    )
    if (tenderLabels && pays.length > 0) {
      const totalPaid = pays.reduce((sum, p) => sum + (p.amount ?? 0), 0)
      if (totalPaid > 0) {
        const shares = pays.map((p) => ({
          label: (p.tender?.id && tenderLabels.get(p.tender.id)) || 'Other',
          raw: (day.netCents * (p.amount ?? 0)) / totalPaid,
        }))
        const perLabel = new Map<string, number>()
        let assigned = 0
        for (const s of shares) {
          const v = Math.floor(s.raw)
          assigned += v
          perLabel.set(s.label, (perLabel.get(s.label) ?? 0) + v)
        }
        const residual = day.netCents - assigned
        if (residual !== 0 && shares.length > 0) {
          const biggest = shares.reduce((a, b) => (b.raw > a.raw ? b : a))
          perLabel.set(biggest.label, (perLabel.get(biggest.label) ?? 0) + residual)
        }
        for (const [label, v] of perLabel) add(day.date, 'tender', label, v)
      }
    }
  }

  const richOrders = orders as unknown as RichOrder[]
  const fields = {
    orderType: richOrders.some((o) => !!o.orderType?.label),
    payments: richOrders.some((o) => (o.payments?.elements?.length ?? 0) > 0),
  }
  return { daily, breakdowns: [...byKey.values()], expandUsed, fields }
}

/** Back-compat wrapper: daily totals only. */
export async function fetchCloverDailySales(
  creds: CloverCreds,
  sinceTs: number
): Promise<DailySales[]> {
  return (await fetchCloverSalesAggregates(creds, sinceTs)).daily
}
