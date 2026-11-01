# Clover sandbox → getinvoiceIQ sales integration

Pulls daily POS sales from the Clover sandbox test merchant into Supabase so
the dashboard can show **food cost % = invoice spend ÷ net sales** (trailing
30 days). The manual API-token path below is the pilot shortcut; OAuth for
real merchants comes later.

## What it is

| Piece | File | Purpose |
|---|---|---|
| API client | `lib/clover.ts` | Typed v3 REST client + `computeDailySales()` |
| Seeder | `scripts/seed-clover-sandbox.ts` | Creates ~N days of realistic sandbox orders |
| Sync | `scripts/sync-clover-sales.ts` | Upserts daily aggregates into `daily_sales` |
| Schema | `sql/005_daily_sales.sql` | `daily_sales` table + RLS (idempotent) |
| KPI | `app/dashboard/page.tsx` | 5th card: "Food cost %" |

**Net-sales definition** (see `computeDailySales()` in `lib/clover.ts`):
`net = gross − discounts − refunds`, tax excluded. Gross is summed from line
items (not `order.total`, which goes stale after API-side edits). Clover
stores discount amounts as *negative* cents — the code takes `abs()` to be
sign-agnostic. Dates bucket by `clientCreatedTime ?? createdTime` (UTC day).

## Setup (one time)

1. Log in to the [sandbox developer dashboard](https://sandbox.dev.clover.com)
   and select your test merchant ("test", UUID `EQSDJPFDBX1X1`). The original
   "Test Merchant" (`N2J3RZTJBMFM1`) was abandoned — its paid orders cannot be
   deleted through the Clover API.
2. Merchant ID: **Setup → Merchants** (Account Settings page, Merchant column).
3. API token: open the test Merchant Dashboard → **Setup → API Tokens** →
   generate a test token (per Clover's "Generate a merchant-specific test API
   token" doc). These tokens work in sandbox only — production web apps need
   OAuth expiring tokens.
4. Apply `sql/005_daily_sales.sql` in the Supabase SQL editor (idempotent,
   safe to re-run).
5. Add to `.env.local` (never commit real values):

```bash
CLOVER_BASE_URL=https://apisandbox.dev.clover.com
CLOVER_MERCHANT_ID=EQSDJPFDBX1X1
CLOVER_API_TOKEN=<paste token>
RESTAURANT_ID=<uuid of the restaurant row in Supabase>
```

## Test loop

```bash
npm run seed:clover              # 7 days of sandbox orders (default)
npm run seed:clover -- --days 30 # more history
npm run sync:clover -- --days 7  # pull into daily_sales
npm run sync:clover -- --dry-run # preview what would be upserted
```

Then open the dashboard — the "Food cost %" card reads the trailing 30 days
of `daily_sales`. It shows `—` with "no sales synced yet" until the first
sync runs.

To delete seeded orders: `npm run seed:clover -- --clean`
(tracks IDs in `scripts/.clover-seed.json`, gitignored).

## Notes & limits

- All money is in **cents** in Clover's API.
- The seeder sends backdated `clientCreatedTime` on order creation, but the
  sandbox server **ignores it** (verified 2026-10-01: server stamps its own
  time on both `createdTime` and `clientCreatedTime`). All seeded orders land
  on the day they were created. Harmless for testing; production is unaffected
  because real Clover hardware stamps the true sale time. `computeDailySales`
  still prefers `clientCreatedTime` when present.
- Payment creation (`{ amount, tender: { id } }` on the cash tender) is only
  verified from real-world integrations, not an official page — the seeder
  treats it as best-effort (warns and continues). Payments are realism only;
  net-sales math never reads them.
- Card tenders are rejected from the API (must go through a device); the
  seeder uses the cash tender (`labelKey com.clover.tender.cash`).
- List pagination defaults to `limit=1000` and pages until a short page; the
  server-side max is not documented, so this is safe either way.
- Line-item-level discounts are usually absent from the list endpoint
  (official docs require expanding `discounts` on a per-order line-items
  call); order-level discounts are the reliable source and are summed.
- Date-range list filters: Clover rejects comma-joined ranges on one field
  (`createdTime>=X,createdTime<Y` → 400). Use two `filter` query params
  instead (verified 2026-10-01).
- Sandbox base URL: `https://sandbox.dev.clover.com` (API verified working
  here 2026-10-01; `apisandbox.dev.clover.com` is the documented alternate).
  Production US: `https://api.clover.com` (with OAuth tokens, not API tokens).
