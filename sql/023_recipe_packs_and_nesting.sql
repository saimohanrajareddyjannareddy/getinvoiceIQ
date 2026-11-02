-- 023_recipe_packs_and_nesting.sql
-- 1) Recipes can use the unit "pack": "2 bottles of yogurt" where one
--    bottle is the ingredient's inner pack (sql/022, e.g. 4 x 1 lb ->
--    one pack = 1 lb). The pack is the ingredient's most recently
--    saved product pack — the same rule the app uses (lib/packs.ts).
-- 2) Prep items (components) expand level after level in
--    usage_variance(): Chicken 65 -> N65 sauce -> ginger-garlic paste
--    -> ginger, up to 4 levels (before: one level).
--
-- Apply in the Supabase SQL editor AFTER 022. Idempotent. Replaces
-- usage_variance() again; if you re-run 008, 020, 021 or 022, run this after.

-- Base quantity (g / ml / each) of one recipe line.
create or replace function public.recipe_line_base(
  p_qty numeric, p_unit text, p_ingredient text, p_restaurant_id uuid
)
returns numeric
language sql
stable
as $$
  select case
    when lower(trim(coalesce(p_unit, ''))) = 'pack' then
      p_qty * (
        select public.to_base_unit(pp.pack_size, pp.pack_unit, p_restaurant_id)
        from public.product_packs pp
        join public.canonical_items ci on ci.id = pp.canonical_item_id
        where pp.restaurant_id = p_restaurant_id
          and ci.name = p_ingredient
        order by pp.updated_at desc
        limit 1
      )
    else public.to_base_unit(p_qty, p_unit, p_restaurant_id)
  end
$$;

-- Base kind ('g' | 'ml' | 'each') of a recipe unit; for "pack", the
-- kind of the ingredient's pack size.
create or replace function public.recipe_line_kind(
  p_unit text, p_ingredient text, p_restaurant_id uuid
)
returns text
language sql
stable
as $$
  select case
    when lower(trim(coalesce(p_unit, ''))) = 'pack' then (
      select c.base_unit
      from public.product_packs pp
      join public.canonical_items ci on ci.id = pp.canonical_item_id
      join public.unit_conversions c on c.from_unit = pp.pack_unit and c.restaurant_id is null
      where pp.restaurant_id = p_restaurant_id
        and ci.name = p_ingredient
      order by pp.updated_at desc
      limit 1
    )
    else (
      select c.base_unit from public.unit_conversions c
      where c.from_unit = p_unit and c.restaurant_id is null
      limit 1
    )
  end
$$;

create or replace function public.usage_variance(
  p_restaurant_id uuid,
  p_start date,
  p_end date
)
returns table (
  ingredient        text,
  theoretical_base  numeric,
  actual_base       numeric,
  variance_pct      numeric,
  notes             text
)
language sql
stable
as $$
  with recursive dish_lines as (
    select r.ingredient_name,
           r.quantity,
           r.unit,
           s.quantity as sold_qty
    from public.pos_sales s
    join public.recipes_estimated r
      on  r.restaurant_id  = s.restaurant_id
      and r.menu_item_name = s.item_name
    where s.restaurant_id = p_restaurant_id
      and s.sale_date between p_start and p_end
  ),
  -- Expand prep items (components, sql/018) into their own recipes,
  -- level after level: Chicken 65 -> N65 sauce -> ginger-garlic paste
  -- -> ginger. A component line expands only when its unit kind
  -- matches the batch yield's (oz into an oz batch); up to 4 levels,
  -- which also stops a recipe that (wrongly) contains itself.
  expl (ingredient, qty, kind, depth) as (
    select d.ingredient_name,
           d.sold_qty * public.recipe_line_base(d.quantity, d.unit, d.ingredient_name, p_restaurant_id),
           public.recipe_line_kind(d.unit, d.ingredient_name, p_restaurant_id),
           0
    from dish_lines d
    union all
    select cl.ingredient_name,
           e.qty
             * public.recipe_line_base(cl.quantity, cl.unit, cl.ingredient_name, p_restaurant_id)
             / nullif(public.to_base_unit(m.yield_qty, m.yield_unit, p_restaurant_id), 0),
           public.recipe_line_kind(cl.unit, cl.ingredient_name, p_restaurant_id),
           e.depth + 1
    from expl e
    join public.recipe_meta m
      on  m.restaurant_id = p_restaurant_id
      and m.recipe_name = e.ingredient
      and m.kind = 'component'
      and e.kind = public.recipe_line_kind(m.yield_unit, null, p_restaurant_id)
    join public.recipes_estimated cl
      on  cl.restaurant_id = p_restaurant_id
      and cl.menu_item_name = e.ingredient
    where e.depth < 4
  ),
  -- What's left after expansion: things you actually buy (plus any
  -- component that couldn't expand, which shows as its own row).
  leaves as (
    select e.ingredient, e.qty
    from expl e
    where not (
      e.depth < 4
      and exists (
        select 1 from public.recipe_meta m
        where m.restaurant_id = p_restaurant_id
          and m.recipe_name = e.ingredient
          and m.kind = 'component'
          and e.kind = public.recipe_line_kind(m.yield_unit, null, p_restaurant_id)
      )
      and exists (
        select 1 from public.recipes_estimated cl
        where cl.restaurant_id = p_restaurant_id
          and cl.menu_item_name = e.ingredient
      )
    )
  ),
  theoretical_usable as (
    select ingredient, sum(qty) as qty
    from leaves
    group by ingredient
  ),
  theoretical as (
    select tu.ingredient,
           tu.qty / (coalesce(s.yield_pct, 100) / 100.0) as qty
    from theoretical_usable tu
    left join public.canonical_items ci on ci.name = tu.ingredient
    left join public.ingredient_settings s
      on  s.canonical_item_id = ci.id
      and s.restaurant_id = p_restaurant_id
  ),
  actual as (
    select ci.name as ingredient,
           sum(case
             -- 1) This store's product pack (sql/022): purchased units
             --    x inner packs x pack size. Wins over everything else.
             when pp.id is not null then
               (case when lower(coalesce(l.purchase_unit, '')) = 'case'
                          and coalesce(l.case_qty, 0) > 0 then l.case_qty
                     when coalesce(l.unit_qty, 0) > 0 then l.unit_qty
                     else coalesce(l.case_qty, 0)
                end)
               * pp.pack_count
               * to_base_unit(pp.pack_size, pp.pack_unit, l.restaurant_id)
             -- 2) Sold by weight: the quantity already is pounds.
             when lower(coalesce(l.purchase_unit, '')) = 'lb'
                  and coalesce(l.unit_qty, 0) > 0 then
               to_base_unit(l.unit_qty, 'lb', l.restaurant_id)
             -- 3) Ingredient-level settings (sql/020, 021).
             else
               (case when coalesce(l.unit_qty, 0) > 0 then l.unit_qty
                     else coalesce(l.case_qty, 0) * coalesce(s.pack_qty, 0)
                end)
               * case when s.unit_size is not null and s.unit_size_unit is not null
                      then to_base_unit(s.unit_size, s.unit_size_unit, l.restaurant_id)
                      else to_base_unit(1, coalesce(ci.default_unit, 'EA'), l.restaurant_id)
                 end
           end) as qty
    from public.invoice_lines l
    join public.canonical_items ci on ci.id = l.canonical_item_id
    join public.invoice_headers h  on h.id  = l.header_id
    left join public.ingredient_settings s
      on  s.restaurant_id = l.restaurant_id
      and s.canonical_item_id = l.canonical_item_id
    left join public.product_packs pp
      on  pp.restaurant_id = l.restaurant_id
      and pp.vendor_key = lower(regexp_replace(trim(coalesce(h.vendor, '')), '\s+', ' ', 'g'))
      and pp.item_key   = lower(regexp_replace(trim(coalesce(l.item_name, '')), '\s+', ' ', 'g'))
    where l.restaurant_id = p_restaurant_id
      and h.invoice_date between p_start and p_end
    group by ci.name
  )
  select
    coalesce(t.ingredient, a.ingredient) as ingredient,
    round(coalesce(t.qty, 0), 1)         as theoretical_base,
    round(coalesce(a.qty, 0), 1)         as actual_base,
    case
      when coalesce(t.qty, 0) = 0 then null
      else round((coalesce(a.qty, 0) - t.qty) / t.qty * 100, 1)
    end                                  as variance_pct,
    case
      when t.qty is null then 'purchased but in no recipe yet'
      when a.qty is null then 'in recipes, nothing purchased in period'
      else null
    end                                  as notes
  from theoretical t
  full outer join actual a on a.ingredient = t.ingredient
  order by abs(coalesce(
    case when coalesce(t.qty, 0) = 0 then null
         else (coalesce(a.qty, 0) - t.qty) / t.qty end, 0)) desc
$$;

comment on function public.usage_variance(uuid, date, date) is
  'Per-dish costing reconciliation: theoretical usage (sales x recipes_estimated) vs actual purchases (invoice_lines via canonical_items), ordered by |variance| so the biggest leaks surface first. Base units are g/ml/each.';
