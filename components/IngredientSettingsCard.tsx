'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  effectiveBuyUnit,
  toBase,
  usableCostPerBase,
  type CanonicalItem,
  type IngredientCost,
  type IngredientSetting,
} from '@/lib/recipes'

/*
 * Usable yield per ingredient (sql/020): recipes are written in usable
 * quantities (peeled onion, trimmed chicken), so plate cost = purchase
 * price ÷ yield. Pack sizes live on the Pack sizes page, per store
 * product; the older per-ingredient pack values (020/021) still apply
 * as a fallback but are no longer edited here.
 */

export interface SettingsRow {
  item: CanonicalItem
  cost: IngredientCost | undefined
  needsPack: boolean
}

const card = 'rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]'
const input =
  'w-[72px] rounded-md border border-ink/15 bg-cream-surface px-2 py-1 text-right font-mono text-[13px] text-ink'

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Cost per one display unit (e.g. per LB) from a cost per base unit. */
function perUnit(costPerBase: number | null, unit: string | null): number | null {
  if (costPerBase == null || !unit) return null
  const one = toBase(1, unit)
  return one ? costPerBase * one.base : null
}

/** Weight-priced items show per lb, whatever unit the catalog uses. */
function displayUnit(cost: IngredientCost | undefined, fallback: string | null): string | null {
  if (cost?.baseKind === 'g') return 'lb'
  if (cost?.baseKind === 'ml') return 'gal'
  if (cost?.baseKind === 'each') return 'ct'
  return fallback
}

export default function IngredientSettingsCard({
  restaurantId,
  rows,
  settings,
  missing,
  onSaved,
}: {
  restaurantId: string
  rows: SettingsRow[]
  settings: Map<string, IngredientSetting>
  missing: boolean
  onSaved: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const savedYield = (id: string) => {
    const s = settings.get(id)
    return s ? String(s.yieldPct) : '100'
  }
  const draftFor = (id: string) => drafts[id] ?? savedYield(id)

  async function save(item: CanonicalItem) {
    const yieldPct = Number(draftFor(item.id))
    if (!(yieldPct > 0 && yieldPct <= 100)) {
      setError(`${item.name}: usable % must be between 1 and 100.`)
      return
    }
    setError(null)
    setSaving(item.id)
    // Only the yield is written: an upsert leaves the other columns
    // (older per-ingredient pack values) as they are.
    const { error: err } = await supabase.from('ingredient_settings').upsert(
      {
        restaurant_id: restaurantId,
        canonical_item_id: item.id,
        yield_pct: yieldPct,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id,canonical_item_id' }
    )
    setSaving(null)
    if (err) {
      setError(`Couldn’t save ${item.name}: ${err.message}`)
      return
    }
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    onSaved()
  }

  const needsPack = rows.filter((r) => r.needsPack)

  return (
    <div className={`${card} mt-6`}>
      <h2 className="font-serif text-[22px] text-ink">Ingredient costs — usable %</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
        Recipes use the <em>usable</em> amount — peeled onion, trimmed chicken — so every plate pays
        for what’s lost in prep. Set what’s left after peeling and trimming (onion ≈ 90%, whole
        chicken ≈ 70%, boneless breast ≈ 95%). Real cost = bought price ÷ usable %, and that’s what
        plate costs use.
      </p>

      {missing ? (
        <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
          <span className="font-semibold text-terracotta">One setup step:</span> run{' '}
          <span className="font-mono">sql/020_ingredient_settings.sql</span> in the Supabase SQL
          editor to turn this on. Costs keep working as before until then.
        </div>
      ) : (
        <>
          {needsPack.length > 0 && (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              <span className="font-semibold text-terracotta">
                {needsPack.length} ingredient{needsPack.length === 1 ? '' : 's'} bought by the case
              </span>{' '}
              can’t be priced yet ({needsPack.slice(0, 4).map((r) => r.item.name).join(', ')}
              {needsPack.length > 4 ? '…' : ''}).{' '}
              <Link href="/dashboard/pack-sizes" className="font-semibold text-pop underline">
                Set what a case holds on Pack sizes →
              </Link>
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              {error}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink-muted">Ingredients appear here once a recipe uses them.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Ingredient</th>
                    <th className="px-3 py-2 text-right font-medium">Bought at</th>
                    <th className="px-3 py-2 text-right font-medium">Usable</th>
                    <th className="px-3 py-2 text-right font-medium">Real cost</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, cost, needsPack: np }) => {
                    const unit = displayUnit(cost, effectiveBuyUnit(item, settings.get(item.id)))
                    const bought = perUnit(cost?.costPerBase ?? null, unit)
                    const typed = Number(draftFor(item.id))
                    const real =
                      cost && cost.costPerBase != null
                        ? perUnit(
                            usableCostPerBase({ ...cost, yieldPct: typed > 0 && typed <= 100 ? typed : cost.yieldPct }),
                            unit
                          )
                        : null
                    const dirty = draftFor(item.id) !== savedYield(item.id)
                    return (
                      <tr key={item.id} className="border-b border-ink/[0.05] last:border-0">
                        <td className="py-2 pr-3 text-ink">
                          {item.name}
                          {np && (
                            <Link
                              href="/dashboard/pack-sizes"
                              className="ml-2 rounded-full bg-terracotta/10 px-2 py-0.5 text-[11px] font-semibold text-terracotta"
                            >
                              needs pack size
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-3">
                          {bought != null ? `${money(bought)}/${unit}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <input
                            aria-label={`${item.name} usable percent`}
                            inputMode="decimal"
                            className={input}
                            value={draftFor(item.id)}
                            onChange={(e) => setDrafts((p) => ({ ...p, [item.id]: e.target.value }))}
                          />
                          <span className="ml-1 text-[12px] text-ink-muted">%</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink">
                          {real != null ? `${money(real)}/${unit}` : '—'}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <button
                            type="button"
                            disabled={!dirty || saving === item.id}
                            onClick={() => save(item)}
                            className="rounded-md bg-pop px-3 py-1 text-[12.5px] font-semibold text-white disabled:opacity-30"
                          >
                            {saving === item.id ? 'Saving…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
