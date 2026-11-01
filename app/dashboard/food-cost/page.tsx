'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts'

// Full Food cost % page: invoice spend ÷ POS net sales.
// - KPIs on a trailing-30-day window (same convention as the Home card).
// - Weekly food-cost-% trend over the trailing 12 weeks, with a 35% reference
//   line (the industry's typical "high" threshold).
// - Weekly net-sales vs invoice-spend bars.
// - Spend-by-category breakdown for the trailing 30 days.
// Sales come from daily_sales (Clover sync); spend from invoice_headers.

type DayRow = { date: string; sales: number; spend: number }
type WeekRow = { label: string; sales: number; spend: number; pct: number | null }
type CategorySpend = { category: string; total: number }
type BreakdownRow = { dimension: string; label: string; net: number; orders: number }

function BreakdownGroup({
  title,
  rows,
  money,
}: {
  title: string
  rows: BreakdownRow[]
  money: (n: number) => string
}) {
  const sorted = [...rows].sort((a, b) => b.net - a.net)
  const total = sorted.reduce((s, r) => s + r.net, 0)
  return (
    <div>
      <div className="text-[12.5px] font-semibold tracking-[0.02em] text-ink-muted">{title}</div>
      {sorted.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-muted">No data yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {sorted.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-ink">
                  {r.label}
                  <span className="ml-2 font-mono text-[11.5px] text-ink-muted">
                    {r.orders} orders
                  </span>
                </span>
                <span className="font-mono text-[13.5px] text-ink">
                  {money(r.net)}
                  <span className="ml-2 text-ink-muted">
                    {total > 0 ? `${((r.net / total) * 100).toFixed(0)}%` : ''}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-[6px] overflow-hidden rounded-full bg-ink/[0.07]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${total > 0 ? Math.max(2, (r.net / total) * 100) : 0}%`,
                    background: '#1E3A2F',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const WEEKS = 12
const DAYS = WEEKS * 7 // 84
const WINDOW_30 = 30
const HIGH_THRESHOLD = 35

// Chart palette — the app theme (coal + pop), matching Home and
// Wastage. This page previously kept local pre-reskin constants
// (forest #1E3A2F / terracotta #C4642D), so its bars never themed.
const COAL = '#171310'
const POP = '#EC4899'
const GRID = 'rgba(26,23,19,0.08)'
const TICK = { fontSize: 11, fontFamily: 'var(--font-plex-mono)', fill: '#8A8377' } as const

const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid rgba(26,23,19,0.1)',
  background: '#FFFDF9',
  fontFamily: 'var(--font-plex-mono)',
  fontSize: 12,
}

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortLabel(iso: string) {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

export default function FoodCostPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [days, setDays] = useState<DayRow[]>([])
  const [categories, setCategories] = useState<CategorySpend[]>([])
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurantId) return
    load()
  }, [restaurantId])

  async function load() {
    setLoading(true)
    const end = localDate(new Date())
    const start = localDate(new Date(Date.now() - (DAYS - 1) * 24 * 3600 * 1000))
    const start30 = localDate(new Date(Date.now() - (WINDOW_30 - 1) * 24 * 3600 * 1000))

    const [salesRes, spendRes, bdRes] = await Promise.all([
      supabase.from('daily_sales').select('date, net_cents')
        .eq('restaurant_id', restaurantId).gte('date', start).lte('date', end),
      supabase.from('invoice_headers').select('id, invoice_date, total, review_status')
        .eq('restaurant_id', restaurantId).gte('invoice_date', start).lte('invoice_date', end),
      // Sales breakdowns (sql/016) — trailing 30d only. Errors (table
      // not created yet) simply leave the card hidden.
      supabase.from('sales_breakdowns').select('dimension, label, net_cents, order_count')
        .eq('restaurant_id', restaurantId).gte('date', start30).lte('date', end),
    ])

    const bdMap = new Map<string, BreakdownRow>()
    for (const r of (bdRes.data ?? []) as { dimension: string; label: string; net_cents: number; order_count: number }[]) {
      const key = `${r.dimension}|${r.label}`
      const cur = bdMap.get(key) ?? { dimension: r.dimension, label: r.label, net: 0, orders: 0 }
      cur.net += (r.net_cents || 0) / 100
      cur.orders += r.order_count || 0
      bdMap.set(key, cur)
    }
    setBreakdowns([...bdMap.values()])

    // One row per day, zero-filled so charts show honest gaps.
    const byDay = new Map<string, DayRow>()
    for (let i = 0; i < DAYS; i++) {
      const d = localDate(new Date(Date.now() - (DAYS - 1 - i) * 24 * 3600 * 1000))
      byDay.set(d, { date: d, sales: 0, spend: 0 })
    }
    for (const r of salesRes.data ?? []) {
      const row = byDay.get(r.date as string)
      if (row) row.sales += (r.net_cents || 0) / 100
    }
    const headerIds30: string[] = []
    for (const h of (spendRes.data ?? []) as { id: string; invoice_date: string; total: number | null; review_status?: string | null }[]) {
      // Unapproved (needs_review) invoices don't count as spend yet.
      if (h.review_status === 'needs_review') continue
      const row = byDay.get(h.invoice_date)
      if (row) row.spend += h.total || 0
      if (h.invoice_date >= start30) headerIds30.push(h.id)
    }
    setDays([...byDay.values()])

    if (headerIds30.length > 0) {
      const { data: lines } = await supabase.from('invoice_lines')
        .select('category, total').in('header_id', headerIds30)
      const catMap: Record<string, number> = {}
      for (const l of (lines ?? []) as { category: string | null; total: number | null }[]) {
        const c = l.category || 'Other'
        catMap[c] = (catMap[c] || 0) + (l.total || 0)
      }
      setCategories(
        Object.entries(catMap)
          .sort((a, b) => b[1] - a[1])
          .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })),
      )
    } else {
      setCategories([])
    }
    setLoading(false)
  }

  // ---- Derived ----
  const last30 = days.slice(-WINDOW_30)
  const sales30 = last30.reduce((s, d) => s + d.sales, 0)
  const spend30 = last30.reduce((s, d) => s + d.spend, 0)
  const pct30 = sales30 > 0 ? (spend30 / sales30) * 100 : null
  const hasSales = days.some(d => d.sales > 0)

  const weeks: WeekRow[] = []
  for (let w = 0; w < WEEKS; w++) {
    const chunk = days.slice(w * 7, w * 7 + 7)
    const sales = chunk.reduce((s, d) => s + d.sales, 0)
    const spend = chunk.reduce((s, d) => s + d.spend, 0)
    weeks.push({
      label: chunk.length ? shortLabel(chunk[0].date) : '',
      sales: Math.round(sales * 100) / 100,
      spend: Math.round(spend * 100) / 100,
      pct: sales > 0 ? Math.round((spend / sales) * 1000) / 10 : null,
    })
  }

  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const card = 'rounded-[14px] border border-ink/[0.08] bg-cream-surface p-6'

  if (loading) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="font-serif text-[28px] text-ink">Food cost %</h1>
        <p className="mt-2 text-[13px] text-ink-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-serif text-[28px] text-ink">Food cost %</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        Invoice spend ÷ POS net sales (gross − discounts − refunds, tax excluded).
      </p>

      {!hasSales ? (
        <div className={`${card} mt-6 max-w-xl`}>
          <h2 className="font-serif text-[22px] text-ink">No sales data yet</h2>
          <p className="mt-2 text-[13px] text-ink-muted">
            Connect your Clover POS in Settings and run a sync — food cost % unlocks
            as soon as sales land in <span className="font-mono">daily_sales</span>.
          </p>
          <Link href="/dashboard/settings"
            className="mt-4 inline-block rounded-[9px] bg-terracotta px-4 py-2 text-[13px] font-semibold text-white hover:bg-terracotta-hover">
            Go to Settings
          </Link>
        </div>
      ) : (
        <>
          {/* KPI CARDS */}
          <div className="mb-6 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]">
              <div className="text-[12.5px] tracking-[0.02em] text-ink-muted">Food cost %</div>
              {pct30 !== null ? (
                <div className={`mt-2 font-mono text-[30px] font-semibold ${pct30 > HIGH_THRESHOLD ? 'text-terracotta' : 'text-ink'}`}>
                  {pct30.toFixed(1)}%
                </div>
              ) : (
                <div className="mt-2 font-mono text-[30px] font-semibold text-ink">—</div>
              )}
              <div className="mt-2 font-mono text-[13px] text-ink-muted">trailing 30 days</div>
            </div>
            <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]">
              <div className="text-[12.5px] tracking-[0.02em] text-ink-muted">Net sales</div>
              <div className="mt-2 font-mono text-[30px] font-semibold text-ink">{money(sales30)}</div>
              <div className="mt-2 font-mono text-[13px] text-ink-muted">trailing 30 days · Clover</div>
            </div>
            <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]">
              <div className="text-[12.5px] tracking-[0.02em] text-ink-muted">Invoice spend</div>
              <div className="mt-2 font-mono text-[30px] font-semibold text-ink">{money(spend30)}</div>
              <div className="mt-2 font-mono text-[13px] text-ink-muted">trailing 30 days</div>
            </div>
            <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]">
              <div className="text-[12.5px] tracking-[0.02em] text-ink-muted">Avg daily net sales</div>
              <div className="mt-2 font-mono text-[30px] font-semibold text-ink">{money(sales30 / WINDOW_30)}</div>
              <div className="mt-2 font-mono text-[13px] text-ink-muted">trailing 30 days</div>
            </div>
          </div>

          {pct30 !== null && pct30 > HIGH_THRESHOLD && (
            <div className="mb-6 rounded-[14px] border border-terracotta/30 bg-terracotta/[0.08] p-4 text-[13px] text-ink">
              <span className="font-semibold text-terracotta">Above the {HIGH_THRESHOLD}% threshold.</span>
              {' '}Food cost over {HIGH_THRESHOLD}% is typically considered high for restaurants —
              worth reviewing purchasing or menu pricing.
            </div>
          )}

          {/* SALES BREAKDOWN */}
          {breakdowns.length > 0 && (
            <div className={`${card} mb-6`}>
              <h2 className="font-serif text-[22px] text-ink">Sales breakdown</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Where the last 30 days of net sales came from — by channel and by payment type.
              </p>
              <div className="mt-5 grid gap-8 sm:grid-cols-2">
                <BreakdownGroup
                  title="By channel"
                  rows={breakdowns.filter((b) => b.dimension === 'order_type')}
                  money={money}
                />
                <BreakdownGroup
                  title="By payment"
                  rows={breakdowns.filter((b) => b.dimension === 'tender')}
                  money={money}
                />
              </div>
            </div>
          )}

          {/* TREND */}
          <div className={`${card} mb-6`}>
            <h2 className="font-serif text-[22px] text-ink">Food cost trend</h2>
            <p className="mt-1 text-[13px] text-ink-muted">Weekly food cost %, trailing {WEEKS} weeks. Dashed line marks {HIGH_THRESHOLD}%.</p>
            <div className="h-[260px] min-h-[260px] w-full" style={{ height: 260, maxHeight: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeks} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `${v}%`} domain={[0, 'auto']} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Food cost %']}
                    labelFormatter={(l) => `Week of ${l}`} />
                  <ReferenceLine y={HIGH_THRESHOLD} stroke={POP} strokeDasharray="5 4"
                    label={{ value: `${HIGH_THRESHOLD}%`, ...TICK, fill: POP }} />
                  <Line type="monotone" dataKey="pct" stroke={POP} strokeWidth={2.5}
                    dot={{ r: 3, fill: POP }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* SALES VS SPEND */}
          <div className={`${card} mb-6`}>
            <h2 className="font-serif text-[22px] text-ink">Net sales vs invoice spend</h2>
            <p className="mt-1 text-[13px] text-ink-muted">Weekly totals, trailing {WEEKS} weeks.</p>
            <div className="h-[260px] min-h-[260px] w-full" style={{ height: 260, maxHeight: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 12, right: 12, left: -8, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(23,19,16,0.06)' }}
                    formatter={(v, name) => [`$${Number(v).toLocaleString()}`, name === 'sales' ? 'Net sales' : 'Invoice spend']}
                    labelFormatter={(l) => `Week of ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-plex-mono)' }} />
                  <Bar dataKey="sales" name="sales" fill={COAL} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="spend" name="spend" fill={POP} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* CATEGORY BREAKDOWN */}
          <div className={card}>
            <h2 className="font-serif text-[22px] text-ink">Spend by category</h2>
            <p className="mt-1 text-[13px] text-ink-muted">Where the trailing-30-day invoice spend went.</p>
            {categories.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-[13px] text-ink-muted">
                No invoice lines in the trailing 30 days.
              </div>
            ) : (
              <div className="h-[260px] min-h-[260px] w-full" style={{ height: 260, maxHeight: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categories} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="category" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={0}
                      tickFormatter={(v: string) => v.length > 12 ? `${v.slice(0, 11)}…` : v} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(23,19,16,0.06)' }}
                      formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Spend']} />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {categories.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? POP : COAL} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
