'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import SetupChecklist from '@/components/SetupChecklist'
import { fetchPriceAlerts, type PriceAlert } from '@/lib/alerts'
import { SERIES, GRID, TICK, tooltipStyle, CURSOR } from '@/lib/chart-theme'
import { buildPriceTrend, type TrendItem } from '@/lib/price-trend'

type RecentInvoice = { id: string; invoice_date: string; invoice_number: string; vendor: string; total: number }
type SpendTrend = {
  rows: Record<string, string | number>[]
  cats: { name: string; color: string; total: number }[]
  daily: boolean
}

export default function DashboardPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [range, setRange] = useState<'weekly' | 'monthly' | 'custom'>('monthly')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [totalSpend, setTotalSpend] = useState(0)
  const [prevSpend, setPrevSpend] = useState<number | null>(null)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [topCategory, setTopCategory] = useState('-')
  const [spendTrend, setSpendTrend] = useState<SpendTrend | null>(null)
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([])
  // Price history for the mini price-tracker card + per-invoice
  // price-move annotations (fetched once per restaurant, below).
  const [priceItems, setPriceItems] = useState<TrendItem[]>([])
  const [invoiceMeta, setInvoiceMeta] = useState<Record<string, { count: number; moves: number | null }>>({})
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([])
  // Food cost % = invoice spend ÷ Clover net sales, fixed trailing-30-day window.
  // null = no sales synced yet (or zero sales).
  const [foodCostPct, setFoodCostPct] = useState<number | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    loadData()
  }, [restaurantId, range, customStart, customEnd])

  // Price history (all approved invoices, range-independent): feeds
  // the mini price-tracker card and the per-invoice move counts on
  // Recent invoices. One fetch, two derivations.
  useEffect(() => {
    if (!restaurantId) return
    supabase.from('invoice_lines')
      .select('item_name, display_name, unit_price, unit_qty, case_qty, total, header_id, invoice_headers!header_id(invoice_date, review_status)')
      .eq('restaurant_id', restaurantId)
      .then(({ data }) => {
        if (!data) return
        const rows = (data as any[]).filter(r =>
          r.invoice_headers?.review_status !== 'needs_review' && r.invoice_headers?.invoice_date)

        // Item counts per invoice — every line counts.
        const counts: Record<string, number> = {}
        rows.forEach(r => { counts[r.header_id] = (counts[r.header_id] || 0) + 1 })

        const priced = rows.filter(r => r.item_name && r.unit_price > 0 && r.total > 0)

        // Tracked items, same grouping + unit heuristic as the
        // Price Tracker page.
        const map: Record<string, { display_name: string; prices: { invoice_date: string; unit_price: number }[] }> = {}
        const lastSeen: Record<string, { date: string; unit_qty: number; case_qty: number }> = {}
        priced.forEach(r => {
          const d = r.invoice_headers.invoice_date
          if (!map[r.item_name]) map[r.item_name] = { display_name: r.display_name || r.item_name, prices: [] }
          map[r.item_name].prices.push({ invoice_date: d, unit_price: r.unit_price })
          if (!lastSeen[r.item_name] || d >= lastSeen[r.item_name].date) {
            lastSeen[r.item_name] = { date: d, unit_qty: r.unit_qty ?? 0, case_qty: r.case_qty ?? 0 }
          }
        })
        const tracked: TrendItem[] = Object.entries(map)
          .filter(([, v]) => v.prices.length >= 2)
          .map(([item_name, v]) => {
            const ls = lastSeen[item_name]
            return {
              item_name,
              display_name: v.display_name,
              unit: (ls.unit_qty ?? 0) > 1 ? '/lb' : (ls.case_qty ?? 0) > 0 ? '/case' : '/unit',
              prices: v.prices.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date)),
            }
          })
        setPriceItems(tracked)

        // Per-invoice price moves: distinct items whose unit price
        // moved >= 5% vs that item's previous purchase (the alerts
        // threshold). moves = null when nothing on the invoice has
        // an earlier purchase to compare against.
        const history: Record<string, { date: string; price: number }[]> = {}
        priced.forEach(r => {
          (history[r.item_name] ??= []).push({ date: r.invoice_headers.invoice_date, price: r.unit_price })
        })
        Object.values(history).forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)))
        const byHeader: Record<string, { item: string; date: string; price: number }[]> = {}
        priced.forEach(r => {
          (byHeader[r.header_id] ??= []).push({ item: r.item_name, date: r.invoice_headers.invoice_date, price: r.unit_price })
        })
        const meta: Record<string, { count: number; moves: number | null }> = {}
        Object.entries(counts).forEach(([hid, count]) => { meta[hid] = { count, moves: null } })
        Object.entries(byHeader).forEach(([hid, lines]) => {
          if (!meta[hid]) meta[hid] = { count: lines.length, moves: null }
          const seen = new Set<string>()
          let moves = 0
          let comparable = 0
          lines.forEach(l => {
            if (seen.has(l.item)) return
            seen.add(l.item)
            let prev: number | null = null
            for (const h of history[l.item] || []) {
              if (h.date < l.date) prev = h.price
              else break
            }
            if (prev !== null && prev > 0) {
              comparable++
              if (Math.abs((l.price - prev) / prev) >= 0.05) moves++
            }
          })
          meta[hid].moves = comparable > 0 ? moves : null
        })
        setInvoiceMeta(meta)
      })
  }, [restaurantId])

  const homeTrend = useMemo(() => buildPriceTrend(priceItems), [priceItems])

  function localDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function getDateRange() {
    const now = new Date()
    if (range === 'weekly') {
      const start = new Date(now); start.setDate(now.getDate() - 7)
      return { start: localDate(start), end: localDate(now) }
    }
    if (range === 'monthly') {
      return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, end: localDate(now) }
    }
    return { start: customStart, end: customEnd }
  }

  function getPrevDateRange() {
    const now = new Date()
    if (range === 'weekly') {
      const end = new Date(now); end.setDate(now.getDate() - 7)
      const start = new Date(now); start.setDate(now.getDate() - 14)
      return { start: localDate(start), end: localDate(end) }
    }
    if (range === 'monthly') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: localDate(d), end: localDate(lastDay) }
    }
    return null
  }

  async function loadData() {
    const { start, end } = getDateRange()
    if (!start || !end) return

    const { data: headers } = await supabase
      .from('invoice_headers')
      .select('id, invoice_date, invoice_number, vendor, total, review_status')
      .eq('restaurant_id', restaurantId)
      .gte('invoice_date', start)
      .lte('invoice_date', end)
      .order('invoice_date', { ascending: false })

    if (!headers) return
    // Unapproved (needs_review) invoices don't count in the books yet.
    const approved = headers.filter((h: any) => h.review_status !== 'needs_review')
    const total = approved.reduce((s, h) => s + (h.total || 0), 0)
    setTotalSpend(total)
    setInvoiceCount(approved.length)
    setRecentInvoices(approved.slice(0, 8))

    const headerIds = approved.map(h => h.id)
    const prev = getPrevDateRange()

    const [linesResult, prevResult] = await Promise.all([
      headerIds.length > 0
        ? supabase.from('invoice_lines').select('category, total, header_id').in('header_id', headerIds)
        : Promise.resolve({ data: null }),
      prev?.start && prev?.end
        ? supabase.from('invoice_headers').select('total, review_status').eq('restaurant_id', restaurantId).gte('invoice_date', prev.start).lte('invoice_date', prev.end)
        : Promise.resolve({ data: null }),
    ])

    if (linesResult.data) {
      const catMap: Record<string, number> = {}
      linesResult.data.forEach((l: any) => { catMap[l.category || 'Other'] = (catMap[l.category || 'Other'] || 0) + (l.total || 0) })
      const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1])
      setTopCategory(sorted[0]?.[0] || '-')

      // Spend trend — category spend over time as lines (the price
      // tracker's graph language): top 4 categories, bucketed daily
      // for short ranges and weekly for longer ones. Zero-filled
      // honestly: a bucket with no purchases in a category is $0.
      const parseDay = (s: string) => {
        const [y, m, d] = s.split('-').map(Number)
        return new Date(y, m - 1, d).getTime()
      }
      const dateByHeader = new Map(approved.map(h => [h.id, h.invoice_date]))
      const startMs = parseDay(start)
      const days = Math.max(1, Math.round((parseDay(end) - startMs) / 86400000) + 1)
      const daily = days <= 14
      const bucketMs = daily ? 86400000 : 7 * 86400000
      const nBuckets = Math.ceil(days / (daily ? 1 : 7))
      const topCats = sorted.slice(0, 4).map(([c]) => c)
      const sums: Record<string, number[]> = {}
      topCats.forEach(c => { sums[c] = Array(nBuckets).fill(0) })
      linesResult.data.forEach((l: any) => {
        const cat = l.category || 'Other'
        if (!sums[cat]) return
        const d = dateByHeader.get(l.header_id)
        if (!d) return
        const idx = Math.floor((parseDay(d) - startMs) / bucketMs)
        if (idx >= 0 && idx < nBuckets) sums[cat][idx] += l.total || 0
      })
      const rows = Array.from({ length: nBuckets }, (_, i) => {
        const row: Record<string, string | number> = {
          label: new Date(startMs + i * bucketMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        }
        topCats.forEach(c => { row[c] = Math.round(sums[c][i] * 100) / 100 })
        return row
      })
      setSpendTrend(linesResult.data.length > 0
        ? {
            rows,
            cats: topCats.map((name, i) => ({ name, color: SERIES[i], total: Math.round((catMap[name] || 0) * 100) / 100 })),
            daily,
          }
        : null)
    }

    setPrevSpend(prevResult.data ? prevResult.data.reduce((s: number, h: any) => s + (h.review_status === 'needs_review' ? 0 : h.total || 0), 0) : null)

    // Food cost % — fixed trailing-30-day window, independent of the range
    // selector above. Sales come from daily_sales (Clover sync); spend from
    // invoice_headers. Needs sql/005_daily_sales.sql applied + a sync run.
    const t30start = localDate(new Date(Date.now() - 29 * 24 * 3600 * 1000))
    const t30end = localDate(new Date())
    const [sales30, spend30] = await Promise.all([
      supabase.from('daily_sales').select('net_cents').eq('restaurant_id', restaurantId).gte('date', t30start).lte('date', t30end),
      supabase.from('invoice_headers').select('total, review_status').eq('restaurant_id', restaurantId).gte('invoice_date', t30start).lte('invoice_date', t30end),
    ])
    const netSales30 = (sales30.data ?? []).reduce((s: number, r: { net_cents?: number | null }) => s + (r.net_cents || 0), 0) / 100
    const spend30Total = (spend30.data ?? []).reduce((s: number, h: { total?: number | null; review_status?: string | null }) => s + (h.review_status === 'needs_review' ? 0 : h.total || 0), 0)
    setFoodCostPct(netSales30 > 0 ? (spend30Total / netSales30) * 100 : null)

    // Price-move alerts for the home card (top 3 shown, full list on
    // the Alerts page).
    if (restaurantId) {
      fetchPriceAlerts(supabase, restaurantId)
        .then(setPriceAlerts)
        .catch(() => setPriceAlerts([]))
    }
  }

  // ---- Presentation-only derived values (no new data) ----
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const avgPerInvoice = invoiceCount ? totalSpend / invoiceCount : 0
  const hasTrend = prevSpend !== null && prevSpend > 0
  const trendPct = hasTrend ? ((totalSpend - prevSpend!) / prevSpend!) * 100 : 0
  const trendUp = totalSpend > (prevSpend ?? 0)

  const rangePill = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-[13px] font-medium capitalize transition ${
      active
        ? 'bg-ink text-cream'
        : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'
    }`

  return (
    <div className="p-4 sm:p-8">
      {/* Range controls (drive the existing queries) */}
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        {(['weekly', 'monthly'] as const).map(r => (
          <button key={r} onClick={() => setRange(r)} className={rangePill(range === r)}>
            {r}
          </button>
        ))}
        <button onClick={() => setRange('custom')} className={rangePill(range === 'custom')}>
          Custom
        </button>
      </div>

      {range === 'custom' && (
        <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink-2 outline-none focus:border-terracotta" />
          <span className="text-ink-muted">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink-2 outline-none focus:border-terracotta" />
        </div>
      )}

      {/* First-run setup checklist — renders only while setup is incomplete */}
      <SetupChecklist />

      {/* KPI BAND — real data. One unified panel with divided segments
          (not five separate boxes): values use a fluid clamp() size plus
          min-w-0 + truncate, so a growing number can never push out of
          its segment — it shrinks, and the full value is on hover. */}
      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-[14px] border border-ink/[0.08] bg-cream-surface md:grid-cols-3 xl:grid-cols-5 xl:divide-x xl:divide-ink/[0.06]">
        <div className="min-w-0 px-5 py-5">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Total spend this period</div>
          <div title={money(totalSpend)} className="mt-1.5 truncate font-display text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] font-extrabold leading-tight tracking-[-0.5px] text-ink">{money(totalSpend)}</div>
          {hasTrend ? (
            <div className={`mt-1 truncate font-mono text-[12px] ${trendUp ? 'text-terracotta' : 'text-ink-muted'}`}>
              {trendUp ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}% vs prev
            </div>
          ) : (
            <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">no prior period</div>
          )}
        </div>

        <div className="min-w-0 px-5 py-5">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Avg per invoice</div>
          <div title={money(avgPerInvoice)} className="mt-1.5 truncate font-display text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] font-extrabold leading-tight tracking-[-0.5px] text-ink">{money(avgPerInvoice)}</div>
          <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">this period</div>
        </div>

        <div className="min-w-0 px-5 py-5">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Invoices parsed</div>
          <div title={String(invoiceCount)} className="mt-1.5 truncate font-display text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] font-extrabold leading-tight tracking-[-0.5px] text-ink">{invoiceCount}</div>
          <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">in selected range</div>
        </div>

        <div className="min-w-0 px-5 py-5">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Top category</div>
          <div title={topCategory} className="mt-1.5 truncate font-serif text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] leading-tight text-ink">{topCategory}</div>
          <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">by spend</div>
        </div>

        <Link href="/dashboard/food-cost" className="min-w-0 px-5 py-5 transition hover:bg-cream-surface-alt">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Food cost %</div>
          {foodCostPct !== null ? (
            <>
              {/* >35% is the typical "high" threshold for restaurant food cost */}
              <div title={`${foodCostPct.toFixed(1)}%`} className={`mt-1.5 truncate font-display text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] font-extrabold leading-tight tracking-[-0.5px] ${foodCostPct > 35 ? 'text-terracotta' : 'text-ink'}`}>
                {foodCostPct.toFixed(1)}%
              </div>
              <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">trailing 30d · Clover</div>
            </>
          ) : (
            <>
              <div className="mt-1.5 truncate font-display text-[clamp(1.3rem,1.05rem+1.1vw,1.85rem)] font-extrabold leading-tight tracking-[-0.5px] text-ink">—</div>
              <div className="mt-1 truncate font-mono text-[12px] text-ink-muted">no sales synced yet</div>
            </>
          )}
        </Link>
      </div>

      {/* SPEND TREND — category spend over time, as lines in the
          price tracker's graph language (Sai's call: the bars
          become a graph). Top 4 categories; totals in the chips. */}
      <div className="mb-6 rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6">
        <div className="mb-4">
          <h2 className="font-serif text-[22px] text-ink">Spend trend</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {spendTrend
              ? `${spendTrend.daily ? 'Daily' : 'Weekly'} spend · top ${spendTrend.cats.length} categories · auto-categorized from your invoice lines`
              : 'Auto-categorization runs on every approved invoice'}
          </p>
        </div>
        {!spendTrend ? (
          <div className="flex h-[240px] min-h-[240px] items-center justify-center text-[13px] text-ink-muted">
            No category data in this range.
          </div>
        ) : (
          <>
            {/* Hard-capped height: recharts v3 ResponsiveContainer otherwise overshoots. */}
            <div className="h-[240px] min-h-[240px] w-full" style={{ height: 240, maxHeight: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spendTrend.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip contentStyle={tooltipStyle} cursor={CURSOR}
                    formatter={(v, name) => [`$${Number(v).toLocaleString()}`, name]} />
                  {spendTrend.cats.map(c => (
                    <Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} strokeWidth={2.5}
                      dot={{ r: 3, fill: c.color, strokeWidth: 0 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {spendTrend.cats.map(c => (
                <span key={c.name} className="inline-flex items-center gap-[7px] font-mono text-[11px] text-ink-3">
                  <span className="h-[3px] w-[10px] rounded-[2px]" style={{ background: c.color }} />
                  {c.name} <span className="text-ink-muted">${c.total.toLocaleString()}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* RECENT INVOICES + ALERTS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-[22px] text-ink">Recent invoices</h2>
            <Link href="/dashboard/invoices" className="text-[13px] font-medium text-terracotta hover:text-terracotta-hover">
              View all →
            </Link>
          </div>

          <div className="hidden md:grid grid-cols-[80px_1fr_auto] border-b border-ink/[0.08] pb-2 text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            <span>Date</span>
            <span>Vendor</span>
            <span className="text-right">Amount</span>
          </div>
          {recentInvoices.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">No invoices in this range.</p>
          ) : (
            recentInvoices.map(inv => {
              const meta = invoiceMeta[inv.id]
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 border-b border-ink/[0.05] py-3 text-[14px] last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{inv.vendor}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-muted">
                      {inv.invoice_date} · #{inv.invoice_number}{meta ? ` · ${meta.count} items` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-ink">{money(Number(inv.total))}</span>
                    {meta && meta.moves !== null && (
                      meta.moves > 0
                        ? <span className="mt-0.5 block font-mono text-[11px] text-terracotta">{meta.moves} price move{meta.moves > 1 ? 's' : ''}</span>
                        : <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">no big moves</span>
                    )}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="flex flex-col rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-[22px] text-ink">Active alerts</h2>
            {priceAlerts.length > 0 && (
              <Link href="/dashboard/alerts" className="text-[13px] font-medium text-terracotta hover:underline">
                View all
              </Link>
            )}
          </div>
          {priceAlerts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
              <div className="text-[15px] font-semibold text-ink">No active alerts</div>
              <div className="mt-1 text-[13px] text-ink-muted">Supplier prices are stable — nothing moved 5% or more.</div>
            </div>
          ) : (
            <div>
              {priceAlerts.slice(0, 3).map(a => (
                <div
                  key={a.item_name}
                  className="grid grid-cols-[1fr_auto] items-center border-b border-ink/[0.05] py-3 text-[14px] last:border-0"
                >
                  <span className="min-w-0 pr-3">
                    <span className="block truncate text-ink">{a.display_name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-muted">{a.vendor} · {a.date}</span>
                  </span>
                  <span className={`text-right font-mono ${a.change > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {a.change > 0 ? '+' : ''}{a.change.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PRICE TRACKER MINI — the homepage mock's graph, on the real
          dashboard. Full history + table live on the Price Tracker
          page; derivation shared via lib/price-trend. */}
      <div className="mt-6 rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-[22px] text-ink">Price tracker</h2>
            <p className="mt-1 text-[13px] text-ink-muted">Unit prices · trailing 6 weeks · last purchase each week</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {homeTrend && (
              <div className="rounded-[10px] bg-ink px-[13px] py-[10px] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.55)]">
                <div className="font-mono text-[12px] font-semibold text-[#F9A8D4]">
                  {homeTrend.mover.item.display_name} {homeTrend.mover.pct >= 0 ? '↑' : '↓'} {Math.abs(homeTrend.mover.pct).toFixed(1)}% in 6 weeks
                </div>
                <div className="mt-[3px] text-[11px] text-[#C7C0B4]">
                  ${homeTrend.mover.first.toFixed(2)} → ${homeTrend.mover.last.toFixed(2)} {homeTrend.mover.item.unit}
                </div>
              </div>
            )}
            <Link href="/dashboard/price-tracker" className="text-[13px] font-medium text-terracotta hover:text-terracotta-hover">
              Full tracker →
            </Link>
          </div>
        </div>
        {!homeTrend ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">
            Price trends appear once an item has been bought in two different weeks.
          </p>
        ) : (
          <>
            <div className="h-[190px] min-h-[190px] w-full" style={{ height: 190, maxHeight: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={homeTrend.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `$${Number(v.toFixed(2))}`} />
                  <Tooltip contentStyle={tooltipStyle} cursor={CURSOR}
                    formatter={(v, name) => {
                      const s = homeTrend.series.find(x => x.item.item_name === name)
                      return [`$${Number(v).toFixed(2)}${s ? ` ${s.item.unit}` : ''}`, s ? s.item.display_name : String(name)]
                    }} />
                  {homeTrend.series.map(s => (
                    <Line key={s.item.item_name} type="monotone" dataKey={s.item.item_name}
                      stroke={s.color} strokeWidth={2.5} dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                      connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {homeTrend.series.map(s => (
                <span key={s.item.item_name} className="inline-flex items-center gap-[7px] font-mono text-[11px] text-ink-3">
                  <span className="h-[3px] w-[10px] rounded-[2px]" style={{ background: s.color }} />
                  {s.item.display_name} <span className="text-ink-muted">{s.item.unit}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
