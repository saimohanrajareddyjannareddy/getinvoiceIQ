'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { isNonFood } from '@/lib/food-cost'
import {
  fetchCanonicalItems,
  fetchIngredientSettings,
  purchasedBase,
  purchasedQty,
  type BaseKind,
  type CanonicalItem,
  type IngredientSetting,
} from '@/lib/recipes'
import {
  fetchProductPacks,
  lineBaseFromPack,
  normKey,
  packBase,
  packKey,
  PACK_UNITS,
  scaleUnit,
  suggestPack,
  toScale,
  type ProductPack,
} from '@/lib/packs'

/*
 * Pack sizes: every product bought, per store, broken down to one scale
 * per ingredient (pounds / gallons / count). The owner tells the app
 * what one case of each store's product holds (24 x 16 oz, 30 x 12 oz,
 * 20 x 200 g); from then on every purchase of it converts, so the same
 * ingredient from different stores can be compared, costed per pound,
 * and used for recipe costs, usage and wastage (sql/022).
 */

const DAYS = 120
const card = 'rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]'
const input =
  'w-[64px] rounded-md border border-ink/15 bg-cream-surface px-2 py-1 text-right font-mono text-[13px] text-ink'
const UNIT_LABELS: Record<string, string> = { each: 'ct', floz: 'fl oz' }
const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const qtyFmt = (n: number) =>
  n >= 100 ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US')

type Line = {
  header_id: string
  item_name: string | null
  display_name: string | null
  category: string | null
  canonical_item_id: string | null
  purchase_unit: string | null
  unit_qty: number | null
  case_qty: number | null
  total: number | null
}

type Product = {
  key: string
  vendor: string
  itemName: string
  displayName: string
  ingredient: CanonicalItem | null
  category: string | null
  purchaseUnit: string
  purchases: number
  spent: number
  boughtUnits: number
  /** Total on the ingredient's scale; null when the pack is unknown. */
  scaled: { qty: number; kind: BaseKind } | null
  /** Lines that couldn't be converted (no pack known). */
  unconverted: number
  lastDate: string
}

type Draft = { count: string; size: string; unit: string }

export default function PackSizesPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const reqSeq = useRef(0)

  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [packs, setPacks] = useState<Map<string, ProductPack>>(new Map())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [foodOnly, setFoodOnly] = useState(true)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [q, setQ] = useState('')

  async function load() {
    if (!restaurantId) return
    const seq = ++reqSeq.current
    const stale = () => seq !== reqSeq.current
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const [packRes, canon, settingsRes, headerRes] = await Promise.all([
      fetchProductPacks(supabase, restaurantId),
      fetchCanonicalItems(supabase),
      fetchIngredientSettings(supabase, restaurantId),
      supabase
        .from('invoice_headers')
        .select('id, vendor, invoice_date, review_status')
        .eq('restaurant_id', restaurantId)
        .gte('invoice_date', since),
    ])
    if (stale()) return
    const headers = ((headerRes.data ?? []) as { id: string; vendor: string | null; invoice_date: string; review_status?: string | null }[])
      .filter((h) => h.review_status !== 'needs_review')
    const byHeader = new Map(headers.map((h) => [h.id, h]))
    const lines: Line[] = []
    const ids = headers.map((h) => h.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase
        .from('invoice_lines')
        .select('header_id, item_name, display_name, category, canonical_item_id, purchase_unit, unit_qty, case_qty, total')
        .in('header_id', ids.slice(i, i + 200))
      lines.push(...((data ?? []) as Line[]))
    }
    if (stale()) return

    const canonById = new Map(canon.map((c) => [c.id, c]))
    const map = new Map<string, Product>()
    for (const l of lines) {
      const h = byHeader.get(l.header_id)
      if (!h || !l.item_name) continue
      const total = l.total || 0
      if (total <= 0) continue // credits, deposits, discounts
      const key = packKey(h.vendor, l.item_name)
      const ingredient = l.canonical_item_id ? canonById.get(l.canonical_item_id) ?? null : null
      const p =
        map.get(key) ??
        ({
          key,
          vendor: h.vendor || 'Unknown vendor',
          itemName: l.item_name,
          displayName: l.display_name || l.item_name,
          ingredient,
          category: l.category,
          purchaseUnit: (l.purchase_unit || 'each').toLowerCase(),
          purchases: 0,
          spent: 0,
          boughtUnits: 0,
          scaled: null,
          unconverted: 0,
          lastDate: h.invoice_date,
        } as Product)
      p.purchases += 1
      p.spent += total
      if (h.invoice_date >= p.lastDate) {
        p.lastDate = h.invoice_date
        p.purchaseUnit = (l.purchase_unit || p.purchaseUnit).toLowerCase()
      }
      const units = Number(l.case_qty || 0) > 0 ? Number(l.case_qty) : Number(l.unit_qty || 0)
      p.boughtUnits += units
      // Same order as costing: product pack, sold by lb, ingredient settings.
      let base = lineBaseFromPack(l, packRes.packs.get(key))
      if (!base && ingredient) {
        const setting: IngredientSetting | undefined = settingsRes.settings.get(ingredient.id)
        const qty = purchasedQty(l, setting?.packQty)
        if (qty != null) base = purchasedBase(qty, ingredient.default_unit, setting)
      }
      if (base && base.base > 0 && (!p.scaled || p.scaled.kind === base.kind)) {
        p.scaled = { qty: (p.scaled?.qty ?? 0) + base.base, kind: base.kind }
      } else {
        p.unconverted += 1
      }
      map.set(key, p)
    }
    setMissing(packRes.missing)
    setPacks(packRes.packs)
    setProducts([...map.values()])
    setLoading(false)
  }

  useEffect(() => {
    if (!restaurantId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads current state; restaurantId is its input
  }, [restaurantId])

  const draftFor = (p: Product): Draft => {
    if (drafts[p.key]) return drafts[p.key]
    const saved = packs.get(p.key)
    if (saved) return { count: String(saved.packCount), size: String(saved.packSize), unit: saved.packUnit }
    const hint = suggestPack(p.itemName)
    if (hint) return { count: String(hint.packCount), size: String(hint.packSize), unit: hint.packUnit }
    return { count: '1', size: '', unit: 'lb' }
  }

  async function save(p: Product) {
    if (!restaurantId) return
    const d = draftFor(p)
    const count = Number(d.count)
    const size = Number(d.size)
    if (!(count > 0) || !(size > 0)) {
      setError(`${p.displayName}: enter how many packs (1 or more) and the size of each.`)
      return
    }
    setError(null)
    setSaving(p.key)
    const [vendorKey, itemKey] = [normKey(p.vendor === 'Unknown vendor' ? '' : p.vendor), normKey(p.itemName)]
    const { error: err } = await supabase.from('product_packs').upsert(
      {
        restaurant_id: restaurantId,
        vendor_key: vendorKey,
        item_key: itemKey,
        canonical_item_id: p.ingredient?.id ?? null,
        pack_count: count,
        pack_size: size,
        pack_unit: d.unit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id,vendor_key,item_key' }
    )
    setSaving(null)
    if (err) {
      setError(`Couldn’t save ${p.displayName}: ${err.message}`)
      return
    }
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[p.key]
      return next
    })
    load()
  }

  // ---- derived ----
  const ql = q.trim().toLowerCase()
  const shown = products
    .filter((p) => !foodOnly || !isNonFood(p.category))
    .filter((p) => !onlyMissing || (p.purchaseUnit !== 'lb' && !packs.has(p.key)))
    .filter(
      (p) =>
        !ql ||
        p.displayName.toLowerCase().includes(ql) ||
        p.itemName.toLowerCase().includes(ql) ||
        p.vendor.toLowerCase().includes(ql) ||
        (p.ingredient?.name ?? '').includes(ql)
    )
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || b.spent - a.spent)
  const missingCount = products.filter(
    (p) => (!foodOnly || !isNonFood(p.category)) && p.purchaseUnit !== 'lb' && !packs.has(p.key)
  ).length

  // Per ingredient, across stores, on one scale.
  const byIngredient = (() => {
    const m = new Map<string, { name: string; kind: BaseKind; qty: number; spent: number; stores: Map<string, { qty: number; spent: number }>; partial: boolean }>()
    for (const p of products) {
      if (!p.ingredient || !p.scaled) continue
      if (foodOnly && isNonFood(p.category)) continue
      const cur =
        m.get(p.ingredient.name) ??
        { name: p.ingredient.name, kind: p.scaled.kind, qty: 0, spent: 0, stores: new Map(), partial: false }
      if (cur.kind !== p.scaled.kind) {
        cur.partial = true
        m.set(p.ingredient.name, cur)
        continue
      }
      cur.qty += p.scaled.qty
      // Only the spend on lines that converted, so $/lb is honest.
      const share = p.purchases > 0 ? (p.purchases - p.unconverted) / p.purchases : 0
      cur.spent += p.spent * share
      if (p.unconverted > 0) cur.partial = true
      const st = cur.stores.get(p.vendor) ?? { qty: 0, spent: 0 }
      st.qty += p.scaled.qty
      st.spent += p.spent * share
      cur.stores.set(p.vendor, st)
      m.set(p.ingredient.name, cur)
    }
    return [...m.values()].sort((a, b) => b.spent - a.spent)
  })()

  if (!restaurantId) return null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <div className="mt-6">
        <h1 className="font-serif text-[28px] text-ink">Pack sizes</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-ink-muted">
          Every product you buy, broken down to one scale: <strong className="text-ink-2">pounds</strong>{' '}
          for food and dry goods, gallons for liquids, count for things you count. Tell us once what a
          case from each store holds (Restaurant Depot cornstarch 24 × 16 oz, Costco 30 × 12 oz) and
          every purchase converts, so stores compare per pound and recipes, usage and wastage use the
          same scale. Last {DAYS} days.
        </p>
      </div>

      {missing && (
        <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
          <span className="font-semibold text-terracotta">One setup step:</span> run{' '}
          <span className="font-mono">sql/022_product_packs.sql</span> in the Supabase SQL editor to
          save pack sizes. You can look around until then; saving won’t work yet.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-[13.5px] text-ink-muted">Loading products…</p>
      ) : (
        <>
          {/* BY INGREDIENT */}
          <div className={`${card} mt-6`}>
            <h2 className="font-serif text-[22px] text-ink">Bought, on one scale</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
              Each ingredient’s purchases from every store added up, and what a pound really cost at
              each store.
            </p>
            {byIngredient.length === 0 ? (
              <p className="mt-4 text-[13px] text-ink-muted">
                Nothing converted yet. Set pack sizes below and this fills in.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                      <th className="py-2 pr-3 font-medium">Ingredient</th>
                      <th className="px-3 py-2 text-right font-medium">Bought</th>
                      <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                      <th className="py-2 pl-3 font-medium">By store</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byIngredient.map((r) => {
                      const unit = scaleUnit(r.kind)
                      const qty = toScale(r.qty, r.kind)
                      return (
                        <tr key={r.name} className="border-b border-ink/[0.05] align-top last:border-0">
                          <td className="py-2.5 pr-3 font-medium text-ink">
                            {r.name}
                            {r.partial && (
                              <span className="ml-2 text-[11px] font-normal text-terracotta" title="Some purchases have no pack size yet">
                                partial
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-ink">
                            {qtyFmt(qty)} {unit}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-ink">
                            {qty > 0 ? `${money(r.spent / qty)}/${unit}` : '—'}
                          </td>
                          <td className="py-2.5 pl-3 text-[12.5px] text-ink-3">
                            {[...r.stores.entries()].map(([store, st]) => {
                              const sq = toScale(st.qty, r.kind)
                              return (
                                <div key={store}>
                                  {store}: {qtyFmt(sq)} {unit}
                                  {sq > 0 && <> · {money(st.spent / sq)}/{unit}</>}
                                </div>
                              )
                            })}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* PRODUCTS */}
          <div className={`${card} mt-6`}>
            <h2 className="font-serif text-[22px] text-ink">Products by store</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
              <strong className="text-ink-2">1 case =</strong> how many packs × the size of one pack.
              Cilantro case: 20 × 200 g. Yogurt case: 4 × 1 lb. Chicken case: 1 × 40 lb. Where the
              product name prints it (“24/16OZ”) it’s filled in for you; check it and save. Items sold
              by the pound need nothing.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search product, store or ingredient…"
                className="min-w-[200px] flex-1 rounded-md border border-ink/15 bg-cream-surface px-3 py-1.5 text-[13px] text-ink"
              />
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                Needs pack size ({missingCount})
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                <input type="checkbox" checked={foodOnly} onChange={(e) => setFoodOnly(e.target.checked)} />
                Hide cleaning & packaging
              </label>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Store</th>
                    <th className="px-3 py-2 text-right font-medium">Bought</th>
                    <th className="px-3 py-2 text-right font-medium">1 case / unit =</th>
                    <th className="px-3 py-2 text-right font-medium">On one scale</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const byLb = p.purchaseUnit === 'lb'
                    const saved = packs.get(p.key)
                    const d = draftFor(p)
                    const preview = packBase({ packCount: Number(d.count), packSize: Number(d.size), packUnit: d.unit })
                    const dirty =
                      !saved ||
                      d.count !== String(saved.packCount) ||
                      d.size !== String(saved.packSize) ||
                      d.unit !== saved.packUnit
                    const unitWord = p.purchaseUnit === 'case' ? 'case' : p.purchaseUnit === 'each' ? 'each' : p.purchaseUnit
                    const scaledQty = p.scaled ? toScale(p.scaled.qty, p.scaled.kind) : null
                    const scaleU = p.scaled ? scaleUnit(p.scaled.kind) : ''
                    return (
                      <tr key={p.key} className="border-b border-ink/[0.05] align-top last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-ink">{p.displayName}</div>
                          <div className="font-mono text-[11.5px] text-ink-muted">{p.itemName}</div>
                          {p.ingredient && <div className="text-[11.5px] text-ink-muted">→ {p.ingredient.name}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-ink-3">{p.vendor}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-3">
                          {qtyFmt(p.boughtUnits)} {unitWord}
                          <div className="text-[11.5px]">{money(p.spent)}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {byLb ? (
                            <span className="text-[12.5px] text-ink-muted">sold by the lb ✓</span>
                          ) : (
                            <>
                              <input
                                aria-label={`${p.displayName}: packs per ${unitWord}`}
                                inputMode="decimal"
                                className={input}
                                value={d.count}
                                onChange={(e) => setDrafts((x) => ({ ...x, [p.key]: { ...d, count: e.target.value } }))}
                              />
                              <span className="mx-1 text-ink-muted">×</span>
                              <input
                                aria-label={`${p.displayName}: size of one pack`}
                                inputMode="decimal"
                                className={input}
                                placeholder="size"
                                value={d.size}
                                onChange={(e) => setDrafts((x) => ({ ...x, [p.key]: { ...d, size: e.target.value } }))}
                              />
                              <select
                                aria-label={`${p.displayName}: pack unit`}
                                value={d.unit}
                                onChange={(e) => setDrafts((x) => ({ ...x, [p.key]: { ...d, unit: e.target.value } }))}
                                className="ml-1 rounded-md border border-ink/15 bg-cream-surface px-1 py-1 text-[12px] text-ink"
                              >
                                {PACK_UNITS.map((u) => (
                                  <option key={u} value={u}>{UNIT_LABELS[u] ?? u}</option>
                                ))}
                              </select>
                              <div className="mt-1 text-[11.5px] text-ink-muted">
                                {preview
                                  ? `= ${qtyFmt(toScale(preview.base, preview.kind))} ${scaleUnit(preview.kind)} per ${unitWord}`
                                  : !saved && suggestPack(p.itemName) == null
                                    ? 'not set'
                                    : ''}
                                {!saved && suggestPack(p.itemName) && ' · read from name, check & save'}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {scaledQty != null ? (
                            <>
                              {qtyFmt(scaledQty)} {scaleU}
                              {scaledQty > 0 && p.unconverted === 0 && (
                                <div className="text-[11.5px] text-ink-muted">{money(p.spent / scaledQty)}/{scaleU}</div>
                              )}
                            </>
                          ) : (
                            <span className="text-terracotta">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {!byLb && (
                            <button
                              type="button"
                              disabled={missing || !dirty || saving === p.key}
                              onClick={() => save(p)}
                              className="rounded-md bg-pop px-3 py-1 text-[12.5px] font-semibold text-white disabled:opacity-30"
                            >
                              {saving === p.key ? 'Saving…' : saved ? 'Update' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {shown.length === 0 && (
                <p className="mt-4 text-[13px] text-ink-muted">No products match.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
