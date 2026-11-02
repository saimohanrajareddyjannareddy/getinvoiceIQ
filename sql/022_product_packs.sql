-- 022_product_packs.sql
-- Pack sizes per STORE PRODUCT, so every purchase breaks down to one
-- scale (pounds for weight, gallons for liquids, count for countables)
-- no matter which store it came from:
--
--   Restaurant Depot "CORNSTARCH 24/16OZ": 1 case = 24 x 16 oz = 24 lb
--   Costco cornstarch:                     1 case = 30 x 12 oz = 22.5 lb
--   Cilantro:                              1 case = 20 x 200 g = 8.8 lb
--   Yogurt:                                1 case = 4 x 1 lb   = 4 lb
--
-- Keyed by (restaurant, vendor, item_name as printed), normalized the
-- same way in the app (lib/packs.ts normKey): lower-case, trimmed,
-- single spaces. A product pack wins over the ingredient-level pack
-- size / "1 on invoice =" (sql/020, 021), which stay as the fallback.
--
-- Apply in the Supabase SQL editor AFTER 021. Idempotent. Replaces
-- usage_variance() again; if you re-run 008, 020 or 021, run this after.

create table if not exists public.product_packs (
  id                uuid          primary key default gen_random_uuid(),
  restaurant_id     uuid          not null references public.restaurants(id) on delete cascade,
  vendor_key        text          not null,
  item_key          text          not null,
  canonical_item_id uuid          references public.canonical_items(id) on delete set null,
  pack_count        numeric(12,4) not null default 1 check (pack_count > 0),
  pack_size         numeric(12,4) not null check (pack_size > 0),
  pack_unit         text          not null
                      check (pack_unit in ('lb', 'oz', 'g', 'kg', 'gal', 'floz', 'l', 'ml', 'each')),
  updated_at        timestamptz   not null default now(),
  unique (restaurant_id, vendor_key, item_key)
);

create index if not exists idx_product_packs_restaurant
  on public.product_packs (restaurant_id);

comment on table public.product_packs is
  'What one purchased unit of a store product contains (pack_count x pack_size pack_unit), per restaurant. Breaks every purchase down to one scale.';

-- 'l' and 'ml' for pack sizes ('ml' is already a base unit).
insert into public.unit_conversions (from_unit, to_base, base_unit) values
  ('l', 1000, 'ml')
on conflict do nothing;

alter table public.product_packs enable row level security;

drop policy if exists "Members see their product packs"   on public.product_packs;
drop policy if exists "Members write their product packs" on public.product_packs;

create policy "Members see their product packs"
  on public.product_packs for select
  using (
    restaurant_id in (
      select restaurant_id from public.user_restaurants where user_id = auth.uid()
    )
  );

create policy "Members write their product packs"
  on public.product_packs for all
  using (
    restaurant_id in (
      select restaurant_id from public.user_restaurants where user_id = auth.uid()
    )
  )
  with check (
    restaurant_id in (
      select restaurant_id from public.user_restaurants where user_id = auth.uid()
    )
  );

grant all on public.product_packs to service_role;

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
