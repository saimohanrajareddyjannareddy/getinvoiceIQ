'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { fetchPriceAlerts, type PriceAlert } from '@/lib/alerts'
import { TrendingUp, TrendingDown, X } from 'lucide-react'

// Alerts = price moves that need a human's attention. Computed live
// from invoice history (latest price vs previous purchase per item);
// no alerts table. Dismissals are stored per restaurant in
// localStorage and keyed to the specific move (item + date + price),
// so a NEWER price change on the same item alerts again.
export default function AlertsPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all')
  const [threshold, setThreshold] = useState(5)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [showDismissed, setShowDismissed] = useState(false)

  const storageKey = restaurantId ? `mise.alerts_dismissed.${restaurantId}` : null

  useEffect(() => {
    if (!storageKey) return
    try {
      setDismissed(JSON.parse(localStorage.getItem(storageKey) || '[]'))
    } catch {
      setDismissed([])
    }
  }, [storageKey])

  useEffect(() => {
    if (!restaurantId) return
    setLoading(true)
    fetchPriceAlerts(supabase, restaurantId, threshold)
      .then(setAlerts)
      .finally(() => setLoading(false))
  }, [restaurantId, threshold])

  const keyOf = (a: PriceAlert) => `${a.item_name}|${a.date}|${a.current.toFixed(2)}`

  function dismiss(a: PriceAlert) {
    if (!storageKey) return
    const next = [...dismissed, keyOf(a)]
    setDismissed(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // storage full/blocked — dismissal just won't persist
    }
  }

  function restoreAll() {
    if (!storageKey) return
    setDismissed([])
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }

  const visible = alerts.filter((a) => {
    const isDismissed = dismissed.includes(keyOf(a))
    if (showDismissed !== isDismissed) return false
    if (filter === 'up') return a.change > 0
    if (filter === 'down') return a.change < 0
    return true
  })
  const dismissedCount = alerts.filter((a) => dismissed.includes(keyOf(a))).length

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Alerts</h1>
      <p className="text-ink-muted text-sm mb-6">
        Supplier price moves of {threshold}% or more, latest purchase vs the one before it.
        An item needs at least two invoices before it can alert.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {([['all', 'All moves'], ['up', '↑ Price increases'], ['down', '↓ Price drops']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === val ? 'bg-pop text-white' : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'}`}>
            {label}
          </button>
        ))}
        <span className="mx-1 hidden sm:inline text-ink-muted">|</span>
        {([5, 10, 20] as const).map((t) => (
          <button key={t} onClick={() => setThreshold(t)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition ${threshold === t ? 'bg-ink text-cream' : 'border border-ink/[0.12] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt'}`}>
            ≥{t}%
          </button>
        ))}
        {dismissedCount > 0 && (
          <button onClick={() => setShowDismissed((s) => !s)}
            className="ml-auto text-sm text-ink-muted underline underline-offset-2 hover:text-ink-2">
            {showDismissed ? 'Back to active alerts' : `Dismissed (${dismissedCount})`}
          </button>
        )}
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] overflow-hidden">
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-cream-surface-alt border-b border-ink/[0.08]">
              <tr className="text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">Supplier</th>
                <th className="text-right px-4 py-3">Previous</th>
                <th className="text-right px-4 py-3">Current</th>
                <th className="text-right px-4 py-3">Change</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-ink-muted">Loading...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-ink-muted">
                  {showDismissed
                    ? 'No dismissed alerts at this threshold.'
                    : `No price moves of ${threshold}% or more — supplier prices are stable.`}
                </td></tr>
              ) : visible.map((a) => (
                <tr key={keyOf(a)} className="border-b border-ink/[0.06] last:border-0 hover:bg-cream-surface-alt">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{a.display_name}</span>
                    {Math.abs(a.change) >= 20 && (
                      <span className="ml-2 bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">Big move</span>
                    )}
                    <span className="block text-xs text-ink-muted">{a.category}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-3">{a.vendor || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-ink-muted">${a.previous.toFixed(2)}{a.unit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-ink">${a.current.toFixed(2)}{a.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`flex items-center justify-end gap-1 font-semibold ${a.change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {a.change > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {a.change > 0 ? '+' : ''}{a.change.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-3 text-right">
                    {showDismissed ? null : (
                      <button onClick={() => dismiss(a)} title="Dismiss this alert"
                        className="text-ink-muted hover:text-ink-2 transition">
                        <X size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showDismissed && dismissedCount > 0 && (
        <button onClick={restoreAll} className="mt-4 text-sm text-ink-muted underline underline-offset-2 hover:text-ink-2">
          Restore all dismissed alerts
        </button>
      )}
    </div>
  )
}
