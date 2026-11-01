'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  effectiveBuyUnit,
  toBase,
  usableCostPerBase,
  UNIT_SIZE_UNITS,
  type CanonicalItem,
  type IngredientCost,
  type IngredientSetting,
} from '@/lib/recipes'

/*
 * Pack sizes and usable yield per ingredient (sql/020).
 *
 * - Pack size: invoices that buy by the case can't be priced until the
 *   app knows what one case holds ("1 case = 4 GAL").
 * - Usable yield: recipes are written in usable quantities (peeled
 *   onion, trimmed chicken), so plate cost = purchase price ÷ yield.
 * - "1 on invoice =": what one invoice unit really is when the invoice
 *   says "1" for a 35 lb jug or a bunch of cilantro (sql/021).
 */

export interface SettingsRow {
  item: CanonicalItem
  cost: IngredientCost | undefined
  needsPack: boolean
}

// 'each' is stored as-is; staff think of it as a count (bunches, cans, pieces).
const UNIT_LABELS: Record<string, string> = { each: 'ct (count)' }

const card = 'rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]'
const input =
  'w-[84px] rounded-md border border-ink/15 bg-cream-surface px-2 py-1 text-right font-mono text-[13px] text-ink'

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Cost per one default_unit (e.g. per LB) from a cost per base unit. */
function perDefaultUnit(costPerBase: number | null, unit: string | null): number | null {
  if (costPerBase == null || !unit) return null
  const one = toBase(1, unit)
  return one ? costPerBase * one.base : null
}

export default function IngredientSettingsCard({
  restaurantId,
  rows,
  settings,
  missing,
  unitSizeMissing,
  onSaved,
}: {
  restaurantId: string
  rows: SettingsRow[]
  settings: Map<string, IngredientSetting>
  missing: boolean
  unitSizeMissing: boolean
  onSaved: () => void
}) {
  type Draft = { pack: string; yieldPct: string; size: string; sizeUnit: string }
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const savedDraft = (id: string): Draft => {
    const s = settings.get(id)
    return {
      pack: s?.packQty != null ? String(s.packQty) : '',
      yieldPct: s ? String(s.yieldPct) : '100',
      size: s?.unitSize != null ? String(s.unitSize) : '',
      sizeUnit: s?.unitSizeUnit ?? 'lb',
    }
  }
  const draftFor = (id: string): Draft => drafts[id] ?? savedDraft(id)

  async function save(item: CanonicalItem) {
    const d = draftFor(item.id)
    const pack = d.pack.trim() === '' ? null : Number(d.pack)
    const yieldPct = Number(d.yieldPct)
    const size = d.size.trim() === '' ? null : Number(d.size)
    if (size != null && !(size > 0)) {
      setError(`${item.name}: “1 on invoice =” must be a number above 0, or empty.`)
      return
    }
    if (pack != null && !(pack > 0)) {
      setError(`${item.name}: pack size must be a number above 0, or empty.`)
      return
    }
    if (!(yieldPct > 0 && yieldPct <= 100)) {
      setError(`${item.name}: usable yield must be between 1 and 100%.`)
      return
    }
    setError(null)
    setSaving(item.id)
    const { error: err } = await supabase.from('ingredient_settings').upsert(
      {
        restaurant_id: restaurantId,
        canonical_item_id: item.id,
        pack_qty: pack,
        yield_pct: yieldPct,
        ...(unitSizeMissing
          ? {}
          : { unit_size: size, unit_size_unit: size != null ? d.sizeUnit : null }),
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

  const needsPackCount = rows.filter((r) => r.needsPack).length

  return (
    <div className={`${card} mt-6`}>
      <h2 className="font-serif text-[22px] text-ink">Ingredient costs — pack size & usable yield</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
        Two numbers that make plate costs honest. <strong className="text-ink-2">Pack size</strong>:
        what one case holds, so case purchases can be priced. <strong className="text-ink-2">Usable
        yield</strong>: what’s left after peeling and trimming (onion ≈ 90%, whole chicken ≈ 70%) —
        recipes use the usable amount, so you pay for the loss on every plate.{' '}
        <strong className="text-ink-2">1 on invoice =</strong>: when the invoice says “1” for a
        whole jug, case or bunch, enter what it really is: oil 1 = 35 lb; a cilantro case 1 = 20 ct
        (bunches). If your recipes measure it by weight instead, use the weight (20 bunches × 3 oz
        = 60 oz).
      </p>
      {!missing && unitSizeMissing && (
        <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
          <span className="font-semibold text-terracotta">One setup step:</span> run{' '}
          <span className="font-mono">sql/021_unit_size.sql</span> in the Supabase SQL editor to
          turn on “1 on invoice =”.
        </div>
      )}

      {missing ? (
        <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
          <span className="font-semibold text-terracotta">One setup step:</span> run{' '}
          <span className="font-mono">sql/020_ingredient_settings.sql</span> in the Supabase SQL
          editor to turn these settings on. Costs keep working as before until then.
        </div>
      ) : (
        <>
          {needsPackCount > 0 && (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              <span className="font-semibold text-terracotta">
                {needsPackCount} ingredient{needsPackCount === 1 ? '' : 's'} bought by the case
              </span>{' '}
              can’t be priced yet. Enter what one case holds and every dish using them gets a cost.
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              {error}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink-muted">
              Ingredients appear here once a recipe uses them.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Ingredient</th>
                    <th className="px-3 py-2 text-right font-medium">Bought at</th>
                    <th className="px-3 py-2 text-right font-medium">1 on invoice =</th>
                    <th className="px-3 py-2 text-right font-medium">1 case =</th>
                    <th className="px-3 py-2 text-right font-medium">Usable</th>
                    <th className="px-3 py-2 text-right font-medium">Real cost</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, cost, needsPack }) => {
                    const d = draftFor(item.id)
                    const s = settings.get(item.id)
                    // Prices show per the unit it's effectively bought in.
                    const unit = effectiveBuyUnit(item, s) ?? ''
                    const bought = perDefaultUnit(cost?.costPerBase ?? null, unit)
                    // Preview the usable cost with the yield being typed.
                    const typedYield = Number(d.yieldPct)
                    const preview =
                      cost && cost.costPerBase != null
                        ? usableCostPerBase({
                            ...cost,
                            yieldPct: typedYield > 0 && typedYield <= 100 ? typedYield : cost.yieldPct,
                          })
                        : null
                    const real = perDefaultUnit(preview, unit)
                    const saved = savedDraft(item.id)
                    const dirty =
                      d.pack !== saved.pack ||
                      d.yieldPct !== saved.yieldPct ||
                      d.size !== saved.size ||
                      (d.size !== '' && d.sizeUnit !== saved.sizeUnit)
                    return (
                      <tr key={item.id} className="border-b border-ink/[0.05] last:border-0">
                        <td className="py-2 pr-3 text-ink">
                          {item.name}
                          {needsPack && (
                            <span className="ml-2 rounded-full bg-terracotta/10 px-2 py-0.5 text-[11px] font-semibold text-terracotta">
                              needs pack size
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-3">
                          {bought != null ? `${money(bought)}/${unit}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <input
                            aria-label={`${item.name}: what one invoice unit really is`}
                            inputMode="decimal"
                            className={input}
                            placeholder="—"
                            disabled={unitSizeMissing}
                            value={d.size}
                            onChange={(e) => setDrafts((p) => ({ ...p, [item.id]: { ...d, size: e.target.value } }))}
                          />
                          <select
                            aria-label={`${item.name}: unit`}
                            disabled={unitSizeMissing}
                            value={d.sizeUnit}
                            onChange={(e) => setDrafts((p) => ({ ...p, [item.id]: { ...d, sizeUnit: e.target.value } }))}
                            className="ml-1 rounded-md border border-ink/15 bg-cream-surface px-1 py-1 text-[12px] text-ink"
                          >
                            {UNIT_SIZE_UNITS.map((u) => (
                              <option key={u} value={u}>{UNIT_LABELS[u] ?? u}</option>
                            ))}
                          </select>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <input
                            aria-label={`${item.name} units per case`}
                            inputMode="decimal"
                            className={input}
                            placeholder="—"
                            value={d.pack}
                            onChange={(e) => setDrafts((p) => ({ ...p, [item.id]: { ...d, pack: e.target.value } }))}
                          />
                          <span className="ml-1 text-[12px] text-ink-muted">{item.default_unit ?? ''}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            aria-label={`${item.name} usable yield percent`}
                            inputMode="decimal"
                            className={input}
                            value={d.yieldPct}
                            onChange={(e) => setDrafts((p) => ({ ...p, [item.id]: { ...d, yieldPct: e.target.value } }))}
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
