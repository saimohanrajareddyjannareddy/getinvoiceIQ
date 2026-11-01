-- ============================================================
-- 019_whatsapp_intake.sql
-- WhatsApp invoice intake: staff (or a supplier) send a receipt
-- photo / PDF to the getinvoiceIQ WhatsApp number (Meta WhatsApp
-- Business Platform, Cloud API). A webhook downloads the media,
-- routes it to a restaurant by the SENDER's phone number, runs
-- the shared parser, and files it in Review — WhatsApp is an
-- untrusted channel, exactly like email: nothing counts until
-- the owner approves it.
--
-- Tables:
--   whatsapp_senders  — phone number → restaurant routing.
--     Phone is stored digits-only in international format
--     (e.g. 13144125622), matching WhatsApp's `from` field.
--     Globally unique: one number routes to one restaurant.
--   whatsapp_messages — one row per WhatsApp message id
--     (wamid). Meta retries webhook deliveries; the unique id
--     is the claim that makes processing idempotent. Written
--     only by the service role (RLS on, no client policies).
--
-- Also widens two existing CHECK constraints so the new channel
-- can be recorded honestly: invoice_files.source and
-- vendors.ingestion_method both gain 'whatsapp'.
--
-- Run in the Supabase SQL editor. Until this runs, the webhook
-- finds no routing rows (every sender is "not registered") and
-- the Settings card cannot save numbers — nothing else changes.
-- ============================================================

create table if not exists public.whatsapp_senders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  phone         text not null,
  label         text,
  kind          text not null default 'staff' check (kind in ('staff', 'supplier')),
  created_at    timestamptz not null default now(),
  unique (phone)
);

create index if not exists idx_whatsapp_senders_restaurant
  on public.whatsapp_senders (restaurant_id);

alter table public.whatsapp_senders enable row level security;

drop policy if exists "members_read_own_whatsapp_senders" on public.whatsapp_senders;
create policy "members_read_own_whatsapp_senders"
  on public.whatsapp_senders
  for select
  using (
    exists (
      select 1 from public.user_restaurants ur
      where ur.restaurant_id = whatsapp_senders.restaurant_id
        and ur.user_id = auth.uid()
    )
  );

drop policy if exists "members_add_own_whatsapp_senders" on public.whatsapp_senders;
create policy "members_add_own_whatsapp_senders"
  on public.whatsapp_senders
  for insert
  with check (
    exists (
      select 1 from public.user_restaurants ur
      where ur.restaurant_id = whatsapp_senders.restaurant_id
        and ur.user_id = auth.uid()
    )
  );

drop policy if exists "members_delete_own_whatsapp_senders" on public.whatsapp_senders;
create policy "members_delete_own_whatsapp_senders"
  on public.whatsapp_senders
  for delete
  using (
    exists (
      select 1 from public.user_restaurants ur
      where ur.restaurant_id = whatsapp_senders.restaurant_id
        and ur.user_id = auth.uid()
    )
  );

create table if not exists public.whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  wa_message_id   text not null unique,
  restaurant_id   uuid references public.restaurants(id) on delete set null,
  sender_phone    text,
  media_id        text,
  invoice_file_id uuid references public.invoice_files(id) on delete set null,
  status          text not null default 'processing',
  detail          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.whatsapp_messages enable row level security;
-- No client policies on purpose: only the service role (the
-- webhook) reads or writes the delivery log.

-- Let the new channel be named in the two existing enums.
alter table public.invoice_files
  drop constraint if exists invoice_files_source_check;
alter table public.invoice_files
  add constraint invoice_files_source_check
  check (source is null or source in ('email', 'portal', 'upload', 'api', 'whatsapp'));

alter table public.vendors
  drop constraint if exists vendors_ingestion_method_check;
alter table public.vendors
  add constraint vendors_ingestion_method_check
  check (ingestion_method in ('email', 'portal', 'upload', 'api', 'whatsapp'));

comment on table public.whatsapp_senders is
  'WhatsApp intake routing: a registered sender phone number files incoming receipt media into exactly one restaurant (Review queue, untrusted channel).';
comment on table public.whatsapp_messages is
  'WhatsApp webhook delivery log / idempotency claims, keyed by Meta message id (wamid). Service-role only.';
