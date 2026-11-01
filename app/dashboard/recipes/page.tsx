'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import {
  calibrationHints,
  fetchCanonicalItems,
  fetchDishSales,
  fetchIngredientCosts,
  fetchIngredientSettings,
  fetchRecipeMeta,
  fetchRecipes,
  fetchUsageVariance,
  formatBaseQty,
  mergeComponentCosts,
  plateCost,
  recipeStatus,
  toBase,
  unitKind,
  usableCostPerBase,
  FREE_INGREDIENTS,
  RECIPE_UNITS,
  type CanonicalItem,
  type DishSales,
  type IngredientCost,
  type IngredientSetting,
  type RecipeLine,
  type RecipeMeta,
  type CalibrationHint,
  type VarianceRow,
} from '@/lib/recipes'
import IngredientSettingsCard from '@/components/IngredientSettingsCard'
import { isNonFood } from '@/lib/food-cost'

// Recipes & dish costing (stage 1): dishes come from POS sales,
// the AI drafts a per-serving recipe from the restaurant's own
// ingredient catalog, the owner edits + confirms it, and the plate
// cost prices every ingredient at its latest invoice cost.

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const card = 'rounded-[14px] border border-ink/[0.08] bg-cream-surface p-[22px]'

type EditLine = { ingredient_name: string; quantity: string; unit: string }

export default function RecipesPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null

  const [dishes, setDishes] = useState<DishSales[]>([])
  const [recipes, setRecipes] = useState<Map<string, RecipeLine[]>>(new Map())
  const [costs, setCosts] = useState<Map<string, IngredientCost>>(new Map())
  const [canonical, setCanonical] = useState<CanonicalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  const [editing, setEditing] = useState<string | null>(null)
  const [editLines, setEditLines] = useState<EditLine[]>([])
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState<string | null>(null)

  const [period, setPeriod] = useState<'30d' | 'month' | 'lastMonth'>('30d')
  const [variance, setVariance] = useState<VarianceRow[]>([])
  const [varianceError, setVarianceError] = useState<string | null>(null)
  const [varianceRange, setVarianceRange] = useState<{ start: string; end: string } | null>(null)
  const [dismissedCalib, setDismissedCalib] = useState<string[]>([])

  const [ingSettings, setIngSettings] = useState<Map<string, IngredientSetting>>(new Map())
  const [ingSettingsMissing, setIngSettingsMissing] = useState(false)
  const [needsPack, setNeedsPack] = useState<Set<string>>(new Set())
  const [meta, setMeta] = useState<Map<string, RecipeMeta>>(new Map())
  const [metaMissing, setMetaMissing] = useState(false)
  const [editingComp, setEditingComp] = useState<string | null>(null)
  const [compLines, setCompLines] = useState<EditLine[]>([])
  const [compYieldQty, setCompYieldQty] = useState('128')
  const [compYieldUnit, setCompYieldUnit] = useState('oz')
  const [newCompName, setNewCompName] = useState('')
  const [draftingComp, setDraftingComp] = useState<string | null>(null)
  // Only the FIRST load shows the page spinner. Refreshes (after a
  // draft, save or calibration) swap data in place — blanking the
  // page collapsed its height and bounced the scroll to the top.
  const loadedOnceRef = useRef(false)

  const load = useCallback(async () => {
    if (!restaurantId) return
    if (!loadedOnceRef.current) setLoading(true)
    const [canon, settingsRes] = await Promise.all([
      fetchCanonicalItems(supabase),
      fetchIngredientSettings(supabase, restaurantId),
    ])
    const packGaps = new Set<string>()
    const [dishList, recipeMap, purchaseMap, metaMap] = await Promise.all([
      fetchDishSales(supabase, restaurantId, 30),
      fetchRecipes(supabase, restaurantId),
      fetchIngredientCosts(supabase, restaurantId, canon, settingsRes.settings, packGaps),
      fetchRecipeMeta(supabase, restaurantId),
    ])
    setIngSettings(settingsRes.settings)
    setIngSettingsMissing(settingsRes.missing)
    setNeedsPack(packGaps)
    const { error: metaProbeErr } = await supabase.from('recipe_meta').select('id').limit(1)
    setMetaMissing(!!metaProbeErr)
    setMeta(metaMap)
    setCanonical(canon)
    setDishes(dishList)
    setRecipes(recipeMap)
    // Purchase prices first; component (batch) prices fill the rest.
    setCosts(mergeComponentCosts(recipeMap, metaMap, purchaseMap))

    // Theoretical-vs-actual for the selected period.
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    let start: string
    let end: string
    if (period === 'month') {
      start = fmt(new Date(now.getFullYear(), now.getMonth(), 1))
      end = fmt(now)
    } else if (period === 'lastMonth') {
      start = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      end = fmt(new Date(now.getFullYear(), now.getMonth(), 0))
    } else {
      start = fmt(new Date(now.getTime() - 29 * 24 * 3600 * 1000))
      end = fmt(now)
    }
    const v = await fetchUsageVariance(supabase, restaurantId, start, end)
    setVariance(v.rows)
    setVarianceError(v.error)
    setVarianceRange({ start, end })
    loadedOnceRef.current = true
    setLoading(false)
  }, [restaurantId, period])

  useEffect(() => {
    load()
  }, [load])

  function openEditor(dish: string) {
    const lines = recipes.get(dish) ?? []
    setEditLines(
      lines.length > 0
        ? lines.map((l) => ({
            ingredient_name: l.ingredient_name,
            quantity: String(l.quantity),
            unit: l.unit,
          }))
        : [{ ingredient_name: canonical[0]?.name ?? '', quantity: '1', unit: 'oz' }]
    )
    setEditing(dish)
    setNotice(null)
  }

  async function draftWithAi(dish: string) {
    if (!restaurantId) return
    setDrafting(dish)
    setNotice(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in required')
      const resp = await fetch('/api/recipes/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurant_id: restaurantId, menu_item_name: dish }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || 'Draft failed')
      await load()
      setNotice(`AI drafted a recipe for ${dish} — review it below and Save to confirm.`)
      // Open the editor on the fresh draft.
      const fresh = await fetchRecipes(supabase, restaurantId)
      const lines = fresh.get(dish) ?? []
      setEditLines(
        lines.map((l) => ({
          ingredient_name: l.ingredient_name,
          quantity: String(l.quantity),
          unit: l.unit,
        }))
      )
      setEditing(dish)
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setDrafting(null)
    }
  }

  async function saveRecipe(dish: string) {
    if (!restaurantId) return
    setSaving(true)
    setNotice(null)
    try {
      // Normalize rows; merge the same ingredient+unit, drop empties.
      const merged = new Map<string, RecipeLine>()
      for (const row of editLines) {
        const qty = Number(row.quantity)
        if (!row.ingredient_name || !qty || qty <= 0) continue
        const key = `${row.ingredient_name}|${row.unit}`
        const cur = merged.get(key)
        if (cur) cur.quantity += qty
        else
          merged.set(key, {
            ingredient_name: row.ingredient_name,
            quantity: qty,
            unit: row.unit,
            confidence: 'user_confirmed',
          })
      }
      const lines = [...merged.values()]
      if (lines.length === 0) throw new Error('Add at least one ingredient with a quantity.')

      const { error: delErr } = await supabase
        .from('recipes_estimated')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('menu_item_name', dish)
      if (delErr) throw new Error(delErr.message)
      const { error: insErr } = await supabase.from('recipes_estimated').insert(
        lines.map((l) => ({
          restaurant_id: restaurantId,
          menu_item_name: dish,
          ingredient_name: l.ingredient_name,
          quantity: l.quantity,
          unit: l.unit,
          confidence: 'user_confirmed',
          source: 'user',
        }))
      )
      if (insErr) throw new Error(insErr.message)
      setEditing(null)
      setNotice(`Recipe for ${dish} confirmed.`)
      await load()
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function openCompEditor(name: string) {
    const lines = recipes.get(name) ?? []
    const m = meta.get(name)
    setCompLines(
      lines.length > 0
        ? lines.map((l) => ({
            ingredient_name: l.ingredient_name,
            quantity: String(l.quantity),
            unit: l.unit,
          }))
        : [{ ingredient_name: canonical[0]?.name ?? '', quantity: '1', unit: 'oz' }]
    )
    setCompYieldQty(m ? String(m.yieldQty) : '128')
    setCompYieldUnit(m ? m.yieldUnit : 'oz')
    setEditingComp(name)
    setNotice(null)
  }

  async function draftComponent(name: string) {
    if (!restaurantId || !name.trim()) return
    setDraftingComp(name)
    setNotice(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in required')
      const resp = await fetch('/api/recipes/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurant_id: restaurantId, menu_item_name: name.trim(), component: true }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || 'Draft failed')
      if (json.meta_error) {
        setNotice(
          `Draft saved, but the batch yield couldn't be recorded (${json.meta_error}). Run sql/018_recipe_meta.sql in the Supabase SQL editor, then save the component again.`
        )
      } else {
        setNotice(`AI drafted the batch recipe for ${name.trim()} — review it below and Save to confirm.`)
      }
      await load()
      const fresh = await fetchRecipes(supabase, restaurantId)
      const lines = fresh.get(name.trim()) ?? []
      setCompLines(
        lines.map((l) => ({
          ingredient_name: l.ingredient_name,
          quantity: String(l.quantity),
          unit: l.unit,
        }))
      )
      if (json.yield_qty) setCompYieldQty(String(json.yield_qty))
      if (json.yield_unit) setCompYieldUnit(json.yield_unit)
      setEditingComp(name.trim())
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setDraftingComp(null)
    }
  }

  async function saveComponent(name: string) {
    if (!restaurantId) return
    setSaving(true)
    setNotice(null)
    try {
      const merged = new Map<string, RecipeLine>()
      for (const row of compLines) {
        const qty = Number(row.quantity)
        if (!row.ingredient_name || !qty || qty <= 0) continue
        const key = `${row.ingredient_name}|${row.unit}`
        const cur = merged.get(key)
        if (cur) cur.quantity += qty
        else
          merged.set(key, {
            ingredient_name: row.ingredient_name,
            quantity: qty,
            unit: row.unit,
            confidence: 'user_confirmed',
          })
      }
      const lines = [...merged.values()]
      if (lines.length === 0) throw new Error('Add at least one ingredient with a quantity.')
      const yieldQty = Number(compYieldQty)
      if (!yieldQty || yieldQty <= 0) throw new Error('Set the batch yield (how much one batch makes).')

      const { error: delErr } = await supabase
        .from('recipes_estimated')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('menu_item_name', name)
      if (delErr) throw new Error(delErr.message)
      const { error: insErr } = await supabase.from('recipes_estimated').insert(
        lines.map((l) => ({
          restaurant_id: restaurantId,
          menu_item_name: name,
          ingredient_name: l.ingredient_name,
          quantity: l.quantity,
          unit: l.unit,
          confidence: 'user_confirmed',
          source: 'user',
        }))
      )
      if (insErr) throw new Error(insErr.message)
      const { error: metaErr } = await supabase.from('recipe_meta').upsert(
        {
          restaurant_id: restaurantId,
          recipe_name: name,
          kind: 'component',
          yield_qty: yieldQty,
          yield_unit: compYieldUnit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'restaurant_id,recipe_name' }
      )
      if (metaErr) {
        throw new Error(
          `Recipe lines saved, but the batch yield wasn't: ${metaErr.message} — if this mentions recipe_meta, run sql/018_recipe_meta.sql in the Supabase SQL editor.`
        )
      }
      setEditingComp(null)
      setNotice(`Component ${name} confirmed — dishes using it now price through its batch cost.`)
      await load()
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Dismissed calibration hints persist per restaurant.
  useEffect(() => {
    if (!restaurantId) return
    try {
      const raw = localStorage.getItem(`mise.calib_dismissed.${restaurantId}`)
      setDismissedCalib(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      setDismissedCalib([])
    }
  }, [restaurantId])

  // Keep the user at the dish/component they just drafted or opened
  // instead of bouncing to the top of the page.
  useEffect(() => {
    if (!editing) return
    document
      .querySelector(`[data-dish-row="${CSS.escape(editing)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editing])

  useEffect(() => {
    if (!editingComp) return
    document
      .querySelector(`[data-comp-row="${CSS.escape(editingComp)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editingComp])

  async function applyCalibration(h: CalibrationHint) {
    if (!restaurantId) return
    setSaving(true)
    setNotice(null)
    try {
      const { data: lines, error: selErr } = await supabase
        .from('recipes_estimated')
        .select('id, quantity')
        .eq('restaurant_id', restaurantId)
        .eq('ingredient_name', h.ingredient)
      if (selErr) throw new Error(selErr.message)
      if (!lines || lines.length === 0) {
        throw new Error('No recipe lines use that ingredient anymore.')
      }
      for (const l of lines as { id: string; quantity: number }[]) {
        const { error: upErr } = await supabase
          .from('recipes_estimated')
          .update({
            quantity: Math.round(Number(l.quantity) * h.factor * 1000) / 1000,
            confidence: 'data_calibrated',
            source: 'calibration',
            last_updated_at: new Date().toISOString(),
          })
          .eq('id', l.id)
        if (upErr) throw new Error(upErr.message)
      }
      // Audit row (best-effort): purchased ÷ servings = implied portion.
      const item = canonByName.get(h.ingredient)
      const unit = item?.default_unit ?? 'LB'
      const per = toBase(1, unit.toLowerCase())
      const totalServings = dishes
        .filter((d) =>
          (recipes.get(d.menuItemName) ?? []).some((l) => l.ingredient_name === h.ingredient)
        )
        .reduce((a, d) => a + d.soldQty, 0)
      if (per && varianceRange) {
        const purchasedQty = h.actualBase / per.base
        await supabase.from('recipe_calibrations').insert({
          restaurant_id: restaurantId,
          ingredient_name: h.ingredient,
          period_start: varianceRange.start,
          period_end: varianceRange.end,
          total_purchased_qty: Math.round(purchasedQty * 1000) / 1000,
          purchase_unit: unit,
          total_dishes_using_ingredient: Math.round(totalServings),
          implied_portion:
            totalServings > 0
              ? Math.round((purchasedQty / totalServings) * 10000) / 10000
              : 0,
          applied: true,
          notes: `Scaled recipe lines ×${h.factor.toFixed(2)} — purchases ran ${h.variancePct > 0 ? '+' : ''}${h.variancePct.toFixed(0)}% vs recipe-implied usage.`,
        })
      }
      setNotice(
        `Calibrated: every recipe using ${h.ingredient} was scaled ×${h.factor.toFixed(2)} to match what you actually buy.`
      )
      await load()
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function dismissCalibration(ingredient: string) {
    if (!restaurantId) return
    const next = [...dismissedCalib, ingredient]
    setDismissedCalib(next)
    try {
      localStorage.setItem(`mise.calib_dismissed.${restaurantId}`, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  // Live cost of the component being edited.
  const compEditCost =
    editingComp != null
      ? plateCost(
          compLines
            .map((l) => ({
              ingredient_name: l.ingredient_name,
              quantity: Number(l.quantity) || 0,
              unit: l.unit,
              confidence: 'user_confirmed',
            }))
            .filter((l) => l.quantity > 0 && l.ingredient_name),
          costs
        )
      : null

  // Live cost of the recipe being edited.
  const editCost =
    editing != null
      ? plateCost(
          editLines
            .map((l) => ({
              ingredient_name: l.ingredient_name,
              quantity: Number(l.quantity) || 0,
              unit: l.unit,
              confidence: 'user_confirmed',
            }))
            .filter((l) => l.quantity > 0 && l.ingredient_name),
          costs
        )
      : null

  // Variance section data.
  const canonByName = new Map(canonical.map((c) => [c.name, c]))

  // Ingredients referenced by recipes that have no price and no
  // recipe of their own — prime component candidates (sambar,
  // coconut chutney, house sauces…).
  // Catalog ingredients (sugar, tomato, shrimp) aren't components —
  // they just have no price yet, so they're listed separately.
  const { undefinedRefs, unpricedIngredients } = (() => {
    const seen = new Set<string>()
    for (const lines of recipes.values()) {
      for (const l of lines) {
        const n = l.ingredient_name
        if (costs.has(n) || recipes.has(n) || FREE_INGREDIENTS.has(n.trim().toLowerCase())) continue
        seen.add(n)
      }
    }
    const all = [...seen].sort()
    return {
      undefinedRefs: all.filter((n) => !canonByName.has(n)),
      unpricedIngredients: all.filter((n) => canonByName.has(n)),
    }
  })()
  const definedComponents = [...meta.keys()].sort()
  // Recipe unit kinds per ingredient (g / ml / each). When a recipe
  // measures by weight but invoices count bunches or cans, the two
  // sides aren't comparable — that produced "cilantro 332 ct vs 1 ct,
  // -$4,097". Such rows are listed separately, not computed.
  const recipeKinds = new Map<string, Set<string>>()
  for (const lines of recipes.values()) {
    for (const l of lines) {
      const k = unitKind(l.unit)
      if (!k) continue
      const set = recipeKinds.get(l.ingredient_name) ?? new Set<string>()
      set.add(k)
      recipeKinds.set(l.ingredient_name, set)
    }
  }
  const unitMismatch = (v: VarianceRow): boolean => {
    const buyKind = unitKind(canonByName.get(v.ingredient)?.default_unit)
    const kinds = recipeKinds.get(v.ingredient)
    return !!buyKind && !!kinds && [...kinds].some((k) => k !== buyKind)
  }
  const varianceComparable = variance.filter((v) => v.variancePct != null && !unitMismatch(v))
  const varianceMain = varianceComparable.filter((v) => v.actualBase > 0)
  const varianceNotBought = varianceComparable.filter((v) => v.actualBase <= 0)
  const varianceMismatch = variance.filter((v) => v.variancePct != null && unitMismatch(v))
  const varianceNoRecipe = variance.filter((v) => v.variancePct == null && v.actualBase > 0)
  const dishesWithRecipe = dishes.filter((d) => (recipes.get(d.menuItemName)?.length ?? 0) > 0).length
  const calibHints = calibrationHints(varianceMain, 25, (ing) => {
    const one = toBase(1, canonByName.get(ing)?.default_unit)
    return one ? one.base : null
  }).filter(
    (h) => !dismissedCalib.includes(h.ingredient)
  )
  const impactOf = (v: VarianceRow): number | null => {
    const cost = costs.get(v.ingredient)
    const item = canonByName.get(v.ingredient)
    if (!cost || cost.costPerBase == null || !item) return null
    if (unitKind(item.default_unit) !== cost.baseKind) return null
    return (v.actualBase - v.theoreticalBase) * cost.costPerBase
  }
  // Ingredients the recipes use (and case buys missing a pack size),
  // for the pack-size & yield card. Gaps first, then A–Z.
  const settingsRows = (() => {
    const names = new Set<string>(needsPack)
    for (const lines of recipes.values()) for (const l of lines) names.add(l.ingredient_name)
    return [...names]
      .map((n) => canonByName.get(n))
      .filter((it): it is CanonicalItem => !!it)
      // Gloves, containers, soap never go on a plate.
      .filter((it) => !isNonFood(it.category))
      .map((item) => ({ item, cost: costs.get(item.name), needsPack: needsPack.has(item.name) }))
      .sort((a, b) =>
        a.needsPack !== b.needsPack ? (a.needsPack ? -1 : 1) : a.item.name.localeCompare(b.item.name)
      )
  })()
  const hasConfirmedRecipe = [...recipes.values()].some((lines) =>
    lines.some((l) => l.confidence === 'user_confirmed' || l.confidence === 'ai_inferred')
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <div className="mt-6">
        <h1 className="font-serif text-[28px] text-ink">Recipes & dish costing</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-ink-muted">
          What each dish costs you to make. The AI drafts a recipe from the ingredients you
          actually buy — you adjust and confirm it. Plate costs use your latest invoice price
          per ingredient, so they move when supplier prices move.
        </p>
      </div>

      {notice && (
        <div className="mt-4 rounded-[10px] border border-ink/10 bg-cream-surface px-4 py-3 text-[13px] text-ink">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-[13.5px] text-ink-muted">Loading dishes…</p>
      ) : dishes.length === 0 ? (
        <div className={`${card} mt-6`}>
          <h2 className="font-serif text-[20px] text-ink">No dish sales yet</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Dishes appear here from your POS sales. Connect Clover in Settings and run a sync —
            your menu items will show up ranked by revenue.
          </p>
        </div>
      ) : (
        <div className={`${card} mt-6 overflow-x-auto p-0`}>
          <table className="w-full min-w-[760px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Dish</th>
                <th className="px-3 py-3 text-right font-medium">Sold · 30d</th>
                <th className="px-3 py-3 text-right font-medium">Menu price</th>
                <th className="px-3 py-3 text-right font-medium">Plate cost</th>
                <th className="px-3 py-3 text-right font-medium">Food cost</th>
                <th className="px-3 py-3 text-right font-medium">Margin</th>
                <th className="px-5 py-3 text-right font-medium">Recipe</th>
              </tr>
            </thead>
            <tbody>
              {dishes.map((d) => {
                const lines = recipes.get(d.menuItemName)
                const status = recipeStatus(lines)
                const cost = lines ? plateCost(lines, costs) : null
                const foodPct =
                  cost && d.avgPrice > 0 ? (cost.total / d.avgPrice) * 100 : null
                const margin = cost ? d.avgPrice - cost.total : null
                const isEditing = editing === d.menuItemName
                return [
                  <tr key={d.menuItemName} data-dish-row={d.menuItemName} className="border-b border-ink/[0.05]">
                    <td className="px-5 py-3">
                      <span className="font-medium text-ink">{d.menuItemName}</span>
                      {status !== 'none' && (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            status === 'confirmed'
                              ? 'bg-forest/10 text-forest'
                              : 'bg-terracotta/10 text-terracotta'
                          }`}
                        >
                          {status === 'confirmed' ? 'Confirmed' : 'AI draft'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {Math.round(d.soldQty)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {money(d.avgPrice)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {cost
                        ? cost.missing.length > 0
                          ? `${money(cost.total)}+`
                          : money(cost.total)
                        : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-mono ${
                        foodPct != null && foodPct > 35 ? 'text-terracotta' : 'text-ink'
                      }`}
                    >
                      {foodPct != null ? `${foodPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {margin != null ? money(margin) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {status === 'none' ? (
                        <button
                          onClick={() => draftWithAi(d.menuItemName)}
                          disabled={drafting != null}
                          className="rounded-[8px] bg-terracotta px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-terracotta-hover disabled:opacity-50"
                        >
                          {drafting === d.menuItemName ? 'Drafting…' : 'Draft with AI'}
                        </button>
                      ) : (
                        <button
                          onClick={() => (isEditing ? setEditing(null) : openEditor(d.menuItemName))}
                          className="rounded-[8px] border border-ink/15 px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-ink/[0.04]"
                        >
                          {isEditing ? 'Close' : status === 'confirmed' ? 'Edit' : 'Review draft'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  isEditing ? (
                    <tr key={`${d.menuItemName}-editor`} className="border-b border-ink/[0.08] bg-ink/[0.02]">
                      <td colSpan={7} className="px-5 py-4">
                        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13px] font-semibold text-ink">
                            Recipe for {d.menuItemName} — per serving
                          </span>
                          {editCost && (
                            <span className="font-mono text-[13px] text-ink">
                              Plate cost: {money(editCost.total)}
                              {editCost.missing.length > 0 &&
                                ` (no price yet for: ${editCost.missing.join(', ')})`}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {editLines.map((row, i) => {
                            const base = toBase(Number(row.quantity) || 0, row.unit)
                            const c = costs.get(row.ingredient_name)
                            const usable = usableCostPerBase(c)
                            const lineCost =
                              base && usable != null && c?.baseKind === base.kind
                                ? base.base * usable
                                : null
                            return (
                              <div key={i} className="flex flex-wrap items-center gap-2">
                                <select
                                  value={row.ingredient_name}
                                  onChange={(e) => {
                                    const next = [...editLines]
                                    next[i] = { ...next[i], ingredient_name: e.target.value }
                                    setEditLines(next)
                                  }}
                                  className="min-w-[220px] flex-1 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 text-[13px] text-ink"
                                >
                                  {canonical.map((c) => (
                                    <option key={c.id} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={row.quantity}
                                  onChange={(e) => {
                                    const next = [...editLines]
                                    next[i] = { ...next[i], quantity: e.target.value }
                                    setEditLines(next)
                                  }}
                                  inputMode="decimal"
                                  className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 font-mono text-[13px] text-ink"
                                />
                                <select
                                  value={row.unit}
                                  onChange={(e) => {
                                    const next = [...editLines]
                                    next[i] = { ...next[i], unit: e.target.value }
                                    setEditLines(next)
                                  }}
                                  className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 text-[13px] text-ink"
                                >
                                  {RECIPE_UNITS.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                                <span className="w-20 text-right font-mono text-[12.5px] text-ink-muted">
                                  {lineCost != null ? money(lineCost) : '—'}
                                </span>
                                <button
                                  onClick={() => setEditLines(editLines.filter((_, j) => j !== i))}
                                  className="px-1 text-[15px] text-ink-muted hover:text-terracotta"
                                  aria-label="Remove ingredient"
                                >
                                  ×
                                </button>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              setEditLines([
                                ...editLines,
                                { ingredient_name: canonical[0]?.name ?? '', quantity: '1', unit: 'oz' },
                              ])
                            }
                            className="rounded-[8px] border border-ink/15 px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-ink/[0.04]"
                          >
                            + Add ingredient
                          </button>
                          <button
                            onClick={() => saveRecipe(d.menuItemName)}
                            disabled={saving}
                            className="rounded-[8px] bg-forest px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save & confirm recipe'}
                          </button>
                          {status !== 'confirmed' && (
                            <button
                              onClick={() => draftWithAi(d.menuItemName)}
                              disabled={drafting != null}
                              className="rounded-[8px] border border-terracotta/40 px-3 py-1.5 text-[12.5px] font-semibold text-terracotta hover:bg-terracotta/[0.06] disabled:opacity-50"
                            >
                              {drafting === d.menuItemName ? 'Drafting…' : 'Draft with AI instead'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && dishes.length > 0 && (
        <p className="mt-4 text-[12.5px] text-ink-muted">
          Plate costs marked “+” are missing a price for at least one ingredient (it hasn’t
          appeared on a recent invoice, the invoice line couldn’t be matched to the
          ingredient catalog, or it’s bought by the case and needs a pack size — set that in
          the pack size & yield table below). Costs refresh from your newest invoices
          automatically.
        </p>
      )}

      {/* COMPONENTS (SUB-RECIPES) */}
      {!loading && dishes.length > 0 && (
        <div className={`${card} mt-6`}>
          <h2 className="font-serif text-[22px] text-ink">Components — prep recipes</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
            Sambar, chutneys, sauces and batters aren’t ingredients — they’re recipes of their
            own, made in batches and used by the ounce across many dishes. Define a component
            once and every dish that uses it prices through its batch cost (batch cost ÷ yield
            = cost per oz).
          </p>

          {metaMissing && (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              <span className="font-semibold text-terracotta">One setup step:</span> run{' '}
              <span className="font-mono">sql/018_recipe_meta.sql</span> in the Supabase SQL
              editor so components can record their batch yield. (Run it before sql/008.)
            </div>
          )}

          {unpricedIngredients.length > 0 && (
            <div className="mt-4">
              <div className="text-[12.5px] font-semibold tracking-[0.02em] text-ink-muted">
                Ingredients with no price yet
              </div>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                Not on a recent approved invoice, or bought by the case without a pack size. Dishes
                using them show a “+” plate cost.
              </p>
              <p className="mt-2 text-[13px] text-ink-3">{unpricedIngredients.join(' · ')}</p>
            </div>
          )}

          {undefinedRefs.length > 0 && (
            <div className="mt-4">
              <div className="text-[12.5px] font-semibold tracking-[0.02em] text-ink-muted">
                Used in your dishes, but not defined yet
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {undefinedRefs.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-3 py-1.5 text-[13px] text-ink"
                  >
                    {name}
                    <button
                      onClick={() => draftComponent(name)}
                      disabled={draftingComp != null}
                      className="font-semibold text-terracotta hover:underline disabled:opacity-50"
                    >
                      {draftingComp === name ? 'Drafting…' : 'Define with AI'}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {definedComponents.length > 0 && (
            <div className="mt-5 space-y-2">
              {definedComponents.map((name) => {
                const m = meta.get(name)!
                const lines = recipes.get(name) ?? []
                const batch = plateCost(lines, costs)
                const perUnit = costs.get(name)
                const perOz =
                  perUnit?.costPerBase != null
                    ? perUnit.baseKind === 'g'
                      ? perUnit.costPerBase * 28.3495
                      : perUnit.baseKind === 'ml'
                        ? perUnit.costPerBase * 29.5735
                        : perUnit.costPerBase
                    : null
                const status = recipeStatus(lines)
                const isEditing = editingComp === name
                return (
                  <div key={name} data-comp-row={name} className="rounded-[10px] border border-ink/[0.08] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14px] font-medium text-ink">
                        {name}
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            status === 'confirmed'
                              ? 'bg-forest/10 text-forest'
                              : 'bg-terracotta/10 text-terracotta'
                          }`}
                        >
                          {status === 'confirmed' ? 'Confirmed' : 'AI draft'}
                        </span>
                      </span>
                      <span className="font-mono text-[12.5px] text-ink-muted">
                        makes {m.yieldQty} {m.yieldUnit} · batch{' '}
                        {batch.missing.length > 0
                          ? `${money(batch.total)}+`
                          : money(batch.total)}
                        {perOz != null &&
                          ` · ${money(perOz)} / ${perUnit?.baseKind === 'each' ? 'each' : 'oz'}`}
                      </span>
                      <button
                        onClick={() => (isEditing ? setEditingComp(null) : openCompEditor(name))}
                        className="rounded-[8px] border border-ink/15 px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-ink/[0.04]"
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </button>
                    </div>

                    {isEditing && (
                      <div className="mt-4 border-t border-ink/[0.06] pt-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-ink">
                          <span className="font-semibold">One batch makes</span>
                          <input
                            value={compYieldQty}
                            onChange={(e) => setCompYieldQty(e.target.value)}
                            inputMode="decimal"
                            className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 font-mono text-[13px] text-ink"
                          />
                          <select
                            value={compYieldUnit}
                            onChange={(e) => setCompYieldUnit(e.target.value)}
                            className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 text-[13px] text-ink"
                          >
                            {RECIPE_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          {compEditCost && (
                            <span className="ml-2 font-mono text-[12.5px] text-ink-muted">
                              Batch cost: {money(compEditCost.total)}
                              {compEditCost.missing.length > 0 &&
                                ` (no price yet for: ${compEditCost.missing.join(', ')})`}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {compLines.map((row, i) => {
                            const base = toBase(Number(row.quantity) || 0, row.unit)
                            const c = costs.get(row.ingredient_name)
                            const usable = usableCostPerBase(c)
                            const lineCost =
                              base && usable != null && c?.baseKind === base.kind
                                ? base.base * usable
                                : null
                            return (
                              <div key={i} className="flex flex-wrap items-center gap-2">
                                <select
                                  value={row.ingredient_name}
                                  onChange={(e) => {
                                    const next = [...compLines]
                                    next[i] = { ...next[i], ingredient_name: e.target.value }
                                    setCompLines(next)
                                  }}
                                  className="min-w-[220px] flex-1 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 text-[13px] text-ink"
                                >
                                  {canonical.map((c) => (
                                    <option key={c.id} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={row.quantity}
                                  onChange={(e) => {
                                    const next = [...compLines]
                                    next[i] = { ...next[i], quantity: e.target.value }
                                    setCompLines(next)
                                  }}
                                  inputMode="decimal"
                                  className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 font-mono text-[13px] text-ink"
                                />
                                <select
                                  value={row.unit}
                                  onChange={(e) => {
                                    const next = [...compLines]
                                    next[i] = { ...next[i], unit: e.target.value }
                                    setCompLines(next)
                                  }}
                                  className="w-20 rounded-[8px] border border-ink/15 bg-cream-surface px-2 py-1.5 text-[13px] text-ink"
                                >
                                  {RECIPE_UNITS.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                                <span className="w-20 text-right font-mono text-[12.5px] text-ink-muted">
                                  {lineCost != null ? money(lineCost) : '—'}
                                </span>
                                <button
                                  onClick={() => setCompLines(compLines.filter((_, j) => j !== i))}
                                  className="px-1 text-[15px] text-ink-muted hover:text-terracotta"
                                  aria-label="Remove ingredient"
                                >
                                  ×
                                </button>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              setCompLines([
                                ...compLines,
                                { ingredient_name: canonical[0]?.name ?? '', quantity: '1', unit: 'oz' },
                              ])
                            }
                            className="rounded-[8px] border border-ink/15 px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-ink/[0.04]"
                          >
                            + Add ingredient
                          </button>
                          <button
                            onClick={() => saveComponent(name)}
                            disabled={saving}
                            className="rounded-[8px] bg-forest px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save & confirm component'}
                          </button>
                          <button
                            onClick={() => draftComponent(name)}
                            disabled={draftingComp != null}
                            className="rounded-[8px] border border-terracotta/40 px-3 py-1.5 text-[12.5px] font-semibold text-terracotta hover:bg-terracotta/[0.06] disabled:opacity-50"
                          >
                            {draftingComp === name ? 'Drafting…' : 'Draft with AI instead'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              value={newCompName}
              onChange={(e) => setNewCompName(e.target.value)}
              placeholder="New component — e.g. garlic naan dough"
              className="min-w-[240px] flex-1 rounded-[8px] border border-ink/15 bg-cream-surface px-3 py-2 text-[13px] text-ink"
            />
            <button
              onClick={() => {
                if (newCompName.trim()) {
                  draftComponent(newCompName.trim().toLowerCase())
                  setNewCompName('')
                }
              }}
              disabled={draftingComp != null || !newCompName.trim()}
              className="rounded-[8px] bg-terracotta px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-terracotta-hover disabled:opacity-50"
            >
              {draftingComp ? 'Drafting…' : 'Draft with AI'}
            </button>
          </div>
        </div>
      )}

      {/* PACK SIZES & USABLE YIELD */}
      {!loading && restaurantId && (needsPack.size > 0 || recipes.size > 0) && (
        <IngredientSettingsCard
          restaurantId={restaurantId}
          rows={settingsRows}
          settings={ingSettings}
          missing={ingSettingsMissing}
          onSaved={load}
        />
      )}

      {/* THEORETICAL VS ACTUAL */}
      {!loading && dishes.length > 0 && (
        <div className={`${card} mt-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-[22px] text-ink">Theoretical vs actual usage</h2>
              <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
                What your recipes say you <em>should</em> have used, against what you actually
                bought. A big positive variance is where money leaks — over-portioning, waste,
                or a recipe that needs recalibrating. (Purchases, not stock counts — a bulk buy
                inflates its own period.)
              </p>
            </div>
            <div className="flex gap-1">
              {(
                [
                  ['30d', 'Last 30 days'],
                  ['month', 'This month'],
                  ['lastMonth', 'Last month'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold ${
                    period === key
                      ? 'bg-forest text-white'
                      : 'border border-ink/15 text-ink hover:bg-ink/[0.04]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {varianceError ? (
            <div className="mt-4 rounded-[10px] border border-terracotta/30 bg-terracotta/[0.08] px-4 py-3 text-[13px] text-ink">
              <span className="font-semibold text-terracotta">One setup step left:</span> run{' '}
              <span className="font-mono">sql/008_recipe_usage_variance.sql</span> in the Supabase
              SQL editor — it creates the usage_variance() function this section reads. Then
              refresh.
            </div>
          ) : null}

          {!varianceError && dishes.length > 0 && dishesWithRecipe < dishes.length && (
            <div className="mt-4 rounded-[10px] border border-ink/10 bg-cream px-4 py-3 text-[12.5px] text-ink-3">
              <span className="font-semibold text-ink">
                {dishesWithRecipe} of {dishes.length} dishes have a recipe.
              </span>{' '}
              “Should have used” only counts those dishes, so an ingredient that other dishes also
              use will look over-bought until their recipes exist. Draft recipes for your top
              sellers first.
            </div>
          )}

          {varianceError ? null : varianceMain.length === 0 ? (
            <p className="mt-4 text-[13.5px] text-ink-muted">
              {hasConfirmedRecipe
                ? 'No ingredient overlaps yet between your recipes and purchases in this period.'
                : 'Nothing to compare yet — draft or confirm a few recipes above (start with your top sellers) and this fills in from your invoices.'}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink/[0.08] text-[12px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Ingredient</th>
                    <th className="px-3 py-2 text-right font-medium">Should have used</th>
                    <th className="px-3 py-2 text-right font-medium">Bought</th>
                    <th className="px-3 py-2 text-right font-medium">Variance</th>
                    <th className="py-2 pl-3 text-right font-medium">≈ $ impact</th>
                  </tr>
                </thead>
                <tbody>
                  {varianceMain.map((v) => {
                    const item = canonByName.get(v.ingredient)
                    const impact = impactOf(v)
                    return (
                      <tr key={v.ingredient} className="border-b border-ink/[0.05]">
                        <td className="py-2.5 pr-3 font-medium text-ink">{v.ingredient}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {formatBaseQty(v.theoreticalBase, item?.default_unit)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {formatBaseQty(v.actualBase, item?.default_unit)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-semibold ${
                            (v.variancePct ?? 0) > 20 ? 'text-terracotta' : 'text-ink'
                          }`}
                        >
                          {(v.variancePct ?? 0) > 0 ? '+' : ''}
                          {(v.variancePct ?? 0).toFixed(1)}%
                        </td>
                        <td
                          className={`py-2.5 pl-3 text-right font-mono ${
                            impact != null && impact > 0 ? 'text-terracotta' : 'text-ink'
                          }`}
                        >
                          {impact != null
                            ? `${impact > 0 ? '+' : '-'}${money(Math.abs(impact))}`
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!varianceError && varianceNotBought.length > 0 && (
            <p className="mt-4 text-[12.5px] text-ink-muted">
              <span className="font-semibold text-ink">In recipes, not bought this period:</span>{' '}
              {varianceNotBought.map((v) => v.ingredient).join(' · ')}
              <span className="block mt-1">
                Usually bought earlier, still in stock, or the invoice line isn’t matched to this
                ingredient yet.
              </span>
            </p>
          )}

          {!varianceError && varianceMismatch.length > 0 && (
            <p className="mt-4 text-[12.5px] text-ink-muted">
              <span className="font-semibold text-ink">Units don’t match, so not compared:</span>{' '}
              {varianceMismatch
                .map((v) => `${v.ingredient} (bought by ${(canonByName.get(v.ingredient)?.default_unit ?? '').toLowerCase()})`)
                .join(' · ')}
              <span className="block mt-1">
                The recipe measures these by weight or volume, but invoices count them (bunches,
                cans, cartons).
              </span>
            </p>
          )}

          {!varianceError && varianceNoRecipe.length > 0 && (
            <p className="mt-4 text-[12.5px] text-ink-muted">
              <span className="font-semibold text-ink">Bought but not in any recipe yet:</span>{' '}
              {varianceNoRecipe
                .map(
                  (v) =>
                    `${v.ingredient} (${formatBaseQty(v.actualBase, canonByName.get(v.ingredient)?.default_unit)})`
                )
                .join(' · ')}
            </p>
          )}

          {!varianceError && calibHints.length > 0 && (
            <div className="mt-5 border-t border-ink/[0.06] pt-4">
              <h3 className="text-[14px] font-semibold text-ink">Calibration hints</h3>
              <p className="mt-1 max-w-2xl text-[12.5px] text-ink-muted">
                Your purchases disagree with your written recipes on these ingredients. If
                the difference is portion size (not waste or stock build-up), apply the fix
                and every recipe using that ingredient scales to match reality. Purchases
                aren’t usage, so judge each one.
              </p>
              <div className="mt-3 space-y-2">
                {calibHints.map((h) => {
                  const item = canonByName.get(h.ingredient)
                  return (
                    <div
                      key={h.ingredient}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-ink/[0.08] px-3.5 py-2.5 text-[13px]"
                    >
                      <span className="font-medium text-ink">{h.ingredient}</span>
                      <span className="text-ink-muted">
                        recipes account for {formatBaseQty(h.theoreticalBase, item?.default_unit)},
                        you bought {formatBaseQty(h.actualBase, item?.default_unit)} (
                        {h.variancePct > 0 ? '+' : ''}
                        {h.variancePct.toFixed(0)}%)
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => applyCalibration(h)}
                          disabled={saving}
                          className="rounded-[8px] bg-forest px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          Scale recipes ×{h.factor.toFixed(2)}
                        </button>
                        <button
                          onClick={() => dismissCalibration(h.ingredient)}
                          className="px-1 text-[15px] text-ink-muted hover:text-terracotta"
                          aria-label="Dismiss hint"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
