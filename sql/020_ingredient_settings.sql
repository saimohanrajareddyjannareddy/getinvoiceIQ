-- 020_ingredient_settings.sql
-- Per-restaurant ingredient settings that make recipe costs honest:
--
--   pack_qty   — how many of the ingredient's default unit come in ONE
--                case ("1 case of milk = 4 GAL"). Invoice lines bought
--                by the case store case_qty with unit_qty = 0; without
--                a pack size they can't be priced or counted.
--   yield_pct  — usable share after trimming / peeling / cooking loss
--                (onion ~90, whole chicken ~70). Plate costs divide the
--                purchase price by it; usage_variance divides recipe
--                usage by it to get the quantity you have to buy.
--
-- Per restaurant, because case sizes differ by supplier and trim loss
-- differs by kitchen. canonical_items stays a global catalog.
--
-- Apply in the Supabase SQL editor AFTER 008 and 018. Idempotent.
-- It replaces usage_variance() from 008 with a version that reads these
-- settings; if you ever re-run 008, run this file again afterwards.

create table if not exists public.ingredient_settings (
  id                uuid          primary key default gen_random_uuid(),
  restaurant_id     uuid          not null references public.restaurants(id) on delete cascade,
  canonical_item_id uuid          not null references public.canonical_items(id) on delete cascade,
  pack_qty          numeric(12,4) check (pack_qty is null or pack_qty > 0),
  yield_pct         numeric(5,2)  not null default 100
                      check (yield_pct > 0 and yield_pct <= 100),
  updated_at        timestamptz   not null default now(),
  unique (restaurant_id, canonical_item_id)
);

create index if not exists idx_ingredient_settings_restaurant
  on public.ingredient_settings (restaurant_id);

comment on table public.ingredient_settings is
  'Per-restaurant pack size (units of canonical default_unit per case) and usable yield % for an ingredient.';

alter table public.ingredient_settings enable row level security;

drop policy if exists "Members see their ingredient settings"   on public.ingredient_settings;
drop policy if exists "Members write their ingredient settings" on public.ingredient_settings;

create policy "Members see their ingredient settings"
  on public.ingredient_settings for select
  using (
    restaurant_id in (
      select restaurant_id from public.user_restaurants where user_id = auth.uid()
    )
  );

create policy "Members write their ingredient settings"
  on public.ingredient_settings for all
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

grant all on public.ingredient_settings to service_role;

-- ── usage_variance, now pack- and yield-aware ────────────────────
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
           sum(to_base_unit(
             -- Case purchases store their count in case_qty with
             -- unit_qty = 0; the pack size turns cases into units.
             case when coalesce(l.unit_qty, 0) > 0 then l.unit_qty
                  else coalesce(l.case_qty, 0) * coalesce(s.pack_qty, 0)
             end,
             coalesce(ci.default_unit, 'EA'),
             l.restaurant_id
           )) as qty
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
