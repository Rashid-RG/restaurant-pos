# GastroFlow POS — Full Build Plan

**Prepared for:** Rashid
**Date:** 20 July 2026
**Companion to:** `UPGRADE_PLAN.md` (the audit & strategy). This document is the **concrete, buildable blueprint** — stack, repo structure, database schema, API contract, real-time events, and a milestone-by-milestone build sequence with acceptance criteria.

> Read `UPGRADE_PLAN.md` first for *why*. This file is *how*.

---

## 1. What you are building

Three front-end apps on one shared backend and one PostgreSQL database:

1. **pos-admin** — staff app (evolution of your current `src/`): POS, floor plan, KDS, inventory, customers, reports, and online-store controls. Login + roles + PINs.
2. **customer-web** — public PWA for diners: browse → cart → pay → track. Guest or customer account.
3. **super-admin** — vendor console (you): manage tenants, plans, feature flags.

Backend is **multi-tenant** from day one: every row carries a `tenant_id`, every request is scoped to a tenant, and the server owns all money math.

---

## 2. Target tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** everywhere | Replace plain JS incrementally |
| Backend | **Node + Express** (or NestJS for structure) | Keep your Express knowledge; NestJS if you want opinionated modules |
| Real-time | **Socket.IO** | KDS, floor, order tracking |
| Database | **PostgreSQL** | Managed: Supabase / Neon / RDS |
| ORM + migrations | **Prisma** (or Drizzle) | Versioned schema, type-safe queries |
| Validation | **Zod** | Validate every request body |
| Auth | **JWT (access + refresh)** + bcrypt/argon2 | RBAC + tenant claim in token |
| Payments | **PayHere** (LK) behind a provider interface | Stripe later for non-LK tenants |
| Front end | **React 18 + Vite** (keep) | customer-web as a **PWA** |
| Styling | Keep current CSS or adopt Tailwind + shared `ui` package | |
| Jobs/queue | **BullMQ + Redis** | Emails, receipts, reports, webhooks |
| Printing | **ESC/POS** (`node-thermal-printer` or similar) | 58/80 mm + cash drawer |
| Storage | S3-compatible bucket | Menu images |
| Observability | Sentry + structured logs (pino) | |
| CI/CD | GitHub Actions + Docker | Lint, test, build, deploy |

---

## 3. Repository structure (monorepo)

```
gastroflow/
├─ apps/
│  ├─ pos-admin/        # staff React app  (migrate current src/ here)
│  ├─ customer-web/     # customer PWA
│  └─ super-admin/      # vendor console
├─ services/
│  └─ api/
│     ├─ src/
│     │  ├─ modules/    # auth, tenants, menu, orders, billing, payments, inventory, customers, reports, printing
│     │  ├─ public/     # tenant-scoped routes for customer-web
│     │  ├─ private/    # role-protected routes for pos-admin / super-admin
│     │  ├─ realtime/   # Socket.IO gateway + events
│     │  ├─ middleware/ # auth, tenant-scope, validation, rate-limit
│     │  └─ lib/        # billing engine, payment providers, printing
│     └─ prisma/        # schema.prisma + migrations
├─ packages/
│  ├─ shared-types/     # DTOs/types shared by apps + api
│  ├─ ui/               # shared components/design system
│  └─ config/           # eslint, tsconfig, env schema
└─ infra/               # docker-compose, CI, deploy, .env.example
```

Use a workspace tool (pnpm workspaces / Turborepo) so apps share `shared-types` and `ui`.

---

## 4. Database schema (PostgreSQL, multi-tenant)

Every table (except `tenants` and `users` at platform level) has `tenant_id`. Enable Row-Level Security and add a mandatory tenant filter in the data layer. Normalize order line items (fixes the current JSON-blob limitation).

```
tenants          (id, name, plan, currency, locale, status, created_at)
locations        (id, tenant_id, name, address, phone, timezone)          -- multi-branch
users            (id, tenant_id, name, email, password_hash, role, pin_hash, active)
                 -- role: owner | manager | cashier | kitchen
categories       (id, tenant_id, name, emoji, sort_order)
menu_items       (id, tenant_id, name, price, cost, category_id, image_url,
                  stock, min_stock, description, is_available, tax_group_id)
modifiers        (id, tenant_id, name, price_delta, group_id, ...)          -- e.g. "extra cheese"
tax_groups       (id, tenant_id, name, rate, inclusive, applies_to)         -- food vs alcohol etc.
dining_tables    (id, tenant_id, location_id, number, capacity, status, current_order_id)
customers        (id, tenant_id, name, phone, email, points, order_count, total_spent)
orders           (id, tenant_id, location_id, channel, dining_type, table_id, customer_id,
                  status, subtotal, discount_total, service_charge, tax_total, tip, total,
                  rounding, created_by, created_at, paid_at)
                 -- channel: pos | online-web | online-qr | delivery
order_items      (id, tenant_id, order_id, menu_item_id, name_snapshot, unit_price,
                  quantity, modifiers_json, notes, line_total)              -- NORMALIZED
payments         (id, tenant_id, order_id, method, amount, provider_ref, status, created_at)
                 -- supports SPLIT / multiple tenders per order
shifts           (id, tenant_id, location_id, user_id, opened_at, closed_at,
                  opening_float, expected_cash, counted_cash, over_short)
audit_log        (id, tenant_id, user_id, action, entity, entity_id, before, after, created_at)
settings         (tenant_id, key, value)                                    -- per-tenant config
subscriptions    (id, tenant_id, plan, status, provider_ref, current_period_end)  -- SaaS billing
```

Add indexes on `orders(tenant_id, created_at)`, `orders(tenant_id, status)`, `order_items(order_id)`, `payments(order_id)`, and foreign keys throughout.

---

## 5. Money: the server-authoritative billing engine

**Rule: the client never sends prices or totals.** It sends *intent*; the server computes the bill.

Request (place order):
```json
{
  "diningType": "dine-in",
  "tableId": "…",
  "customerId": "…",
  "items": [ { "menuItemId": "…", "quantity": 2, "modifiers": ["…"], "notes": "no onion" } ],
  "discount": { "type": "percent", "value": 10, "authorizedByPin": "…" },
  "serviceCharge": true
}
```

Server billing pipeline (`lib/billing`):
1. Load authoritative `menu_items` + `modifiers` prices for this tenant.
2. Compute each `line_total = (unit_price + modifier deltas) × quantity`.
3. `subtotal = Σ line_total`.
4. Apply discount (validate PIN/role if required); `discount ≤ subtotal`.
5. Apply **service charge** (configurable %, before/after tax per settings).
6. Apply **tax** per `tax_groups` (inclusive/exclusive, multiple rates).
7. Add **tip** if provided; apply **rounding** rule.
8. `total = subtotal − discount + service_charge + tax + tip ± rounding`.
9. Persist order + `order_items` + audit entry **inside one DB transaction**; deduct stock in the same transaction (fixes the current race condition).

**Split bills / partial payments:** an order can have many `payments` rows (part card + part cash, or split by seat/evenly). Order is `paid` only when `Σ payments.amount ≥ total` and each payment is confirmed.

**Refunds/voids:** create a negative/linked `payment` + audit entry, restore stock, require manager PIN, record a reason code.

---

## 6. Payments (PayHere) flow

1. pos-admin / customer-web requests a payment for an order → backend creates a `payments` row (`status: pending`) and a PayHere session (Checkout API / JS SDK) in **LKR**.
2. Customer/cashier completes payment on PayHere.
3. PayHere calls your **`notify_url`** server callback with a **checksum** → backend verifies checksum, marks `payment` (and order, if fully covered) `paid`, emits a real-time event.
4. **Never** mark paid from the client — only from the verified server callback.
5. Keep a `PaymentProvider` interface (`createSession`, `verifyCallback`, `refund`) so Stripe can be added later without touching billing.

---

## 7. API contract (shape)

**Private (pos-admin / super-admin, JWT + role required)**
```
POST /auth/login              POST /auth/refresh        POST /auth/logout
GET/POST/PATCH/DELETE /menu-items, /categories, /modifiers, /tax-groups
GET/POST/PATCH/DELETE /tables, /customers, /users
POST /orders                  PATCH /orders/:id/status   POST /orders/:id/refund
POST /orders/:id/payments     (supports split)
POST /shifts/open  /shifts/:id/close
GET  /reports/z  /reports/sales  /reports/items  /reports/tax
POST /online-store/toggle     PATCH /menu-items/:id/availability   (86 an item)
GET  /audit-log
-- super-admin: /tenants, /plans, /feature-flags
```

**Public (customer-web, tenant-scoped by slug/subdomain, rate-limited, NO staff data)**
```
GET  /t/:tenant/menu                 (only available items, no cost/margin)
POST /t/:tenant/orders               (intent only; server prices it)
POST /t/:tenant/orders/:id/pay       (PayHere session)
GET  /t/:tenant/orders/:id/status    (live tracking)
POST /t/:tenant/customers/login|register
```

Every route runs through: `authenticate → resolveTenant → authorize(role) → validate(zod) → handler`.

---

## 8. Real-time events (Socket.IO, per-tenant rooms)

```
order.created      → KDS + floor + reports        (room: tenant:{id})
order.status       → KDS + customer tracking       (room: tenant:{id}, order:{id})
table.updated      → floor + POS
inventory.low      → dashboard alert
online-store.toggled → customer-web
```
Clients join `tenant:{id}` (and `order:{id}` for tracking). Never broadcast across tenants.

---

## 9. Build sequence (milestones with acceptance criteria)

Each milestone is shippable and testable. Do them in order.

### M0 — Foundation & security (release blocker)
- Set up monorepo, TypeScript, ESLint, Prisma, PostgreSQL, migrations, `.env` schema, Docker.
- Auth: users, bcrypt/argon2, JWT access/refresh, RBAC, POS PINs.
- Middleware: authenticate, tenant-scope, Zod validation, helmet, CORS allow-list, rate limiting.
- Protect **all** mutating routes; remove/secure the destructive reset & import endpoints.
- **Acceptance:** no endpoint mutates data without auth; a cashier token cannot hit manager routes; requests with bad bodies are rejected 400.

### M1 — Data platform & migration
- Port the 6 tables into the new normalized, multi-tenant schema; migrate seed data.
- Normalize `order_items`; add indexes + foreign keys.
- Move pos-admin's `db.js` fetch client onto the new API.
- **Acceptance:** existing POS flows work against PostgreSQL; you can SQL-query item sales.

### M2 — Pro billing engine
- Server-authoritative pricing pipeline; discounts w/ PIN; service charge; multi-tax; tips; rounding.
- Split bills / multiple `payments` per order; refunds/voids with audit + stock restore.
- Order placement + stock deduction in a single transaction.
- **Acceptance:** tampered client totals are ignored; split payment marks order paid only when covered; refund restores stock and logs who/why.

### M3 — Payments (PayHere)
- PayHere session creation (LKR) + checksum-verified `notify_url` callback; provider interface.
- **Acceptance:** a sandbox payment marks the order paid only via server callback; a spoofed client "paid" call does nothing.

### M4 — Real-time + hardware
- Socket.IO gateway with per-tenant rooms; wire KDS, floor, order events.
- ESC/POS thermal receipt (58/80 mm), KOT print, cash-drawer kick.
- **Acceptance:** new order appears on a second device's KDS instantly; receipt prints on a thermal printer.

### M5 — Reports & shift control
- Shift open/close, cash-up (float, expected vs counted, over/short); X/Z reports; EOD summary by payment/category/staff/hour; tax report; item profitability.
- **Acceptance:** Z-report reconciles payments and cash for a shift; item margin report uses cost/price.

### M6 — Multi-tenant SaaS core
- `tenant_id` + RLS enforced; tenant onboarding/provisioning; per-tenant settings/branding/currency/tax.
- super-admin console; SaaS subscription billing (plans, trials, invoices); feature flags per plan.
- Multi-location within a tenant (central menu + per-branch overrides & reporting).
- **Acceptance:** two tenants cannot see each other's data (tested); a new restaurant can self-onboard and run a sale.

### M7 — Customer online ordering PWA
- customer-web: menu (photos/modifiers/availability), cart, delivery/pickup/QR dine-in, guest+account, loyalty redemption.
- Online PayHere checkout; live order tracking via Socket.IO; orders land on KDS tagged `online`.
- Online-store controls in pos-admin (open/close, 86, delivery zones/fees, prep times).
- **Acceptance:** a QR/online order flows to the kitchen, decrements stock through the same path, and the customer sees status update live.

### M8 — Scale & differentiate
- Offline/hybrid mode (local queue + sync); reservations/waitlist; advanced analytics; gift cards/loyalty tiers; delivery-aggregator & accounting integrations.
- **Acceptance:** POS keeps taking orders with the internet unplugged and syncs on reconnect.

---

## 10. Environment & deployment

- **Secrets:** all config in env vars (DB URL, JWT secrets, PayHere merchant id/secret, S3, Redis). Never commit. Provide `infra/.env.example`.
- **Environments:** local (docker-compose: api + Postgres + Redis) → staging → production.
- **CI (GitHub Actions):** lint → type-check → test → build → migrate → deploy.
- **Hosting:** managed Postgres (Supabase/Neon/RDS); api on a container host (Render/Fly/Railway/ECS); front ends on static hosting/CDN; Redis for jobs.
- **Backups:** automated per-tenant DB backups + tested restore. Keep the JSON export as a convenience, but behind auth.
- **Monitoring:** Sentry for errors, uptime checks, structured request logs.

---

## 11. Cross-cutting requirements (don't skip)

- **Testing:** unit tests for the billing engine (the money math must be bulletproof), integration tests for tenant isolation, e2e for order → pay → KDS.
- **Error boundaries** in every React app; graceful API error handling.
- **Migrations only** — no more ad-hoc `CREATE TABLE` in server code.
- **Audit everything** that touches money or price.
- **Accessibility & i18n** for customer-web (multi-language helps a SaaS beyond LK).

---

## 12. Suggested order of your very next steps

1. Scaffold the monorepo + TypeScript + Prisma + Postgres locally (M0 start).
2. Build auth + tenant-scope middleware and lock down the API.
3. Port the schema (normalized, multi-tenant) and migrate pos-admin onto it.
4. Build and unit-test the server-side billing engine.
5. Stand up a PayHere sandbox and wire the callback.

From there, follow M4 → M8 in sequence. Each milestone leaves you with a working, demonstrable system.
