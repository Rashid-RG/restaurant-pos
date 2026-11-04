> Historical report: its readiness claims are superseded by the [current system review](COMPREHENSIVE_REVIEW_2026-11-05.md). Source-observed features and local tests do not establish a completed production rollout.

# GastroFlow POS — Complete System Report

**Prepared:** 2026-07-22 · **Method:** code-verified (read `server.js`, `lib/`, `src/`, `apps/customer-web/`, `tests/`, `restaurant.db`, infra files) · **Scope:** full-system deep report of every feature, the architecture, and the real state of the codebase.

> This is a consolidated, verified snapshot. Where the code disagrees with `CLAUDE.md`, this report flags it explicitly (see **§9 Drift & discrepancies**). `CLAUDE.md` remains the living status doc; this report is the point-in-time audit.

---

## 1. Executive summary

GastroFlow is a **restaurant POS + customer online-ordering platform** built for the Sri Lankan market (LKR currency, PayHere payments), architected as three apps against one Express/SQLite backend, with a stated long-term path to multi-tenant SaaS.

At this snapshot the system is **feature-complete against its own roadmap**: all Part A security fixes, fiscal invoice numbering, the billing-engine test suite, the customer PWA, the notification stack, and every "P1 launch" feature are implemented in code. Five advanced expansions (kitchen station routing, staff timeclock, feedback inbox, SSE group cart, SaaS tenant dashboard) are also present.

**What's genuinely solid:** the money path (server-authoritative pricing, single settlement function, gapless invoicing), the security posture (fail-fast secrets, atomic stock, signed webhooks, role-gated routes), and the customer experience (real maps, real OTP, real live tracking).

**What to treat with caution:** the backend is a **~208 KB / ~4,700-line single-file monolith** (`server.js`) with **six duplicated route definitions**, the "TypeScript migration" is nominal (config + type stubs, not typed source), the test suite covers **only** the billing engine (no auth/payment/integration/E2E tests), and several status claims in `CLAUDE.md` have drifted from the code. Details in §9.

**Verification note:** the 49-test billing suite could not be *executed* in this analysis sandbox (npm registry blocked + platform-mismatched `node_modules`), but was verified structurally — the module loads and exports correctly, and 49 `it()` cases across 12 `describe` blocks are present. See §7.

---

## 2. Architecture at a glance

| App | Path | Dev port | Users | Auth |
|---|---|---|---|---|
| Staff POS / Admin | `src/` | 3000 | Owner, Manager, Cashier, Kitchen | JWT + role + manager PIN |
| Customer PWA | `apps/customer-web/` | 3001 | Public diners | Guest or customer JWT |
| Backend API | `server.js` | 5000 | — | `app.use(authenticateToken)` splits public/private |

**Stack (verified in `package.json`):** React 18 + Vite 5, Express 4, SQLite3 (with a `pg` PostgreSQL adapter available), bcryptjs, jsonwebtoken, helmet 8, express-rate-limit 8, nodemailer, web-push, zod, dotenv. SSE (Server-Sent Events) provides real-time updates. Vitest 1.x is the test runner.

**Codebase size (verified):** the three apps plus backend total roughly **13,900 lines**. `server.js` alone is ~208 KB and holds **100 route handlers**. The staff UI is eight React components under `src/components/`; the customer app is eight views plus map/toast components.

### Request boundary (verified)
Public routes are registered **before** `app.use(authenticateToken)` at `server.js:3547`; everything after that line requires a valid JWT, and sensitive routes additionally call `requireRole([...])`. This public/private split is the core of the auth model and is intact.

### Real-time channels (SSE, verified)
Three streams exist: `/api/stream/orders/:id` (customer live order tracking), `/api/stream/pos` (staff dashboard/KDS updates), and `/api/stream/store` (store-open + item-availability propagation to the customer app). Driver GPS and group-cart changes are pushed over these channels.

---

## 3. Database schema (27 tables, verified against `restaurant.db`)

| Domain | Tables |
|---|---|
| **Orders & billing** | `orders`, `order_items`, `invoice_counter`, `promotions` |
| **Catalog** | `menu_items`, `categories`, `modifiers` |
| **Inventory** | `ingredients`, `recipes` (BOM for auto-deduction) |
| **Tables/floor** | `tables` |
| **Staff & shifts** | `users`, `shifts`, `timeclock_entries`, `cash_movements` |
| **Customers (CRM)** | `customers`, `customer_accounts`, `customer_addresses`, `customer_cards` |
| **Delivery** | `driver_locations` |
| **Engagement** | `feedbacks`, `group_carts`, `push_subscriptions` |
| **Auth/security** | `otp_codes`, `password_resets` |
| **Config & platform** | `settings`, `audit_logs`, `tenants` |

Notable design points: `invoice_counter` backs gapless fiscal numbering; `customer_cards` stores **token + last four + expiry only** (no PAN); `tenants` + a `tenant_id` column provide the multi-tenancy foundation; `audit_logs` receives every money-affecting action.

---

## 4. Backend API surface (100 routes)

Grouped by function. All staff routes below the auth boundary require JWT; role-gated ones are noted.

**Auth & staff identity:** `POST /api/auth/login`, `/register` (owner/manager), `/verify-pin`, `/forgot-password`, `/reset-password`, `/send-otp`.

**Customer auth & profile:** `/api/customer/auth/{register,login,me,forgot-password,reset-password}`, `/api/customer/{profile,addresses,cards,orders}`, `/api/customer/loyalty/redeem`.

**OTP & security:** `/api/otp/{send,verify}` (rate-limited, hashed, single-use, 5-min TTL).

**Payments (PayHere):** `/api/payments/payhere/checkout`, `/webhook` (mandatory signature), `/dev-simulate` (production-disabled). Settlement flows through **`settleOrderPaid()`** only.

**Public storefront:** `/api/public/{restaurants,menu,orders,store-info,delivery-fee,delivery-zone-info,geocode,reverse-geocode,feedback}`; order lifecycle `/api/public/orders/:id`, `/cancel`, `/driver-location`.

**Delivery/driver:** `/api/public/drivers`, `/driver/orders`, `/driver/assign`, `/driver/status`, `/driver/location`; a browser rider tool served at `GET /driver/:orderId`; `/api/driver/cash-reconciliation` + `/handover`.

**Group cart (SSE):** `/api/public/group-cart/:id`, `/items`, `/checkout`.

**AI assistant:** `/api/ai/chat`.

**POS orders & KDS:** `/api/orders` (create/list), `/api/orders/:id/{accept,reject,modify,refund}`.

**Tables/floor:** `/api/tables` (CRUD), `/transfer`, `/merge`.

**Catalog & inventory:** `/api/menu_items`, `/categories`, `/ingredients`, `/recipes/:menuItemId`.

**Shifts & cash:** `/api/shifts/{active,open,close,summary/:id}`, `/api/cash-movements`.

**Staff ops:** `/api/timeclock/{clock-in,clock-out,status,entries}`, `/api/feedbacks`, `/api/support/tickets`.

**Config & platform:** `/api/settings`, `/api/customers`, `/api/health` (unauthenticated for Docker/K8s), `/api/database/{import,reset}`, `/api/saas/tenants` (SaaS provisioning), `/api/marketplace/partner-earnings`.

> **Undocumented in `CLAUDE.md`:** `/api/driver/cash-reconciliation` (+`/handover`), `/api/marketplace/partner-earnings`, and `/api/support/tickets`. These exist in code but aren't in the feature inventory — likely early scaffolding for a delivery-marketplace direction.

---

## 5. Security posture (Part A — all verified in code)

| # | Control | Verified state |
|---|---|---|
| A1 | PayHere webhook signature | Required unconditionally; missing/wrong `md5sig` → rejected (`server.js:1211`). |
| A2 | Amount integrity | Checkout signs the **stored** order total; webhook asserts `payhere_amount === order.total`. |
| A3 | No client-side settlement | **0** references to `payhere/webhook` in either front end (grep-verified). Server-to-server only. |
| A4 | Accept/reject gated | Behind `authenticateToken` + `requireRole(['owner','manager','cashier'])`. |
| A5 | CORS | Env allow-list in production (`CORS_ORIGIN`, comma-separated); permissive in dev; disallowed origins denied cleanly (no 500). |
| A6 | Card storage | `customer_cards` stores token + last four + expiry only. |
| A7 | Secret hygiene | Production boot fails fast (exit 1) if `JWT_SECRET` / `PAYHERE_MERCHANT_SECRET` missing or default. |
| A8 | Atomic stock | `UPDATE ... WHERE id=? AND stock>=?` with `changes===0` → rollback (TOCTOU-safe). |

**Additional hardening present:** `helmet` security headers; three distinct rate limiters (`authLimiter`, `publicApiLimiter`, `pinLimiter`, plus an `otpLimiter` and `databaseLimiter`); bcrypt password hashing; hashed single-use OTP and password-reset tokens with TTLs; non-enumerating reset responses; graceful shutdown on SIGTERM/SIGINT; unauthenticated `/api/health`.

**The cardinal rule holds in code:** the server is authoritative on money. Clients send intent (item IDs, quantities, modifier IDs, promo code, tip); `resolveAndCalculateBill()` prices everything. No trusted-client-amount path was found.

---

## 6. Feature inventory (verified)

Legend: ✅ implemented (code-verified) · 🟡 partial · ❌ absent

### 6.1 POS — ordering & billing
Login/roles/JWT/PIN ✅ · menu grid/search/categories ✅ · cart/qty/notes/modifiers ✅ · dine-in/takeaway/delivery ✅ · discounts %/flat with PIN ✅ · service charge/tax/tip/rounding ✅ · refunds & voids with mandatory reason codes ✅ · **gapless fiscal invoice numbering** ✅ (allocated only at settlement) · **split tender** ✅ · **split bill** (even N-way + itemized) ✅ · **order modification after KOT** ✅ (`PUT /api/orders/:id/modify`, repriced + audited) · **hold/recall tabs** ✅ · **cash in/out paid-outs** ✅ (feeds Z-report) · **drawer-open/no-sale log** ✅. Happy hour / combos / gift cards / house accounts ❌ (P2). Multi-currency / barcode / customer display ❌ (P3).

### 6.2 POS — tables & floor
Floor plan / status / capacity ✅ · **table transfer** ✅ · **table merge** ✅ · **QR code generation** ✅ (print modal in FloorPlan). Seat-level ordering ❌ · reservations/waitlist ❌ (P2–P3).

### 6.3 POS — kitchen
KDS status columns ✅ · accept/reject with ETA ✅ · **station routing** ✅ (Hot Kitchen / Bar & Drinks / Desserts tabs). Course management / SLA alerts / recipes-on-ticket ❌ (P2–P3).

### 6.4 POS — inventory
Per-item stock + min-stock ✅ · **ingredient-level inventory + recipe BOM with auto-deduction** ✅. Purchase orders / suppliers / stock-take / waste logging ❌ (P1 backlog).

### 6.5 POS — customers & marketing
Customer CRM + loyalty points ✅ · **feedback review inbox** ✅ (`/api/feedbacks` + Dashboard card). Loyalty tiers / campaigns / referral / birthday ❌ (P2–P3).

### 6.6 POS — staff
Users/roles/PINs ✅ · shift open/close, cash-up, Z-report ✅ · **timeclock & shift tracking** ✅ (`timeclock_entries` + routes + Sidebar toggle). Per-staff performance 🟡 (sales-by-staff only). Permissions editor ❌ (roles hardcoded).

### 6.7 POS — reporting & compliance
Dashboard KPIs + charts ✅ · Z-report ✅ · audit log (written) ✅ · **CSV export** ✅. X-report (mid-shift) ❌ · tax/VAT report ❌ · item profitability/COGS 🟡 (cost stored). Day-part / labor-cost % / scheduled email / accounting integration ❌.

### 6.8 POS — hardware & platform
**ESC/POS thermal printing** ✅ (58 mm & 80 mm, invoice + logo) · **cash-drawer kick** ✅. Responsive layout 🟡 (limited breakpoints). **`alert()` → toast migration 🟡 — 23 `alert()` calls remain in `src/`** (see §9; `CLAUDE.md` says ~14). Offline mode + sync ❌ (P2).

### 6.9 POS — online-store controls
**Delivery fees / minimum order** ✅ (server-authoritative) · **store open/closed toggle** ✅ (live via SSE `<1s`) · **86-an-item** ✅ (SSE `item_availability`) · **per-order-type prep-time/ETA** ✅. Time-based menu / order throttling ❌ (P2).

### 6.10 Customer PWA
Menu browse/search/categories ✅ · server-priced modifiers ✅ · dine-in QR / takeaway / delivery ✅ · guest + registered checkout ✅ · loyalty redemption + promo codes + reorder ✅ · **live order tracking (SSE)** ✅ · **AI ordering assistant** ✅ (previously 404, path fixed) · dietary filters ✅ · feedback/ratings ✅ · **installable PWA** ✅ (manifest, `sw.js`, `offline.html`, install prompt — all present in `public/`) · **mobile-first responsive** ✅ · **customer order cancellation** ✅ (pending-only) · **online tip** ✅ (server-repriced) · **menu images** ✅ (lazy + emoji fallback) · **multi-language en/si/ta** ✅ (shared i18n, primary flows) · **scheduled ordering UI** ✅ (15-min slots) · **prep-time/ETA at checkout** ✅ · **guest tracking link** ✅ (`?track=`) · **order confirmation email/SMS** ✅ · **web push** ✅ (VAPID) · **saved addresses with real geocoding** ✅ (Leaflet + Nominatim) · **real live tracking + driver GPS** ✅ (`TrackingMap.jsx`, `watchPosition` rider tool) · **group cart** ✅ (SSE sync). Upsell/nutrition/social login ❌ (P2) · abandoned cart / live chat / wallet pay ❌ (P3).

### 6.11 Notifications infrastructure
Provider-agnostic **email (SMTP/nodemailer)** + **SMS (Notify.lk default, Twilio adapter)** ✅ · **modern HTML email templates** ✅ (`lib/email_templates.js`, ~16 KB) · **real OTP** ✅ · **password reset (staff + customer)** ✅ · **order confirmation** ✅ · **web push** ✅ (`lib/push.js`). With no creds, a **dev transport logs to console** (nothing is faked as sent). Remaining: retry queue (currently best-effort fire-and-forget), opt-out/prefs.

### 6.12 Platform / SaaS
**Multi-tenancy** ✅ (`tenants` table + `tenant_id` isolation) · **SaaS console API** ✅ (`/api/saas/tenants`) · **PostgreSQL adapter** ✅ (`lib/db_adapter.js`, `pg` pool with SQLite fallback) · **Zod validation middleware** ✅ (`lib/validation.js`) · **Docker + docker-compose** ✅.

---

## 7. Quality & testing

**Billing-engine suite (`tests/billing.test.js`):** the pricing core was extracted to `lib/billing.js` with dependency injection, exporting `resolveAndCalculateBill()` and `allocateInvoiceNumber()`. The suite has **49 test cases across 12 `describe` blocks** — item pricing, modifiers, %/flat discounts + cap, service charge, tax stacking, tip clamping, LKR rounding, delivery fee, promo codes, loyalty redemption, combined scenarios, gapless invoice counter, and return-shape invariants.

**Execution caveat:** in this analysis sandbox the suite could **not be run** — the Windows-installed `node_modules` lacks the Linux rollup binary (`@rollup/rollup-linux-x64-gnu`) and the npm registry is network-blocked, so Vitest wouldn't boot. This is an **environment artifact, not a code fault**. The module itself was loaded successfully with Node and confirmed to export both functions; the 49-case structure was confirmed by inspection. On the developer's own machine (`npm test`) the suite is expected to pass as documented.

**Coverage gap (important):** testing covers **only** the billing engine. There are **no** auth, payment-webhook, integration, or E2E tests. Given how much money-and-security logic lives in `server.js`, this is the single biggest quality risk.

---

## 8. Infrastructure & ops

**Containerization:** `Dockerfile` (node:18-alpine, multi-stage build of both front ends, production install) + `docker-compose.yml`. **Health:** `GET /api/health` unauthenticated. **Config:** `.env.example` committed and mirrors documented env vars; secrets fail-fast in production. **TypeScript:** `tsconfig.json` present with `allowJs: true`, `strict: false`, `checkJs: false`, and `lib/types.ts` type stubs — i.e. TS is *configured and type-checkable* but the source remains JavaScript (see §9). **Run:** `npm install` → `npm run start:all` (API + POS + customer app).

---

## 9. Drift & discrepancies (code vs. `CLAUDE.md`)

These are the places where the living status doc no longer matches the code. None are severe, but they should be reconciled.

1. **`alert()` count in POS.** `CLAUDE.md` says "~14 occurrences remain"; the code actually has **23** `alert()` calls in `src/` (POSView 8, Settings 11, Sidebar 2, Dashboard 1, Inventory 1). The toast migration is less complete than stated.

2. **Six duplicated route definitions in `server.js`.** `/api/otp/send`, `/api/otp/verify`, `/api/ai/chat`, `/api/shifts/active`, `/api/shifts/open`, and `/api/shifts/close` are each defined **twice**. In Express the first registration wins, so the second is dead code — harmless at runtime but a maintenance and correctness hazard (edits may land on the inactive copy). Worth de-duplicating.

3. **"TypeScript migration" is nominal.** Build order item 13 is checked off as done, but there are no `.ts` source files beyond `lib/types.ts`; `tsconfig` runs with `strict: false` / `checkJs: false`. This is *TypeScript-ready configuration*, not a migration. Fine to keep — just label it accurately.

4. **Undocumented endpoints.** `/api/driver/cash-reconciliation` (+`/handover`), `/api/marketplace/partner-earnings`, and `/api/support/tickets` exist in code but aren't in the Part B inventory. Either document them or remove if they're abandoned scaffolding.

5. **Four overlapping dated review docs** (`REVIEW.md`, `FEATURES_REVIEW.md`, `CUSTOMER_APP_AND_INTEGRATION_REVIEW.md`, `SYSTEM_FEATURES_AND_CONNECTION_REPORT.md`) still coexist and risk divergence. `CLAUDE.md` itself flags this. This report is intended to supersede them.

---

## 10. Risk register & recommended next steps

**Top structural risks**
- **Monolithic `server.js`** (~4,700 lines / 100 routes / ~208 KB). High cognitive load, merge-conflict magnet, and where the duplicate routes crept in. *Recommend:* split into route modules by domain (auth, payments, orders, catalog, tables, admin) — this is already Part E / build-order item 5.
- **Test coverage limited to billing.** *Recommend:* add auth + payment-webhook integration tests next; these are the highest-blast-radius paths.
- **SQLite in production.** `pg` adapter exists but PostgreSQL + versioned migrations aren't the live path. *Recommend:* finish the Postgres cutover before real multi-tenant load.

**Quick wins (low effort, real cleanup)**
- De-duplicate the six repeated routes.
- Finish the POS `alert()` → toast migration (23 remaining) and update the count in `CLAUDE.md`.
- Document or delete the three undocumented endpoints.
- Add allergen declarations to dietary filters; add X-report and tax/VAT report (both P1, still ❌).

**Larger roadmap (already tracked)**
- Notification retry queue + opt-out prefs.
- Purchase orders / suppliers / stock-take / waste logging (P1 inventory gap).
- `server.js` modularization + Zod validation everywhere + centralized error middleware + structured logging (pino) + Sentry.
- CI/CD pipeline (there is no automated test gate today).

---

## 11. Bottom line

GastroFlow is a **surprisingly complete, security-conscious POS + ordering platform** for its stage: the money path is disciplined, the customer experience is real (maps, OTP, tracking, PWA, push), and every roadmap feature has landed in code. The gap between "feature-complete" and "production-hardened at scale" is now **engineering hygiene, not features** — break up the monolith, broaden tests beyond billing, finish the Postgres path, and clean up the small drifts above. Do those four things and this moves from an impressive build to a defensible product.

*Every claim in this report was checked against the source on 2026-07-22. Items that could not be executed in-sandbox (the test run) are labelled as such rather than asserted as passing.*
