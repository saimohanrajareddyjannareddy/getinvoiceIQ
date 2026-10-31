'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import SetupChecklist from '@/components/SetupChecklist'
import { fetchPriceAlerts, type PriceAlert } from '@/lib/alerts'

type CategorySpend = { category: string; total: number }
type RecentInvoice = { id: string; invoice_date: string; invoice_number: string; vendor: string; total: number }

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
  const [categoryData, setCategoryData] = useState<CategorySpend[]>([])
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([])
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([])
  // Food cost % = invoice spend ÷ Clover net sales, fixed trailing-30-day window.
  // null = no sales synced yet (or zero sales).
  const [foodCostPct, setFoodCostPct] = useState<number | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    loadData()
  }, [restaurantId, range, customStart, customEnd])

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
        ? supabase.from('invoice_lines').select('category, total').in('header_id', headerIds)
        : Promise.resolve({ data: null }),
      prev?.start && prev?.end
        ? supabase.from('invoice_headers').select('total, review_status').eq('restaurant_id', restaurantId).gte('invoice_date', prev.start).lte('invoice_date', prev.end)
        : Promise.resolve({ data: null }),
    ])

    if (linesResult.data) {
      const catMap: Record<string, number> = {}
      linesResult.data.forEach((l: any) => { catMap[l.category || 'Other'] = (catMap[l.category || 'Other'] || 0) + (l.total || 0) })
      const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1])
      setCategoryData(sorted.map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })))
      setTopCategory(sorted[0]?.[0] || '-')
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

      {/* CHART — same query + data, restyled palette */}
      <div className="mb-6 rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6">
        <div className="mb-4">
          <h2 className="font-serif text-[22px] text-ink">Spend by category</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {categoryData.length > 0
              ? 'Auto-categorized from your invoice lines'
              : 'Auto-categorization runs on every approved invoice'}
          </p>
        </div>
        {categoryData.length === 0 ? (
          <div className="flex h-[240px] min-h-[240px] items-center justify-center text-[13px] text-ink-muted">
            No category data in this range.
          </div>
        ) : (
          // Hard-capped height: recharts v3 ResponsiveContainer otherwise overshoots
          // (SVG grows the box → re-measure). min/max + inline height lock it at 240.
          <div className="h-[240px] min-h-[240px] w-full" style={{ height: 240, maxHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fontFamily: 'var(--font-plex-mono)', fill: '#8A8377' }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(26,23,19,0.1)' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: 'var(--font-plex-mono)', fill: '#8A8377' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(v) => `$${Number(v).toLocaleString()}`}
                  cursor={{ fill: 'rgba(23,19,16,0.06)' }}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid rgba(26,23,19,0.1)',
                    background: '#FFFDF9',
                    fontFamily: 'var(--font-plex-mono)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {categoryData.map((_, i) => (
                    // Highlight the top (largest) category in pop pink; rest coal.
                    <Cell key={i} fill={i === 0 ? '#EC4899' : '#171310'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
            recentInvoices.map(inv => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 border-b border-ink/[0.05] py-3 text-[14px] last:border-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink">{inv.vendor}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-muted">
                    {inv.invoice_date} · #{inv.invoice_number}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-ink">{money(Number(inv.total))}</span>
              </div>
            ))
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
    </div>
  )
}
