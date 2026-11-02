# getinvoiceIQ

**Invoice and food-cost software for independent restaurants.**
Snap a receipt, forward an email, or send a WhatsApp photo. getinvoiceIQ reads every line,
checks the math, and turns supplier paperwork into spend, price alerts, food cost % and
recipe costing while the week is still fixable.

Live at **[getinvoiceiq.com](https://www.getinvoiceiq.com)** · $99 per location / month after a 14-day free trial.

---

## What it does

| Area | What the owner gets |
|---|---|
| **Invoice capture** | Camera scanner, PDF/photo upload, Gmail inbox scan, WhatsApp intake. AI reads vendor, date, totals and every line item. |
| **Review queue** | Invoices whose numbers don't add up (lines ≠ subtotal, qty × price ≠ line total, missing vendor/date) wait for a human. Email and WhatsApp imports always wait. Nothing lands in the books unchecked. |
| **Price tracker & alerts** | Unit price per item over time; alerts when a supplier price moves. |
| **Food cost %** | Food & drink spend ÷ POS net sales (Clover), trailing 30 days and weekly trend. Cleaning and packaging supplies are excluded. |
| **Recipes & dish costing** | AI drafts recipes from the ingredients you actually buy; you confirm. Plate cost, food cost % and margin per dish, priced from your latest invoices. Pack sizes, usable yield and "1 on invoice =" make the costs honest. |
| **Pack sizes** | Every product per store broken down to one scale (pounds for food and dry goods, gallons for liquids, count for countables). Set once what a case holds (24 × 16 oz, 20 × 200 g); pack sizes printed in product names are read automatically. Compares cost per pound across stores. |
| **Theoretical vs actual usage** | What sales × recipes say you should have used vs what you bought, in dollars, with calibration hints. |
| **Vendors, wastage, Ask** | Vendor list and spend, purchased-vs-sold by category, and an assistant that answers questions from the restaurant's own records. |
| **Multi-restaurant & team** | One login, many locations; invite staff per restaurant. Billing per location through Stripe. |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) ·
Anthropic Claude (invoice reading, recipe drafts, Ask) · Stripe · Clover POS · Gmail API · WhatsApp Cloud API ·
Vercel (hosting + cron)

> This Next.js version has breaking changes from older releases. See `AGENTS.md` before writing code.

## Run it locally

```bash
npm ci
# create .env.local with the variables below
npm run dev                  # http://localhost:3000
```

Fonts are self-hosted in `app/fonts`, so `npm run build` works without internet access.

### Environment variables

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase client |
| `SUPABASE_SERVICE_KEY` | Server routes (billing, crons, intake) |
| `ANTHROPIC_API_KEY` | Invoice parsing, recipe drafts, Ask |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Billing. `STRIPE_PRICE_ID` should be a `price_…` id |
| `CLOVER_APP_ID`, `CLOVER_APP_SECRET`, `CLOVER_ENV` | Clover POS sales sync ([docs/clover.md](docs/clover.md)) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail invoice scanning |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_INTAKE_NUMBER`, `WHATSAPP_GRAPH_VERSION` | WhatsApp invoice intake |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored OAuth tokens |
| `CRON_SECRET` | Protects the cron endpoints |
| `MISE_EMAIL_WEBHOOK_SECRET` | Email-ingest webhook |

### Database

Apply the files in `sql/` in the Supabase SQL editor, in number order. They are idempotent.
Exceptions to plain number order:

- `018_recipe_meta.sql` runs **before** `008_recipe_usage_variance.sql`.
- `020_ingredient_settings.sql`, `021_unit_size.sql`, then `022_product_packs.sql` run after 008, in that order. Re-run them if you re-run 008.

`001_foundation.sql` builds on base tables (restaurants, user_restaurants, invoice_headers,
invoice_lines) created by earlier setup migrations.

## Deploy

Pushing to `main` deploys to production on Vercel. Every other branch gets a preview URL.
Crons (`vercel.json`): Gmail scan daily 13:30 UTC, Clover sync daily 06:00 UTC.

## Docs

- [Staff SOP — using getinvoiceIQ day to day](docs/staff-sop.md)
- [Clover integration](docs/clover.md)
