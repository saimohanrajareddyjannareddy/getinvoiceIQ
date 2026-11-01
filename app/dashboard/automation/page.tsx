'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { Activity, CheckCircle2, AlertTriangle, Clock, RefreshCcw } from 'lucide-react'

type Status = 'pending' | 'processing' | 'done' | 'failed' | 'dead'
type Source = 'portal' | 'email' | 'upload' | 'api'

type VendorFreshness = {
  vendor_id: string | null
  vendor_name: string
  ingestion_method: string
  last_seen: string | null
  days_since: number | null
}

type RecentFailure = {
  id: string
  uploaded_at: string
  source: string | null
  vendor_name: string | null
  error_message: string | null
  retry_count: number | null
  status: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export default function AutomationPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const reqSeq = useRef(0)

  const [loading, setLoading] = useState(true)
  const [countsByStatus, setCountsByStatus] = useState<Record<Status, number>>({
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    dead: 0,
  })
  const [weekCount, setWeekCount] = useState(0)
  const [weekSuccessRate, setWeekSuccessRate] = useState<number | null>(null)
  const [bySource, setBySource] = useState<Record<Source, number>>({
    portal: 0,
    email: 0,
    upload: 0,
    api: 0,
  })
  const [vendorFreshness, setVendorFreshness] = useState<VendorFreshness[]>([])
  const [failures, setFailures] = useState<RecentFailure[]>([])


  async function load() {
    const seq = ++reqSeq.current
    const stale = () => seq !== reqSeq.current
    setLoading(true)
    const weekAgoIso = new Date(Date.now() - 7 * DAY_MS).toISOString()
    const monthAgoIso = new Date(Date.now() - 30 * DAY_MS).toISOString()

    const [
      filesAll,
      filesWeek,
      vendorsRes,
      failuresRes,
    ] = await Promise.all([
      supabase
        .from('invoice_files')
        .select('id, status, source, vendor_id, uploaded_at')
        .eq('restaurant_id', restaurantId),
      supabase
        .from('invoice_files')
        .select('id, status, source', { count: 'exact' })
        .eq('restaurant_id', restaurantId)
        .gte('uploaded_at', weekAgoIso),
      supabase
        .from('vendors')
        .select('id, display_name, ingestion_method'),
      supabase
        .from('invoice_files')
        .select('id, uploaded_at, source, vendor_id, error_message, retry_count, status')
        .eq('restaurant_id', restaurantId)
        .in('status', ['failed', 'dead'])
        .gte('uploaded_at', monthAgoIso)
        .order('uploaded_at', { ascending: false })
        .limit(20),
    ])
    if (stale()) return

    if (filesAll.error) console.error('invoice_files query failed:', filesAll.error)
    if (filesWeek.error) console.error('invoice_files week query failed:', filesWeek.error)
    if (vendorsRes.error) console.error('vendors query failed:', vendorsRes.error)
    if (failuresRes.error) console.error('failures query failed:', failuresRes.error)

    const all = filesAll.data ?? []
    const week = filesWeek.data ?? []
    const vendors = vendorsRes.data ?? []
    const fails = failuresRes.data ?? []

    const statuses: Record<Status, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
      dead: 0,
    }
    const sources: Record<Source, number> = { portal: 0, email: 0, upload: 0, api: 0 }
    for (const f of all) {
      const s = (f.status ?? 'pending') as Status
      if (s in statuses) statuses[s] += 1
      const src = (f.source ?? 'portal') as Source
      if (src in sources) sources[src] += 1
    }
    setCountsByStatus(statuses)
    setBySource(sources)

    setWeekCount(week.length)
    if (week.length > 0) {
      const done = week.filter((f) => f.status === 'done').length
      setWeekSuccessRate(Math.round((done / week.length) * 1000) / 10)
    } else {
      setWeekSuccessRate(null)
    }

    const lastSeenByVendor = new Map<string, string>()
    for (const f of all) {
      if (!f.vendor_id || !f.uploaded_at) continue
      const prev = lastSeenByVendor.get(f.vendor_id)
      if (!prev || f.uploaded_at > prev) lastSeenByVendor.set(f.vendor_id, f.uploaded_at)
    }
    const now = Date.now()
    const freshness: VendorFreshness[] = vendors.map((v) => {
      const lastSeen = lastSeenByVendor.get(v.id) ?? null
      const daysSince = lastSeen
        ? Math.floor((now - new Date(lastSeen).getTime()) / DAY_MS)
        : null
      return {
        vendor_id: v.id,
        vendor_name: v.display_name,
        ingestion_method: v.ingestion_method,
        last_seen: lastSeen,
        days_since: daysSince,
      }
    })
    freshness.sort((a, b) => {
      if (a.last_seen && !b.last_seen) return -1
      if (!a.last_seen && b.last_seen) return 1
      if (a.last_seen && b.last_seen) return a.last_seen < b.last_seen ? 1 : -1
      return 0
    })
    setVendorFreshness(freshness)

    const vendorNameById = new Map(vendors.map((v) => [v.id, v.display_name]))
    setFailures(
      fails.map((f) => ({
        id: f.id,
        uploaded_at: f.uploaded_at,
        source: f.source,
        vendor_name: f.vendor_id ? vendorNameById.get(f.vendor_id) ?? null : null,
        error_message: f.error_message,
        retry_count: f.retry_count,
        status: f.status,
      })),
    )

    setLoading(false)
  }

  // Re-load when the restaurant changes. reqSeq makes a slower, older
  // request (or an earlier Refresh click) drop its results instead of
  // overwriting the newer one.
  useEffect(() => {
    if (!restaurantId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads current state; restaurantId is its input
  }, [restaurantId])

  const inFlight = countsByStatus.pending + countsByStatus.processing
  const totalAll =
    countsByStatus.pending +
    countsByStatus.processing +
    countsByStatus.done +
    countsByStatus.failed +
    countsByStatus.dead

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink flex items-center gap-2">
            <Activity size={22} className="text-pop" />
            AI Automation
          </h1>
          <p className="text-ink-muted text-sm">
            Pipeline health across vendor portals, email, and uploads.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-ink/[0.12] bg-cream-surface rounded-[9px] hover:bg-cream-surface-alt text-ink-2 disabled:opacity-50"
        >
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          icon={<Activity size={16} className="text-pop" />}
          label="Last 7 days"
          value={weekCount.toString()}
          sub="files received"
        />
        <Kpi
          icon={<CheckCircle2 size={16} className="text-green-500" />}
          label="Parse success rate"
          value={weekSuccessRate == null ? '—' : `${weekSuccessRate}%`}
          sub="last 7 days"
        />
        <Kpi
          icon={<Clock size={16} className="text-pop" />}
          label="In flight"
          value={inFlight.toString()}
          sub={`${countsByStatus.pending} queued · ${countsByStatus.processing} parsing`}
        />
        <Kpi
          icon={<AlertTriangle size={16} className="text-red-500" />}
          label="Failures"
          value={(countsByStatus.failed + countsByStatus.dead).toString()}
          sub={`${countsByStatus.dead} dead-lettered`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title={`Files by source (all-time: ${totalAll})`}>
          <SourceBars sources={bySource} />
        </Card>
        <Card title={`Files by status (all-time: ${totalAll})`}>
          <StatusBars statuses={countsByStatus} />
        </Card>
      </div>

      <Card title="Per-vendor freshness">
        {vendorFreshness.length === 0 ? (
          <Empty>No vendors configured yet.</Empty>
        ) : (
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-ink-muted text-xs border-b border-ink/[0.08]">
                <th className="text-left pb-2">Vendor</th>
                <th className="text-left pb-2">Source</th>
                <th className="text-left pb-2">Last file</th>
                <th className="text-right pb-2">Days ago</th>
              </tr>
            </thead>
            <tbody>
              {vendorFreshness.map((v) => (
                <tr key={v.vendor_id ?? v.vendor_name} className="border-b last:border-0">
                  <td className="py-2 text-ink">{v.vendor_name}</td>
                  <td className="py-2 text-ink-3 capitalize">{v.ingestion_method}</td>
                  <td className="py-2 text-gray-600">
                    {v.last_seen ? v.last_seen.slice(0, 10) : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {v.days_since == null ? (
                      <span className="text-ink-muted">never</span>
                    ) : (
                      <span
                        className={
                          v.days_since > 7
                            ? 'text-red-600 font-medium'
                            : v.days_since > 2
                              ? 'text-pop'
                              : 'text-green-600'
                        }
                      >
                        {v.days_since}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Card title="Recent failures (last 30 days)">
        {failures.length === 0 ? (
          <Empty>No failed files. Pipeline is clean.</Empty>
        ) : (
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-ink-muted text-xs border-b border-ink/[0.08]">
                <th className="text-left pb-2">When</th>
                <th className="text-left pb-2">Vendor</th>
                <th className="text-left pb-2">Source</th>
                <th className="text-left pb-2">Error</th>
                <th className="text-right pb-2">Retries</th>
                <th className="text-right pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2 text-ink-3">{f.uploaded_at.slice(0, 10)}</td>
                  <td className="py-2 text-ink">{f.vendor_name ?? '—'}</td>
                  <td className="py-2 text-ink-3 capitalize">{f.source ?? '—'}</td>
                  <td className="py-2 text-ink-3 truncate max-w-xs" title={f.error_message ?? ''}>
                    {f.error_message ?? '—'}
                  </td>
                  <td className="py-2 text-right text-ink-2">{f.retry_count ?? 0}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        f.status === 'dead' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      </div>
      <div className="font-display text-2xl font-extrabold text-ink">{value}</div>
      <div className="text-xs text-ink-muted mt-1">{sub}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-5">
      <h2 className="font-serif text-[18px] text-ink mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-ink-muted py-4">{children}</div>
}

function SourceBars({ sources }: { sources: Record<Source, number> }) {
  const max = Math.max(1, ...Object.values(sources))
  const order: Source[] = ['portal', 'email', 'upload', 'api']
  return (
    <div className="space-y-2">
      {order.map((s) => (
        <div key={s} className="flex items-center gap-3">
          <div className="text-xs text-ink-3 w-16 capitalize">{s}</div>
          <div className="flex-1 bg-ink/[0.08] rounded h-5 overflow-hidden">
            <div
              className="bg-pop h-full"
              style={{ width: `${(sources[s] / max) * 100}%` }}
            />
          </div>
          <div className="text-xs text-ink-2 w-10 text-right">{sources[s]}</div>
        </div>
      ))}
    </div>
  )
}

function StatusBars({ statuses }: { statuses: Record<Status, number> }) {
  const max = Math.max(1, ...Object.values(statuses))
  const order: Status[] = ['done', 'processing', 'pending', 'failed', 'dead']
  const colorByStatus: Record<Status, string> = {
    done: 'bg-green-500',
    processing: 'bg-amber-500',
    pending: 'bg-ink-muted',
    failed: 'bg-pop',
    dead: 'bg-red-500',
  }
  return (
    <div className="space-y-2">
      {order.map((s) => (
        <div key={s} className="flex items-center gap-3">
          <div className="text-xs text-ink-3 w-20 capitalize">{s}</div>
          <div className="flex-1 bg-ink/[0.08] rounded h-5 overflow-hidden">
            <div
              className={`${colorByStatus[s]} h-full`}
              style={{ width: `${(statuses[s] / max) * 100}%` }}
            />
          </div>
          <div className="text-xs text-ink-2 w-10 text-right">{statuses[s]}</div>
        </div>
      ))}
    </div>
  )
}
