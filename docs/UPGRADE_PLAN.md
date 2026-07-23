# GastroFlow POS — System Audit & Upgrade Plan

**Prepared for:** Rashid
**Date:** 20 July 2026
**Scope:** Full codebase scan, upgrade/improvement plan, pro-level billing, customer-facing online ordering app, and SaaS (multi-tenant) roadmap.

---

## 1. Executive summary

GastroFlow POS today is a **single-terminal, single-restaurant** application: a React + Vite front end talking to an Express + SQLite backend over a small REST API. The core flows work — build a cart, send a KOT, manage tables, deduct stock, take a payment, print a browser receipt, track loyalty points, and back up to JSON. It is a solid *prototype*.

It is **not yet a production or sellable product**. Three problems block everything else:

1. **No authentication or authorization at all.** There is no login, no users, no roles, no passwords. Anyone who can reach the API can read and overwrite the entire database — including a single unauthenticated endpoint that wipes every table.
2. **Billing integrity is not trustworthy.** All money math (subtotal, discount, tax, total) is calculated in the browser and the server stores whatever it is sent. A modified request can set any price or total. For a "pro billing system" this is the single most important fix.
3. **It cannot be sold as SaaS in its current shape.** There is no notion of a "tenant" (a restaurant account), no data isolation, no real-time updates, no cloud database, and no online ordering app.

This document lays out what to fix, what to add, and the order to do it in — ending with a phased roadmap to take GastroFlow from prototype to a multi-tenant SaaS product with a customer ordering app and pro billing.

---

## 2. What exists today (system snapshot)

**Front end** (`src/`, React 18 + Vite, ~2,900 lines)

| Module | File | What it does |
|---|---|---|
| Dashboard | `Dashboard.jsx` | KPI cards, charts, recent sales |
| POS / order screen | `POSView.jsx` (683 lines) | Menu grid, cart, discounts, dining type, KOT, payment, print receipt |
| Floor plan | `FloorPlan.jsx` | Table grid with status (free/occupied/billing) |
| Kitchen Display (KDS) | `KDSView.jsx` | Pending / preparing / ready order columns |
| Inventory | `Inventory.jsx` | Stock levels, min-stock, cost/price |
| Customers | `Customers.jsx` | CRM list, loyalty points, spend |
| Settings | `Settings.jsx` (598 lines) | Business info, tax rate, currency, backup/restore/reset |
| Global state | `context/POSContext.jsx` (531 lines) | All app state + business logic |
| API client | `database/db.js` | Thin `fetch` wrapper over the REST API |

**Back end** (`server.js`, ~520 lines, Express + SQLite via `sqlite3`)

- REST CRUD for `settings`, `categories`, `menu_items`, `tables`, `orders`, `customers`.
- Auto-creates and seeds the schema on boot (pre-seeded for Sri Lanka — `Rs.`, Colombo address, 10% tax).
- Backup import / full reset endpoints.

**Data model** (SQLite, `restaurant.db`) — 6 tables. Orders store their line items as a **JSON string** inside a single `items` column.

**Notable existing strengths** (worth keeping): clean separation of concerns, a single source of truth in context, sensible order lifecycle (pending → preparing → ready → paid), inventory auto-deduction and return-on-cancel, and loyalty accrual on payment.

---

## 3. Audit findings — critical issues

These are ordered by severity. The first four are **release blockers**.

### 3.1 No authentication / authorization (Critical)
There is no user system anywhere in the code (`grep` for auth/login/password/jwt/session returns nothing). Consequences:
- Anyone on the network can call `GET /api/customers` and read every customer's name, phone, and email (a data-protection problem).
- Anyone can `POST /api/menu_items` to change prices, or `POST /api/orders` to fabricate/alter sales.
- **`POST /api/database/reset` and `POST /api/database/import` are unauthenticated and destructive** — a single request erases all data. `db.js`'s `clear()` even calls reset for routine "clear table" operations.

**Fix:** Introduce users, hashed passwords (bcrypt/argon2), sessions or JWT, and role-based access (Owner / Manager / Cashier / Kitchen). Protect every mutating endpoint. Add a per-action PIN for sensitive POS actions (voids, discounts, refunds).

### 3.2 Client-trusted billing math (Critical)
`getCartTotals()` computes subtotal, discount, tax, and total **in the browser** (`POSContext.jsx` lines 211–232). `POST /api/orders` accepts those numbers and stores them verbatim. There is no server-side recalculation and no validation.
- Price tampering, discount abuse, and tax evasion are all trivial.
- No guarantee that `total = subtotal − discount + tax`.

**Fix:** The server must be the source of truth for money. On order submit, the client sends only item IDs, quantities, modifiers, and customer/discount intent; the server looks up authoritative prices, recomputes every figure, and rejects mismatches. This is the backbone of a "pro billing system" (see §5).

### 3.3 No input validation, wide-open CORS, no secrets management (Critical)
- `app.use(cors())` allows **every** origin.
- No request-body validation on any route — any shape of JSON is accepted and written.
- No `.env` / secrets handling, no `helmet`, no rate limiting, no HTTPS assumption.
- `express.json({ limit: '50mb' })` is a large surface for abuse.

**Fix:** Add schema validation (Zod/Joi), lock CORS to known origins, add `helmet`, rate-limit auth and public endpoints, and move all config to environment variables.

### 3.4 Concurrency & data-integrity gaps (High)
- **Race conditions on stock:** stock is read then written from the client with no transaction or row lock. Two concurrent orders can oversell inventory. The same pattern risks double-deducting.
- **Orders store items as a JSON blob** — you cannot query "how many Margherita Pizzas sold this month" in SQL, report on item profitability, or index line items.
- **No foreign keys / indexes.** `orders` has no index on `timestamp`, `status`, `customerId`, or `tableId`, so dashboard/report queries will slow as data grows.
- **No audit trail.** Voids, discounts, price changes, and refunds leave no record of who did what and when — unacceptable for cash handling.

**Fix:** Wrap order placement + stock deduction in a DB transaction; normalize order line items into an `order_items` table; add foreign keys and indexes; add an `audit_log` table.

### 3.5 No real-time updates (High)
KDS and Floor Plan rely on state in memory and full reloads — there is no WebSocket/SSE. On a second device the kitchen won't see new tickets until a manual refresh, and table status won't sync between the cashier and the floor.

**Fix:** Add a real-time layer (Socket.IO or SSE) so order/table/KDS state pushes live to every connected device.

### 3.6 Receipt printing is browser-only (Medium)
Receipts use `window.print()` (`POSView.jsx`). That prints an A4/browser page, not a proper 58/80 mm thermal receipt, and can't open a cash drawer or auto-cut.

**Fix:** Add ESC/POS thermal printing (network/USB printer support), a proper receipt template (58/80 mm), cash-drawer kick, and KOT printing to a kitchen printer as an alternative/supplement to the KDS.

### 3.7 Backend architecture won't scale to SaaS (High, for your goal)
- SQLite is a single-file, single-writer database — fine for one terminal, wrong for multi-tenant cloud.
- No tenant concept: all data lives in one flat set of tables.
- The API client uses relative URLs and assumes the server is local.

**Fix:** Migrate to PostgreSQL, add a `tenant_id` to every table with row-level isolation, and design the API to be cloud/multi-device from the start (see §7).

### 3.8 Engineering hygiene (Medium)
No automated tests, no error boundaries in React, no TypeScript, no linting/CI, no migration system (schema is created ad hoc in code), no logging/monitoring. These don't block a demo but will hurt badly once you have paying customers.

---

## 4. Upgrades & improvements (prioritized)

| # | Upgrade | Why | Priority |
|---|---|---|---|
| 1 | Auth + roles (Owner/Manager/Cashier/Kitchen) + POS PINs | Blocks release; protects data & money | P0 |
| 2 | Server-side billing recompute & validation | Trustworthy totals | P0 |
| 3 | Lock down CORS, add validation, helmet, rate limiting, `.env` | Baseline security | P0 |
| 4 | Transactions + normalized `order_items` + indexes + FKs | Data integrity & reporting | P0 |
| 5 | Audit log for voids/discounts/refunds/price changes | Cash accountability | P1 |
| 6 | Real-time (Socket.IO/SSE) for KDS, floor, orders | Multi-device operation | P1 |
| 7 | Thermal ESC/POS receipt + KOT printing + cash drawer | Real restaurant hardware | P1 |
| 8 | Migrate SQLite → PostgreSQL, add `tenant_id` isolation | SaaS foundation | P1 |
| 9 | TypeScript, tests, migrations, CI, error boundaries, logging | Maintainability at scale | P2 |
| 10 | PWA/offline mode with local queue + sync (hybrid architecture) | Keep selling when internet drops | P2 |

> Industry note: the leading 2026 platforms (Toast, TouchBistro, Lightspeed) all use a **hybrid local/cloud** design — orders process locally when the internet is down and sync when it returns. Plan for this in item 10.

---

## 5. Pro-level billing system (specification)

This is the heart of the request. A "pro" billing engine means the **server owns every number** and the system handles the real-world billing scenarios a restaurant hits daily.

**Server-authoritative pricing.** Client sends intent (items, quantities, modifiers, customer, requested discount); server fetches current prices, applies rules, computes and returns the bill. Client never sets money fields.

**Billing capabilities to add:**
- **Split bills** — by item, by seat/cover, or evenly by N people; partial payments; multiple tenders on one check (e.g. part card, part cash).
- **Service charge** — configurable % (common in Sri Lanka, e.g. 10% service charge) applied before or after tax, shown as a distinct line.
- **Tax handling** — support multiple tax rates/tax groups per item (e.g. different rates for food vs alcohol), inclusive **or** exclusive pricing, and a clear tax breakdown on the receipt. Sri Lanka's VAT/SSCL treatment should be configurable rather than a single flat 10%.
- **Tips/gratuity** — capture on card or cash, attribute to staff, report on it.
- **Discounts & promotions** — item-level and check-level, percentage/flat, coupon codes, happy-hour/time-based pricing, combo/meal deals, buy-X-get-Y, loyalty redemption — each requiring role/PIN authorization and logged.
- **Refunds & voids** — full and partial refunds tied to the original transaction, with reason codes, manager authorization, inventory restoration, and audit entries.
- **Rounding rules** — configurable cash rounding (important where small coins are scarce).
- **Multi-currency display** (for a SaaS sold beyond Sri Lanka) with per-tenant currency and formatting.

**Payment gateway integration.** Today `paymentMethod` is just a text label. Add real processing:
- **PayHere** for the Sri Lankan market — it's the No. 1 local gateway, Central Bank–approved, settles natively in **LKR**, and accepts Visa/Mastercard/AMEX, eZ Cash, mCash, and bank transfers. It offers a Checkout API, a JavaScript SDK, and a Node.js integration package, with a `notify_url` server callback (checksum-verified) to confirm payment — exactly what a POS/online-order backend needs. Typical fees ~2.5–3.5% per card transaction.
- Keep a clean **payment provider abstraction** so you can add Stripe (for non-LK tenants) later without touching billing logic.
- Never trust the client for payment status — confirm via the gateway's server callback before marking an order paid.

**Financial reporting & controls (pro essentials):**
- **Shift management & cash-up:** open/close shift per cashier, starting float, expected vs counted cash, over/short, X-report (mid-shift) and Z-report (end-of-day).
- **End-of-day sales summary:** by payment type, by category, by staff, by hour, voids/discounts/refunds totals.
- **Item profitability** (you already store `cost` and `price` — expose margin reporting once line items are normalized).
- **Tax report** ready for filing.
- **Cash drawer log** and no-sale tracking.

---

## 6. Customer-facing online ordering app

A separate client app (web-first PWA, optionally wrapped as a mobile app later) that connects to the same backend but through a **public, rate-limited, tenant-scoped API**.

### 6.0 Two-app architecture (how the pieces separate)

GastroFlow is **two distinct front-end applications sharing one backend and one database** — not one app with an extra tab:

| | Staff / Admin app (existing `src/`) | Customer ordering app (new) |
|---|---|---|
| Who uses it | Owner, manager, cashier, kitchen | Diners / the public |
| Where it runs | Counter terminal, kitchen, back office | Customer's own phone/browser |
| Access | Login + roles + PINs required | Guest or customer account, no staff login |
| API used | Private, role-protected API | Public, rate-limited, tenant-scoped API |
| Scope | Full POS, floor, KDS, inventory, reports, **online-store controls** | Browse menu → cart → pay → track order only |

They connect through **one shared backend + database**: an online order lands in the same `orders` table and pushes onto the KDS tagged `online`; inventory decrements through the same server-authoritative path; and the same real-time layer sends status updates back to the customer's tracking screen. Crucially, the *controls* for the online store (open/close, 86 items, delivery zones, prep times) live **inside the staff admin app**, so there is nothing for the customer app to manage.

Recommended **monorepo layout**:

```
gastroflow/
├─ apps/
│  ├─ pos-admin/        # existing React app (staff): POS, floor, KDS, inventory, reports, online-store controls
│  ├─ customer-web/     # NEW customer PWA: menu, cart, checkout, order tracking
│  └─ super-admin/      # NEW vendor console: tenants, plans, feature flags (SaaS)
├─ services/
│  └─ api/              # Node/Express (or NestJS) + Socket.IO — the single backend
│     ├─ modules/       # auth, billing, orders, menu, inventory, payments(PayHere), tenants
│     ├─ public/        # public tenant-scoped routes used by customer-web
│     └─ private/       # role-protected routes used by pos-admin & super-admin
├─ packages/
│  ├─ shared-types/     # TypeScript types/DTOs shared across apps
│  ├─ ui/               # shared design-system components
│  └─ db/               # Prisma/Drizzle schema + migrations (PostgreSQL)
└─ infra/               # Docker, CI, env templates
```


**Customer features:**
- Browse menu by category with photos, descriptions, modifiers, and live availability (hide/grey out items out of stock).
- Order types: **delivery, pickup/takeaway, dine-in QR** (scan a table QR to order from the seat).
- Cart with modifiers and special instructions; order scheduling (order for later).
- Accounts + guest checkout; saved addresses; order history and reorder.
- Loyalty: sign-in shows points, redeem at checkout (ties into existing loyalty logic).
- Online payment via **PayHere** (card / eZ Cash / mCash / bank) plus cash-on-delivery/pay-at-counter.
- Live order tracking (received → preparing → ready/out for delivery) using the same real-time layer as KDS.
- Promo codes, ratings/feedback after the order.

**How it connects to the POS:**
- Online orders drop straight into the KDS and order list, tagged as `online` with their channel (web/QR/delivery).
- Staff accept/reject with a prep-time estimate; status pushes back to the customer in real time.
- Inventory decrements through the same server-authoritative path, so online and in-house orders can't oversell.
- (Later) native integrations with UberEats / PickMe Food / Uber-style aggregators — the 2026 norm is for the POS to consolidate third-party delivery orders into one screen.

**Management/maintenance side (for the restaurant owner):**
- Toggle online store open/closed, set delivery zones/fees and minimum order, set prep times, 86 (mark unavailable) items instantly, and schedule menu availability (breakfast/lunch/dinner). This is part of the admin app, not a separate build.

---

## 7. SaaS / multi-tenant architecture (your stated goal: build to sell)

To sell GastroFlow to other restaurants, re-architect around **tenants**.

**Tenancy model.** Recommended start: **shared database, shared schema, `tenant_id` on every row**, enforced by row-level security and a mandatory tenant filter in the data layer. It's the cheapest to operate and easiest to maintain; you can graduate heavy tenants to their own schema/DB later. Every query, every API call, and every real-time channel must be tenant-scoped — cross-tenant leakage is the cardinal SaaS sin.

**Platform building blocks to add:**
- **Onboarding & tenant provisioning:** sign-up, restaurant profile, subscription/plan selection, trial.
- **Billing for the SaaS itself:** subscription tiers (e.g. Starter/Pro/Chain), usage limits, Stripe/PayHere subscriptions, invoices, dunning.
- **Super-admin console:** you (the vendor) manage tenants, plans, feature flags, and support.
- **Per-tenant configuration:** currency, tax rules, branding/logo on receipts, locale/language, feature toggles by plan.
- **Multi-location within a tenant:** central menu with per-branch overrides, consolidated and per-branch reporting, staff scoped to locations (Lightspeed-style multi-location reporting is a key differentiator to match).
- **Data isolation & compliance:** per-tenant backups, export, and deletion; PCI-conscious handling (never store raw card data — delegate to PayHere/Stripe); a privacy/retention policy for customer PII.

**Recommended target stack:**
- **DB:** PostgreSQL (managed — e.g. RDS/Supabase/Neon), with a migration tool (Prisma/Drizzle/Knex).
- **API:** keep Node/Express (or move to NestJS for structure) + TypeScript + Zod validation + Socket.IO.
- **Auth:** JWT/refresh tokens or a managed auth provider; RBAC + tenant claims.
- **Front ends:** existing React app (POS/admin) + new customer PWA; consider a shared component/design system.
- **Infra:** containerized (Docker), a background job queue (BullMQ) for emails/receipts/reports, object storage for menu images, and observability (structured logs + error tracking like Sentry).

---

## 8. Feature checklist — what to include

**Must-have (P0/P1)**
- User accounts, roles, POS PINs, audit log
- Server-authoritative billing + validation
- Split bills, service charge, multi-tax, tips, refunds/voids
- PayHere payment integration (in-store + online)
- Real-time KDS / floor / order sync
- Thermal receipt + KOT printing + cash drawer
- Shift management, cash-up, X/Z reports, EOD summary
- PostgreSQL + multi-tenant isolation
- Customer online ordering PWA (delivery / pickup / dine-in QR)
- Menu with photos, modifiers, availability/86, item profitability reporting

**Should-have (P2)**
- Offline/hybrid mode with sync
- Table reservations & waitlist
- Staff scheduling / basic timeclock
- Advanced analytics (sales by day-part, item mix, labor %, forecasting)
- Kitchen ticket routing to multiple stations
- Multi-location central management
- Loyalty tiers, gift cards, house accounts
- Email/SMS receipts and marketing

**Could-have (P3)**
- Third-party delivery aggregator integrations (UberEats/PickMe Food/DoorDash-style)
- Accounting integrations (QuickBooks/Xero)
- AI-assisted demand forecasting & auto-reorder for inventory
- Native mobile apps for staff and customers

---

## 9. Phased roadmap

Indicative sizing for a small team; treat as sequence, not fixed calendar.

**Phase 0 — Security & integrity hardening (release blockers).** Auth + roles + PINs; protect/secure all endpoints; server-side billing recompute; input validation; lock CORS; `.env`/helmet/rate limiting; wrap order+stock in transactions; add audit log. *Do this before anyone runs it on real money.*

**Phase 1 — Pro billing & real hardware.** Split bills, service charge, multi-tax, tips, refunds/voids; PayHere integration (in-store); thermal receipt + KOT printing + cash drawer; shift management, cash-up, X/Z, EOD reports; normalize `order_items`, add indexes/FKs.

**Phase 2 — Real-time & data platform.** Socket.IO for KDS/floor/orders; migrate SQLite → PostgreSQL with migrations; introduce TypeScript, tests, CI, error boundaries, logging/monitoring.

**Phase 3 — Multi-tenant SaaS core.** `tenant_id` isolation + RLS; onboarding/provisioning; SaaS subscription billing; super-admin console; per-tenant config/branding; per-tenant backup/export.

**Phase 4 — Customer online ordering app.** Menu PWA (delivery/pickup/QR dine-in); online PayHere checkout; live order tracking into KDS; online store controls (open/close, 86, delivery zones, prep times); loyalty in checkout.

**Phase 5 — Scale & differentiate.** Offline/hybrid mode; multi-location central management; reservations/waitlist; advanced analytics; loyalty tiers/gift cards; delivery-aggregator and accounting integrations.

---

## 10. Market positioning (why these choices)

The 2026 restaurant-POS market is led by **Toast** (~140k locations; restaurant-specific, strong online ordering + inventory + payroll), **Square for Restaurants** (cheap/simple, fast to start), and **Lightspeed** (advanced multi-location reporting and inventory). The consistent themes across all three — and therefore table stakes for a new entrant — are: **cloud + hybrid-offline architecture, native online ordering, real-time kitchen/ops, deep reporting, and multi-location support.** GastroFlow's realistic wedge is the **Sri Lankan / regional market**: native **LKR billing**, **PayHere** payments, local tax/service-charge rules, and pricing below the US incumbents. Build the fundamentals above, lead with local fit, and expand outward.

---

## 11. Risks & compliance

- **Cash & tax accountability:** without the audit log, shift cash-up, and server-authoritative totals, you cannot stand behind the numbers — fix in Phases 0–1.
- **Payments/PCI:** never store raw card data; delegate to PayHere/Stripe; verify payment via server callback only.
- **Customer PII:** you already collect names, phones, emails — add access control, encryption in transit, per-tenant data export/delete, and a retention policy before onboarding real customers.
- **Multi-tenant isolation:** a single missing `tenant_id` filter can leak one restaurant's data to another — enforce at the data layer, not per-query, and test it.

---

## 12. Recommended immediate next steps

1. **Freeze new features** until Phase 0 (auth + billing integrity + endpoint lockdown) is done.
2. Decide the **tenancy + hosting** target now (PostgreSQL + shared-schema `tenant_id`) so Phase 1 work is built the right shape.
3. Stand up a **PayHere sandbox** account and prototype the in-store payment + callback flow.
4. Introduce **migrations, TypeScript, and a test harness** early — retrofitting later is far more expensive.
5. Build the **customer ordering PWA against the same backend** once the tenant-scoped public API exists (Phase 4).

---

### Sources
- [Best POS Systems for Restaurants 2026 — Toast vs Square vs Lightspeed (RestroScout)](https://restroscout.com/best-restaurant-pos-systems)
- [Best POS Systems for Restaurants in 2026 (Otter)](https://www.tryotter.com/blog/restaurant-tips/best-pos-systems-for-restaurants)
- [Best POS Systems for Restaurants 2026: Feature & Price Comparison (Hustler's Library)](https://hustlerslibrary.com/best-pos-systems-for-restaurants-2026-full-feature-and-price-comparison/)
- [PayHere — Sri Lanka's No.1 Online Payment Gateway](https://www.payhere.lk/)
- [PayHere Checkout API — Knowledge Base](https://support.payhere.lk/api-&-mobile-sdk/checkout-api)
- [PayHere JavaScript SDK — Knowledge Base](https://support.payhere.lk/api-&-mobile-sdk/javascript-sdk)
- [Top 5 Payment Gateways for Sri Lankan Websites (2026)](https://sitechra.com/blog/payment-gateways-sri-lanka-2026)
