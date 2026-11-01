-- 021_unit_size.sql
-- "What one invoice unit really is", per restaurant and ingredient.
--
-- Invoices often say "1" for a whole jug, bag or bunch while the
-- catalog unit is LB or CT, so a 35 lb jug of oil priced as 1 lb
-- ($37.99/lb), and a bunch of cilantro (CT) couldn't be compared with
-- a recipe written in ounces. unit_size + unit_size_unit say what one
-- unit really is: 1 = 35 lb, 1 = 3 oz. Costs and usage_variance use it
-- when set; otherwise nothing changes.
--
-- Apply in the Supabase SQL editor AFTER 020. Idempotent. Replaces
-- usage_variance() again; if you re-run 008 or 020, run this after.

alter table public.ingredient_settings
  add column if not exists unit_size      numeric(12,4),
  add column if not exists unit_size_unit text;

alter table public.ingredient_settings
  drop constraint if exists ingredient_settings_unit_size_check;
alter table public.ingredient_settings
  add constraint ingredient_settings_unit_size_check check (
    (unit_size is null and unit_size_unit is null)
    or (unit_size is not null and unit_size > 0
        and unit_size_unit is not null
        and unit_size_unit in ('lb', 'oz', 'g', 'kg', 'gal', 'floz', 'each'))
  );

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
  with dish_lines as (
    select r.ingredient_name,
           r.quantity,
           r.unit,
           s.quantity as sold_qty,
           s.restaurant_id
    from public.pos_sales s
    join public.recipes_estimated r
      on  r.restaurant_id  = s.restaurant_id
      and r.menu_item_name = s.item_name
    where s.restaurant_id = p_restaurant_id
      and s.sale_date between p_start and p_end
  ),
  direct as (
    select d.ingredient_name as ingredient,
           sum(d.sold_qty * to_base_unit(d.quantity, d.unit, d.restaurant_id)) as qty
    from dish_lines d
    where not exists (
      select 1 from public.recipe_meta m
      where m.restaurant_id = d.restaurant_id
        and m.recipe_name = d.ingredient_name
        and m.kind = 'component'
        and (select c.base_unit from public.unit_conversions c
              where c.from_unit = d.unit and c.restaurant_id is null limit 1)
          = (select c.base_unit from public.unit_conversions c
              where c.from_unit = m.yield_unit and c.restaurant_id is null limit 1)
    )
    group by d.ingredient_name
  ),
  expanded as (
    select cl.ingredient_name as ingredient,
           sum(
             d.sold_qty
             * to_base_unit(d.quantity, d.unit, d.restaurant_id)
             * to_base_unit(cl.quantity, cl.unit, d.restaurant_id)
             / nullif(to_base_unit(m.yield_qty, m.yield_unit, d.restaurant_id), 0)
           ) as qty
    from dish_lines d
    join public.recipe_meta m
      on  m.restaurant_id = d.restaurant_id
      and m.recipe_name = d.ingredient_name
      and m.kind = 'component'
    join public.recipes_estimated cl
      on  cl.restaurant_id = d.restaurant_id
      and cl.menu_item_name = d.ingredient_name
    where (select c.base_unit from public.unit_conversions c
            where c.from_unit = d.unit and c.restaurant_id is null limit 1)
        = (select c.base_unit from public.unit_conversions c
            where c.from_unit = m.yield_unit and c.restaurant_id is null limit 1)
    group by cl.ingredient_name
  ),
  theoretical_usable as (
    select ingredient, sum(qty) as qty
    from (select * from direct union all select * from expanded) u
    group by ingredient
  ),
  -- Recipes state USABLE quantities (peeled onion, trimmed chicken).
  -- Divide by the usable-yield % to get what you have to BUY.
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
           sum(
             -- Units bought, in the item's default unit. Case purchases
             -- store their count in case_qty with unit_qty = 0; the
             -- pack size turns cases into units.
             (case when coalesce(l.unit_qty, 0) > 0 then l.unit_qty
                   else coalesce(l.case_qty, 0) * coalesce(s.pack_qty, 0)
              end)
             -- What ONE of those really is ("1 = 35 lb jug", "1 bunch
             -- = 3 oz"); without it, the default unit as before.
             * case when s.unit_size is not null and s.unit_size_unit is not null
                    then to_base_unit(s.unit_size, s.unit_size_unit, l.restaurant_id)
                    else to_base_unit(1, coalesce(ci.default_unit, 'EA'), l.restaurant_id)
               end
           ) as qty
    from public.invoice_lines l
    join public.canonical_items ci on ci.id = l.canonical_item_id
    join public.invoice_headers h  on h.id  = l.header_id
    left join public.ingredient_settings s
      on  s.restaurant_id = l.restaurant_id
      and s.canonical_item_id = l.canonical_item_id
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
