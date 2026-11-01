'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { CheckCircle2, Circle, X, Rocket } from 'lucide-react'

type Step = {
  key: string
  label: string
  hint: string
  href: string
  cta: string
  done: boolean
}

/*
 * First-run setup checklist for the dashboard home. Shows only while
 * setup is incomplete (and not dismissed); each step checks live data
 * rather than stored flags, so it can never disagree with reality:
 *   1. First invoice uploaded      -> invoice_headers has a row
 *   2. POS connected               -> restaurant_settings has Clover creds
 *   3. Food cost visible           -> invoices AND pos_sales exist
 *   4. Team invited                -> more than one membership row
 * Queries fail soft: if a table isn't reachable the step just stays
 * unchecked instead of breaking the home page.
 */
export default function SetupChecklist() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!restaurantId) return
    if (typeof window !== 'undefined') {
      setDismissed(localStorage.getItem(`mise.setup_dismissed.${restaurantId}`) === '1')
    }
    let cancelled = false
    ;(async () => {
      const count = async (
        table: string,
        extra?: (q: any) => any
      ): Promise<number> => {
        let q = supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
        if (extra) q = extra(q)
        const { count: c, error } = await q
        return error ? 0 : c ?? 0
      }
      const [invoices, sales, members] = await Promise.all([
        count('invoice_headers'),
        count('pos_sales'),
        count('user_restaurants'),
      ])
      let settingsRes = await supabase
        .from('restaurant_settings')
        .select('clover_merchant_id, clover_api_key, clover_token_enc')
        .eq('restaurant_id', restaurantId)
        .maybeSingle()
      if (settingsRes.error) {
        // Pre-012 database: no OAuth token column yet.
        settingsRes = await supabase
          .from('restaurant_settings')
          .select('clover_merchant_id, clover_api_key')
          .eq('restaurant_id', restaurantId)
          .maybeSingle()
      }
      const settings = settingsRes.data as {
        clover_merchant_id?: string | null
        clover_api_key?: string | null
        clover_token_enc?: string | null
      } | null
      if (cancelled) return
      const posConnected = !!(
        settings?.clover_merchant_id &&
        (settings?.clover_api_key || settings?.clover_token_enc)
      )
      setSteps([
        {
          key: 'invoice',
          label: 'Upload your first invoice',
          hint: 'Snap a photo or drop a PDF — AI reads every line.',
          href: '/dashboard/upload',
          cta: 'Upload',
          done: invoices > 0,
        },
        {
          key: 'pos',
          label: 'Connect your POS',
          hint: 'Link Clover so sales flow in next to your costs.',
          href: '/dashboard/settings',
          cta: 'Connect',
          done: posConnected,
        },
        {
          key: 'foodcost',
          label: 'See your food cost %',
          hint: 'Your spend vs. sales, on one screen.',
          href: '/dashboard/food-cost',
          cta: 'View',
          done: invoices > 0 && sales > 0,
        },
        {
          key: 'team',
          label: 'Invite your team',
          hint: 'Add a manager or bookkeeper so it’s not all on you.',
          href: '/dashboard/settings',
          cta: 'Invite',
          done: members > 1,
        },
      ])
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  if (!steps || dismissed) return null
  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null

  return (
    <div className="mb-6 rounded-[16px] border border-ink/[0.08] bg-cream-surface p-5">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-[20px] text-ink">
          <Rocket size={19} className="text-terracotta" />
          Get set up
        </h2>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          onClick={() => {
            setDismissed(true)
            if (restaurantId && typeof window !== 'undefined') {
              localStorage.setItem(`mise.setup_dismissed.${restaurantId}`, '1')
            }
          }}
          className="text-ink-muted transition hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      <p className="mb-4 text-[13px] text-ink-3">
        {doneCount} of {steps.length} done — finish these and getinvoiceIQ runs itself.
      </p>
      <div className="h-1.5 mb-5 overflow-hidden rounded-full bg-ink/[0.08]">
        <div
          className="h-full rounded-full bg-terracotta transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ul className="space-y-3">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3">
            {s.done ? (
              <CheckCircle2 size={20} className="shrink-0 text-green-600" />
            ) : (
              <Circle size={20} className="shrink-0 text-ink/[0.25]" />
            )}
            <div className="min-w-0 flex-1">
              <div className={`text-[14px] font-medium ${s.done ? 'text-ink-muted line-through' : 'text-ink'}`}>
                {s.label}
              </div>
              {!s.done && <div className="text-[12px] text-ink-3">{s.hint}</div>}
            </div>
            {!s.done && (
              <Link
                href={s.href}
                className="shrink-0 rounded-[8px] bg-terracotta px-3 py-1.5 text-[13px] font-semibold text-[#FDF8F0] transition hover:bg-terracotta-hover"
              >
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
