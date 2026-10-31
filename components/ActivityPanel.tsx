'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useActivity, type ActivityEntry } from '@/lib/activity'
import {
  Activity,
  AlertCircle,
  CheckCircle,
  FileText,
  Mail,
  RefreshCw,
  X,
} from 'lucide-react'

/*
 * Activity panel — a fixed right-side feed of everything the app is
 * doing or just did: invoice parses, email scans, Clover syncs.
 * Lives in the dashboard layout, so it is visible from every page:
 * start a parse, walk to Home, come back — the process and its
 * outcome are still here.
 */

const KIND_ICON = {
  parse: FileText,
  'email-scan': Mail,
  'clover-sync': RefreshCw,
} as const

function elapsed(e: ActivityEntry, now: number): string {
  const secs = Math.max(0, Math.round(((e.finishedAt ?? now) - e.startedAt) / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function EntryRow({ e, now, onDismiss }: { e: ActivityEntry; now: number; onDismiss: () => void }) {
  const Icon = KIND_ICON[e.kind]
  const body = (
    <>
      <div className="mt-0.5 shrink-0">
        {e.status === 'running' ? (
          <div className="w-[18px] h-[18px] border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        ) : e.status === 'done' ? (
          <CheckCircle size={18} className="text-green-500" />
        ) : (
          <AlertCircle size={18} className="text-red-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="text-ink-muted shrink-0" />
          <span className="truncate text-sm font-medium text-ink">{e.title}</span>
        </div>
        <div
          className={`text-xs mt-0.5 ${
            e.status === 'error' ? 'text-red-600' : e.status === 'done' ? 'text-green-700' : 'text-ink-muted'
          }`}
        >
          {e.status === 'running'
            ? `Working… ${elapsed(e, now)}`
            : e.detail || (e.status === 'done' ? 'Done' : 'Failed')}
        </div>
        {e.status !== 'running' && (
          <div className="text-[11px] text-ink-muted mt-0.5">
            {new Date(e.finishedAt ?? e.startedAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}{' '}
            · took {elapsed(e, now)}
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex items-start gap-2.5 px-4 py-3 border-b border-ink/[0.06] last:border-0">
      {e.href && e.status !== 'running' ? (
        <Link href={e.href} className="flex items-start gap-2.5 min-w-0 flex-1 hover:opacity-80 transition">
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-2.5 min-w-0 flex-1">{body}</div>
      )}
      {e.status !== 'running' && (
        <button
          onClick={onDismiss}
          title="Dismiss"
          className="text-ink-muted hover:text-ink-3 transition shrink-0 mt-0.5"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export default function ActivityPanel() {
  const { entries, runningCount, dismiss, clearFinished } = useActivity()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Tick once a second while anything runs, so elapsed times move.
  useEffect(() => {
    if (runningCount === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [runningCount])

  const finishedCount = entries.length - runningCount

  return (
    <>
      {/* Floating button — parked in the bottom-right corner, out of
          the way of tables and totals (the old right-edge tab sat on
          top of the invoice TOTAL column). */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2.5 text-cream shadow-xl hover:bg-black transition"
        title="Activity — uploads, scans and syncs"
      >
        <Activity size={15} className={runningCount > 0 ? 'animate-pulse text-amber-400' : ''} />
        <span className="text-xs font-medium">Activity</span>
        {runningCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-pop text-[10px] font-bold text-white">
            {runningCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-[330px] max-w-[88vw] flex-col bg-cream-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-3.5">
              <Activity size={16} className="text-pop" />
              <span className="flex-1 text-sm font-semibold text-ink">Activity</span>
              {finishedCount > 0 && (
                <button
                  onClick={clearFinished}
                  className="text-xs text-ink-muted hover:text-ink-2 transition"
                >
                  Clear finished
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink-2 transition"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {entries.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-ink-muted">
                  Nothing yet. Uploads, email scans and Clover syncs will show up here —
                  start one and feel free to wander off; this panel keeps watch.
                </div>
              ) : (
                entries.map((e) => (
                  <EntryRow key={e.id} e={e} now={now} onDismiss={() => dismiss(e.id)} />
                ))
              )}
            </div>
            {runningCount > 0 && (
              <div className="border-t border-ink/[0.08] px-4 py-2.5 text-xs text-ink-muted">
                {runningCount} process{runningCount === 1 ? '' : 'es'} running — safe to
                navigate anywhere; results will be here.
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
