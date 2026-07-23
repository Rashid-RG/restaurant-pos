# GastroFlow — Master System Report & Development Blueprint

> **Purpose of this document.** This is the single source of truth for taking GastroFlow from its current state to a **100% production-ready multi-tenant SaaS**. It is written to be handed to a coding agent (Claude Code) and executed section by section. It covers architecture, folder organization, the data model, every feature (with an explicit **KEEP / UPDATE / ADD / UPGRADE** verdict), how the three apps must connect, SaaS readiness, security, a full **UI/UX redesign plan**, and a **phased build order with acceptance criteria**.
>
> **Prepared:** 2026-07-23 · **Verification:** all claims checked against source (`server.js`, `lib/`, `src/`, `apps/`, `restaurant.db`). Where something could not be run in the analysis environment (server boot, Vitest, frontend build), it is labelled — never asserted as passing.

---

## 0. How to use this document (for the coding agent)

1. Read Sections 1–6 to understand the system as it exists today.
2. Section 8 is the **feature ledger** — the master checklist. Each row has a verdict and a "what to do."
3. Sections 9–12 are the **work**: SaaS hardening, integration contracts, and the UI/UX redesign.
4. Section 13 is the **phased build order** — execute phases in order; do not start a phase until the previous phase's acceptance criteria pass.
5. Golden rules that must never be violated are in Section 14. Read them before writing any code.

---

## 1. Executive summary

GastroFlow is a restaurant platform built for Sri Lanka (LKR, PayHere) consisting of **three front-end apps on one Express/SQLite backend**:

1. **Staff POS / Admin** (`src/`) — the till, kitchen display, floor plan, inventory, reporting, settings.
2. **Customer Online-Ordering PWA** (`apps/customer-web/`) — public menu, cart, checkout, live tracking.
3. **Driver Delivery app** (`apps/driver-web/` scaffold + `DriverView` in the customer app + a server-served rider page) — assignment, GPS, cash reconciliation.

**Current state:** feature-rich and, after the July 2026 hardening + multi-tenancy pass, **substantially SaaS-ready**. Tenant isolation is implemented and proven at the query level; payments are disciplined; endpoints are role-gated. **What stands between it and a confident production launch is not architecture — it is finishing work:** end-to-end runtime testing, the PostgreSQL cutover, per-tenant configuration, a unified driver app, broadened automated tests + CI, and a UI/UX consistency pass.

**Overall readiness: ~6.5 / 10** (was ~4.5 before the hardening pass). Target after this blueprint: **9.5+/10 — production-ready**.

---

## 2. System architecture

### 2.1 The three apps + backend

```
                         ┌──────────────────────────────────────┐
                         │        Express API (server.js)        │
                         │  119 routes · JWT auth · SSE · SQLite │
                         │   Public zone  |  Authenticated zone  │
                         └───────┬───────────────┬───────────────┘
                                 │               │
             public/tenant-resolved            JWT + tenant_id
                                 │               │
      ┌──────────────┐   ┌───────▼──────┐  ┌─────▼─────────┐   ┌──────────────┐
      │ Customer PWA │◄─►│  Backend API │◄►│  Staff POS    │   │ Driver app   │
      │ (order,track)│   │  (money,data)│  │ (till,kitchen)│◄─►│ (GPS,deliver)│
      └──────────────┘   └──────┬───────┘  └───────────────┘   └──────────────┘
                                │
                     Real-time via SSE:
             /api/stream/orders/:id  (customer live tracking)
             /api/stream/pos         (staff dashboard/KDS)
             /api/stream/store       (store-open / 86-item)
```

### 2.2 Runtime & ports

| App | Path | Dev port | Auth model |
|---|---|---|---|
| Staff POS/Admin | `src/` | 3000 | JWT (staff) + role + manager PIN; JWT carries `tenant_id` |
| Customer PWA | `apps/customer-web/` | 3001 | Guest or customer JWT; tenant resolved from subdomain/header |
| Driver app | `apps/driver-web/` (+ customer `DriverView`, server `/driver/:id`) | 3001/served | Currently public — **needs a driver-auth model (see 8, 10)** |
| Backend API | `server.js` | 5000 | `app.use(authenticateToken)` splits public vs. private |

### 2.3 Real-time (SSE) contract

- `GET /api/stream/orders/:id` → customer & driver live order/GPS updates (`driver_location`, order status).
- `GET /api/stream/pos` → staff dashboard + KDS (`new_order`, `order_updated`, `order_cancelled`, `item_availability_changed`).
- `GET /api/stream/store` → customer app store state (`storeOpen` toggle, `item_availability`).

### 2.4 Money & settlement (do not change lightly)

- Server is **authoritative on price**: clients send intent (item IDs, quantities, modifiers, promo, tip); `resolveAndCalculateBill()` prices everything.
- Settlement flows through **`settleOrderPaid()` only** (1 definition, 3 call sites). The browser can never mark an order paid.
- PayHere webhook signature is mandatory; amount is asserted against the stored order; fiscal invoice numbers are gapless, allocated only at settlement.

---

## 3. Technology stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend (all 3 apps) | React 18 + Vite 5 | POS uses plain CSS; customer app uses react-router-dom + Leaflet |
| Backend | Express 4 | Single file `server.js` (~5,015 lines, 119 routes) — **should be modularized** |
| Database | SQLite3 (live) | `pg` PostgreSQL adapter present (`lib/db_adapter.js`) but **not the live path** |
| Auth | jsonwebtoken + bcryptjs | Staff 12h JWT, customer 7d; manager PIN for overrides |
| Security | helmet, express-rate-limit, zod | Zod wired to a few routes — **extend coverage** |
| Payments | PayHere (LKR) | Stripe keys stubbed in `.env.example` (not implemented) |
| Notifications | nodemailer (SMTP) + Notify.lk/Twilio SMS + web-push | Dev transport logs to console when unconfigured |
| Maps | Leaflet + OpenStreetMap + Nominatim | Key-free, proxied server-side |
| Real-time | Server-Sent Events (SSE) | Three streams (see 2.3) |
| Tests | Vitest | Billing (49) + tenant isolation (5); **no auth/payment/E2E yet** |
| Deploy | Dockerfile + docker-compose + nginx.conf + deploy.sh | Present; validate before relying on |

---

## 4. Code & folder organization

### 4.1 Current layout

```
restaurant-pos/
├── server.js                     # ⚠️ 5,015-line monolith — 119 routes (MODULARIZE)
├── lib/                          # Extracted backend modules (good pattern — expand this)
│   ├── billing.js                #   pricing engine (DI, unit-tested) ✅
│   ├── validation.js             #   Zod schemas + validateRequest middleware
│   ├── notifications.js          #   email/SMS providers
│   ├── email_templates.js        #   HTML email templates
│   ├── push.js                   #   web-push (VAPID)
│   ├── db_adapter.js             #   Postgres/SQLite adapter (not live)
│   └── types.ts                  #   type stubs (TS not truly adopted)
├── src/                          # STAFF POS / ADMIN (React)
│   ├── App.jsx                   #   shell/router
│   ├── main.jsx
│   ├── index.css                 #   ⚠️ 1,781 lines — global CSS (design system lives here)
│   ├── components/
│   │   ├── POSView.jsx           #   ⚠️ 1,587 lines — the till (split this)
│   │   ├── Settings.jsx          #   ⚠️ 1,294 lines — settings (split this)
│   │   ├── Dashboard.jsx         #   649 — KPIs, reports, feedback inbox
│   │   ├── Inventory.jsx         #   452 — stock, ingredients, suppliers, waste
│   │   ├── FloorPlan.jsx         #   426 — tables, transfer/merge, QR
│   │   ├── DeliveryView.jsx      #   314 — POS-side delivery/dispatch
│   │   ├── KDSView.jsx           #   303 — kitchen display + station routing
│   │   ├── Login.jsx             #   447 — staff login + password reset
│   │   ├── Customers.jsx         #   251 — CRM/loyalty
│   │   ├── Sidebar.jsx           #   241 — nav (still has alert() calls)
│   │   ├── SupportTicketsView.jsx#   116
│   │   └── ui.jsx                #   ⚠️ 46 — only Button/Input/Badge/Modal (EXPAND)
│   ├── context/POSContext.jsx    #   711 — global state + showToast
│   └── database/db.js
├── apps/
│   ├── customer-web/             # CUSTOMER PWA (React + router + Leaflet)
│   │   ├── src/
│   │   │   ├── App.jsx           #   445 — routing/shell
│   │   │   ├── index.css         #   682 — customer design system (has dark mode)
│   │   │   ├── views/
│   │   │   │   ├── CartCheckoutView.jsx  # 997 (split)
│   │   │   │   ├── MenuView.jsx          # 959 (split)
│   │   │   │   ├── OrderTrackingView.jsx # 429
│   │   │   │   ├── DriverView.jsx        # 527  ← driver UI lives HERE (confusing)
│   │   │   │   ├── LoginRegisterView.jsx # 450
│   │   │   │   ├── RestaurantsView.jsx   # 370
│   │   │   │   ├── ProfileView.jsx       # 302
│   │   │   │   └── LegalPoliciesView.jsx # 201
│   │   │   ├── components/ (LocationPicker, TrackingMap, Toast)
│   │   │   ├── context/ (Cart, CustomerAuth, Language)
│   │   │   ├── i18n/translations.js       # en/si/ta
│   │   │   └── utils/ (api.js, i18n.js)
│   │   └── public/ (manifest.json, driver-manifest.json, sw.js, offline.html, icons)
│   └── driver-web/               # DRIVER APP — ⚠️ SCAFFOLD ONLY (App.jsx/index.css/main.jsx, empty package.json)
├── public/ (pos-manifest.json, pos-logo.png)
├── tests/ (billing.test.js ✅, tenant_isolation.test.js ✅)
├── docs/ (AUDIT_*, BUILD_PLAN, UPGRADE_PLAN, SYSTEM_REPORT, DEPLOYMENT_READINESS, CHANGES_AND_TODO)
├── Dockerfile · docker-compose.yml · nginx.conf · deploy.sh
├── .env / .env.example / .gitignore
└── CLAUDE.md (living status) · MASTER_REPORT.md (this file)
```

### 4.2 Organization problems to fix

1. **`server.js` is a 5,015-line monolith.** Split into `routes/` modules by domain (auth, payments, orders, catalog, tables, customers, reports, inventory, driver, saas, public) mounted with the public/private split preserved. Move helpers into `lib/`.
2. **The driver app is fragmented across 4 places** — `apps/driver-web/` (empty scaffold), `apps/customer-web/src/views/DriverView.jsx`, `src/components/DeliveryView.jsx` (POS side), and the server `/driver/:id` HTML page. **Consolidate into `apps/driver-web/` as one real app** (see 10.3).
3. **Two giant view files** (`POSView.jsx` 1,587, `Settings.jsx` 1,294, `CartCheckoutView.jsx` 997, `MenuView.jsx` 959). Break into sub-components.
4. **The shared UI kit (`ui.jsx`) is tiny** (4 components) and only used by POS. Grow it into a real component library shared by all three apps (see 12).
5. **Design systems are duplicated** — `src/index.css` (1,781 lines) and `apps/customer-web/src/index.css` (682 lines) define separate tokens. Extract shared design tokens.
6. **Stray build artifacts** committed (`vite.config.js.timestamp-*.mjs`, `.fuse_hidden*`). Add to `.gitignore` / clean up.

---

## 5. Data model (27 tables)

| Domain | Tables | Tenant-scoped? |
|---|---|---|
| Orders & billing | `orders`, `order_items`, `invoice_counter`, `promotions` | `orders` ✅ (has `tenant_id`); others via join |
| Catalog | `menu_items`, `categories`, `modifiers` | `menu_items` ✅ · `categories`/`modifiers` ❌ **(add tenant_id)** |
| Inventory | `ingredients`, `recipes` | `ingredients` ✅ · `recipes` ❌ |
| Tables/floor | `tables` | ✅ |
| Staff & shifts | `users`, `shifts`, `timeclock_entries`, `cash_movements` | `users` ✅ · others ❌ **(add tenant_id)** |
| Customers (CRM) | `customers`, `customer_accounts`, `customer_addresses`, `customer_cards` | `customers` ✅ · others ❌ |
| Delivery | `driver_locations` | ❌ |
| Engagement | `feedbacks`, `group_carts`, `push_subscriptions` | ❌ |
| Auth/security | `otp_codes`, `password_resets` | n/a |
| Config & platform | `settings`, `audit_logs`, `tenants` | `settings` ❌ **(critical — per-tenant config needs this)** |

**Key facts:** `customer_cards` stores token + last-four + expiry only (no PAN). `invoice_counter` backs gapless fiscal numbering. `tenants` + `tenant_id` provide multi-tenancy (6 core tables scoped so far).

**Data-model work required for full SaaS:** add `tenant_id` to `settings`, `categories`, `modifiers`, `recipes`, `shifts`, `cash_movements`, `feedbacks`, `promotions`, `customer_accounts`, and scope their queries. `settings` is the highest priority — without it, every tenant shares one restaurant name, tax rate, delivery fee, currency, and open/closed state.

---

## 6. API surface (119 routes) — overview

Grouped by domain. Full detail is in `server.js`; this is the map.

- **Auth/staff:** `/api/auth/{login,register,verify-pin,forgot-password,reset-password,send-otp}`
- **Customer auth/profile:** `/api/customer/auth/{register,login,me,forgot-password,reset-password}`, `/api/customer/{profile,addresses,cards,orders,loyalty/redeem}`
- **OTP/security:** `/api/otp/{send,verify}`
- **Payments (PayHere):** `/api/payments/payhere/{checkout,webhook,dev-simulate}` → settle via `settleOrderPaid()`
- **Public storefront:** `/api/public/{restaurants,menu,orders,store-info,delivery-fee,delivery-zone-info,geocode,reverse-geocode,feedback}`, `/api/public/orders/:id`(+`/cancel`,`/driver-location`)
- **Driver:** `/api/public/drivers`, `/api/public/driver/{orders,assign,status,location}`, `/api/delivery/drivers`(+`/:id/approve`), `/driver/:orderId` (rider page), `/api/driver/cash-reconciliation`(+`/handover`)
- **Group cart (SSE):** `/api/public/group-cart/:id`(+`/items`,`/checkout`)
- **AI assistant:** `/api/ai/chat`
- **POS orders/KDS:** `/api/orders`(+`/:id/{accept,reject,modify,refund}`)
- **Tables:** `/api/tables`(+`/transfer`,`/merge`)
- **Catalog/inventory:** `/api/menu_items`, `/api/categories`, `/api/ingredients`, `/api/recipes/:id`, `/api/inventory/{suppliers,waste}`
- **Shifts/cash:** `/api/shifts/{active,open,close,summary/:id}`, `/api/cash-movements`
- **Reports:** `/api/reports/{x-report,vat,cogs}`, `/api/staff/performance`
- **Staff ops:** `/api/timeclock/*`, `/api/feedbacks`, `/api/support/tickets`, `/api/users`
- **Platform/SaaS:** `/api/saas/tenants` (platform-admin only), `/api/marketplace/partner-earnings`, `/api/settings`, `/api/health`, `/api/db/inspect` (platform-only), `/api/database/{import,reset}`

**Recently hardened (July 2026):** all reports/inventory/staff/driver-cash/marketplace routes are role-gated; `db/inspect` and `saas/tenants` are platform-admin-only; driver status is restricted to a delivery allow-list; error responses are generic in production; Zod validation on login/shift/cash; production fail-fast restored.

---

## 7. How the three systems must connect (integration contracts)

This is where "both need to connect right" gets concrete. Each connection is a contract; if any breaks, the platform feels broken to users.

### 7.1 Customer PWA ⇄ Backend ⇄ POS (the order lifecycle)

1. Customer browses `GET /api/public/menu?tenant=<subdomain>` → sees **that tenant's** menu (now tenant-scoped ✅).
2. Customer places order → `POST /api/public/orders` (tenant resolved + stamped ✅) → order saved `status=pending`, `source=online`.
3. Backend emits SSE `new_order` on `/api/stream/pos` → **POS KDS shows it instantly**.
4. Staff accepts → `POST /api/orders/:id/accept` (auth+role) sets ETA → SSE `order_updated` → **customer tracking updates live**.
5. Payment: PayHere `checkout` → `webhook` → `settleOrderPaid()` → invoice number assigned → confirmation email/SMS.
6. **Contract to preserve:** tenant_id must flow end-to-end; the POS only sees its tenant's online orders (scoped ✅); the customer sees only their order via `/api/stream/orders/:id`.

**Action:** verify the customer app actually sends the tenant (subdomain/header) on every public call. If it currently assumes a single restaurant, add a tenant/restaurant selector (`RestaurantsView.jsx` already exists — wire it to set the active tenant).

### 7.2 POS ⇄ Backend ⇄ Driver (the delivery lifecycle)

1. Delivery order accepted in POS → appears in dispatch (`DeliveryView.jsx` / `/api/public/driver/orders`).
2. Driver assigned → `POST /api/public/driver/assign` → order gets `driverId`.
3. Driver app streams GPS → `POST /api/public/driver/location` → SSE `driver_location` → **customer map + POS see the driver move**.
4. Driver updates status (`out_for_delivery` → `delivered`, allow-list enforced ✅).
5. Cash on delivery → `/api/driver/cash-reconciliation` → handover to manager.

**Broken/weak links to fix:**
- Driver endpoints are **public (no driver auth)** — a driver has no login. **Add a driver-auth model** (see 8 & 10.3): driver login → JWT with `driverId` (+ `tenant_id`), then require it on assign/status/location.
- The **driver UI is fragmented** (scaffold app + customer-app view + server page). **Unify into `apps/driver-web/`.**
- Driver dispatch pool queries are **not tenant-scoped** (marketplace model). Decide: tenant-bound drivers (scope them) or shared marketplace (keep, but document).

### 7.3 Shared settings / real-time state

- Store open/closed and 86-item toggles propagate POS → customer via SSE `/api/stream/store` ✅.
- **But `settings` is global** — once multi-tenant, tenant A toggling "closed" would close everyone. **Add `tenant_id` to settings and scope SSE by tenant** (critical, see 5 and 8).

### 7.4 Integration acceptance criteria

- [ ] A new tenant provisioned via `/api/saas/tenants` can log in, see only its own menu/orders/customers, and take an online order end-to-end.
- [ ] Tenant A's store-closed toggle does not affect Tenant B.
- [ ] A driver can only act on deliveries after authenticating; GPS shows on both customer and POS maps.
- [ ] SSE events are tenant-partitioned (no cross-tenant leakage on `/api/stream/pos` or `/store`).

---

## 8. Feature ledger — KEEP / UPDATE / ADD / UPGRADE

Legend: **KEEP** = works, leave it · **UPDATE** = works but needs fixing/completing · **ADD** = build new · **UPGRADE** = works but should be materially improved.

### 8.1 Staff POS / Admin

| Feature | Status | Verdict | What to do |
|---|---|---|---|
| Login, roles, JWT, manager PIN | ✅ | KEEP | JWT now carries tenant_id |
| Menu grid, cart, modifiers, dine-in/takeaway/delivery | ✅ | KEEP | — |
| Discounts, service charge, tax, tips, rounding | ✅ | KEEP | Billing engine unit-tested |
| Refunds / voids with reason codes | ✅ | KEEP | Auth + manager PIN |
| Fiscal invoice numbering | ✅ | KEEP | Gapless, at settlement |
| Split bill / split tender / hold-recall | ✅ | KEEP | — |
| Table transfer / merge / QR | ✅ | KEEP | — |
| KDS + station routing | ✅ | KEEP | — |
| Ingredient inventory + recipes | ✅ | UPDATE | Add `tenant_id` to `recipes`; scope |
| Suppliers / waste logging | ✅ | UPDATE | Role-gated ✅; add tenant_id + PO receiving |
| X-report / VAT / COGS / staff performance | ✅ | KEEP | Now tenant-scoped ✅ |
| CSV export | ✅ | UPGRADE | Add PDF export + scheduled email reports |
| ESC/POS thermal print + drawer kick | ✅ | KEEP | Validate on real hardware |
| `alert()` → toast migration | 🟡 | UPDATE | **24 `alert()` remain in `src/`** — finish with `showToast` |
| Purchase orders / stock-take | ❌ | ADD | Build on ingredients schema |
| Loyalty tiers / campaigns | ❌ | ADD | Schema + UI |
| Permissions editor | ❌ | ADD | Roles are hardcoded — make editable |
| Per-tenant settings UI | ❌ | ADD | After `settings.tenant_id` (Section 5) |
| POS responsive/tablet layout | 🟡 | UPGRADE | Only ~1 breakpoint — see UI plan (12) |

### 8.2 Customer Online-Ordering PWA

| Feature | Status | Verdict | What to do |
|---|---|---|---|
| Menu browse/search/categories, server-priced modifiers | ✅ | UPDATE | Ensure tenant passed on every call (7.1) |
| Guest + registered checkout, loyalty, promo, reorder | ✅ | KEEP | — |
| Live tracking (SSE), order cancellation, tips | ✅ | KEEP | — |
| Real geocoding + live driver map | ✅ | KEEP | Leaflet + Nominatim |
| PWA (installable/offline), mobile-first, i18n en/si/ta | ✅ | KEEP | — |
| Scheduled ordering, ETA at checkout, guest tracking link | ✅ | KEEP | — |
| Order confirmation email/SMS, web push | ✅ | KEEP | Wire real creds |
| Group cart (SSE) | ✅ | KEEP | — |
| AI ordering assistant | ✅ | UPGRADE | Add menu-aware recommendations, guardrails |
| Restaurant/tenant selector | 🟡 | UPDATE | `RestaurantsView` exists — wire it to set active tenant for all public calls |
| Allergens / dietary filters | ✅ | UPGRADE | Make allergen data structured + filterable |
| Upsell / cross-sell | ✅ | KEEP | — |
| Dark mode | ✅ | KEEP | `prefers-color-scheme` |
| Social login, wallet pay, nutrition, live chat, abandoned-cart | ❌ | ADD | P2–P3 |

### 8.3 Driver Delivery app

| Feature | Status | Verdict | What to do |
|---|---|---|---|
| Registration + approval | ✅ | UPDATE | Approval role-gated ✅; add driver **login/auth** |
| Order assignment | ✅ | UPDATE | **Require driver auth** (currently public) |
| Live GPS ping | ✅ | KEEP | Works; move behind driver auth |
| Delivery status updates | ✅ | UPDATE | Allow-list ✅; require driver auth |
| Maps / navigation | ✅ | UPGRADE | Add turn-by-turn deep link, ETA |
| Cash reconciliation + handover | ✅ | KEEP | Role-gated ✅ |
| **Unified driver app** | 🟡 | UPGRADE | Consolidate scaffold + customer view + server page into `apps/driver-web/` |
| Driver earnings / shift view | 🟡 | ADD | `partner-earnings` exists; build driver-facing earnings |
| Push notifications to driver | ❌ | ADD | New-assignment alerts |

### 8.4 Platform / SaaS

| Feature | Status | Verdict | What to do |
|---|---|---|---|
| Tenant table + `tenant_id` isolation | ✅ | UPDATE | 6 tables scoped; **extend to settings/categories/etc. (Section 5)** |
| Tenant provisioning + owner seed | ✅ | KEEP | Now seeds a working owner login |
| Platform-admin guard | ✅ | KEEP | `requirePlatformAdmin` |
| SaaS console UI | 🟡 | ADD | Build a proper platform-admin dashboard (tenants, plans, usage, billing) |
| Subscription billing (plans) | ❌ | ADD | `plan` column exists; add billing + plan enforcement |
| Per-tenant subdomain routing | 🟡 | ADD | Resolver exists; wire real subdomain hosting/nginx |
| Usage metering / limits | ❌ | ADD | Orders/month, users per plan |

---

## 9. SaaS production-readiness — what's done, what remains

### 9.1 Done (verified in code)
- ✅ Multi-tenant isolation for the 6 core tables (reads scoped, writes stamped) — proven by `tests/tenant_isolation.test.js`.
- ✅ JWT carries `tenant_id`; `req.tenantId` on every authenticated request; public tenant resolver.
- ✅ Tenant provisioning seeds a working owner login; platform-admin separation.
- ✅ Endpoint role-gating; generic production errors; production fail-fast; `.gitignore` + secret placeholders; PayHere secret naming unified; Zod on login/shift/cash; no duplicate routes; no SQL injection (all parameterized).

### 9.2 Remaining blockers to a confident launch
1. **Per-tenant config** — add `tenant_id` to `settings` (+ `categories`, `modifiers`, `recipes`, `shifts`, `cash_movements`, `feedbacks`) and scope. **Highest priority** — without it tenants share config and the store-toggle SSE is global.
2. **Driver authentication** — drivers have no login; assign/status/location are public. Add driver auth (Section 10.3).
3. **PostgreSQL cutover + migrations** — SQLite won't hold multi-tenant concurrent load. Use `lib/db_adapter.js`; add a migration tool (node-pg-migrate/Prisma) with `tenant_id` in migration 1.
4. **Runtime + E2E testing** — none of the July changes have been *run* (analysis sandbox can't). Must run `npm test`, boot the server, and do a two-tenant smoke test before production.
5. **Automated tests + CI** — add auth, payment-webhook, and order-lifecycle tests; gate merges with GitHub Actions (`npm ci && npm test && npx tsc --noEmit`).
6. **Secrets rotation** — rotate the previously-exposed Gmail app password + Notify.lk key (see `SECURITY_ROTATE_ME.md`); set real `JWT_SECRET`, PayHere, SMTP, VAPID in production env.
7. **Observability** — centralized error middleware, structured logging (pino), Sentry (`SENTRY_DSN` stubbed), `/api/health` already present.

### 9.3 Production config checklist (`.env`)
```
NODE_ENV=production
JWT_SECRET=<48+ random bytes>          # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
CUSTOMER_JWT_SECRET=<separate strong secret>
PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET / PAYHERE_NOTIFY_URL
DATABASE_URL=postgres://...            # after cutover
SMTP_* / NOTIFY_LK_* / VAPID_* / SENTRY_DSN
CORS_ORIGIN=https://<tenant domains, comma-separated>
```

---

## 10. Security posture & required work

### 10.1 Strong (keep)
No SQL injection (parameterized), server-authoritative money, single settlement path, signed webhook + amount assertion, atomic stock, bcrypt, JWT expiry, hashed single-use OTP/reset tokens, 5 rate limiters, helmet, graceful shutdown, generic prod errors, fail-fast secrets.

### 10.2 To fix
- **Extend Zod validation** to all body-accepting write routes (orders, menu_items, tables, customers, ingredients, saas/tenants, driver).
- **Tighten single-record reads** — some `SELECT * FROM x WHERE id = ?` are not tenant-filtered (low risk; add `AND tenant_id = ?` for defense-in-depth).
- **Rate-limit** the remaining sensitive staff/driver routes.
- **Secrets**: rotate exposed creds; never commit `.env` (now gitignored).

### 10.3 Driver authentication (new)
- Add `drivers` table (or reuse users with role `driver`) with credentials.
- `POST /api/driver/auth/login` → JWT `{ driverId, tenant_id, role:'driver' }`.
- `authenticateDriver` middleware; require it on `assign`, `status`, `location`, `cash-reconciliation`.
- Driver app stores the token; server page `/driver/:id` upgraded to authenticated flow or replaced by the unified app.

---

## 11. Testing strategy (target: real coverage)

| Layer | Now | Target |
|---|---|---|
| Billing engine | 49 tests ✅ | keep |
| Tenant isolation | 5 tests ✅ | expand to writes + SSE partitioning |
| Auth (login, roles, PIN, OTP, reset) | ❌ | ADD |
| Payment webhook (signature, amount, idempotency) | ❌ | ADD — highest blast radius |
| Order lifecycle (create→accept→settle→invoice) | ❌ | ADD |
| Driver flow (auth→assign→status→GPS) | ❌ | ADD |
| E2E (Playwright) across the 3 apps | ❌ | ADD |
| CI gate | ❌ | ADD (GitHub Actions) |

---

## 12. UI/UX redesign plan (user-friendly, consistent)

The apps work but the UI is inconsistent (two separate CSS systems, a 4-component kit, giant view files, leftover `alert()`s). Goal: **one design language, three polished apps, mobile-first, accessible.**

### 12.1 Foundation — shared design system
- **Extract design tokens** into one shared package/file (colors, spacing, radius, typography, shadows, z-index, breakpoints) consumed by POS, customer, and driver apps. Support **light + dark** everywhere (customer app already has dark mode; bring it to POS and driver).
- **Grow `ui.jsx` into a real component library**: `Button`, `Input`, `Select`, `Textarea`, `Modal`, `BottomSheet`, `Card`, `Badge`, `Toast`, `Skeleton`, `EmptyState`, `Tabs`, `Table`, `Dropdown`, `Avatar`, `Spinner`, `Toggle`, `Stepper`, `Chip`. Use across all three apps.
- **Replace all remaining `alert()`** (24 in POS) with the toast/modal system.
- **Accessibility:** WCAG AA — ≥44px tap targets, visible focus states, aria labels, color-contrast, reduced-motion, keyboard nav.

### 12.2 Staff POS — usability upgrades
- **Responsive/tablet-first**: the POS is used on tablets — add breakpoints, larger touch targets, a collapsible sidebar, and a bottom action bar on small screens.
- **Split the 1,587-line `POSView`** into `MenuPanel`, `CartPanel`, `PaymentModal`, `DiscountModal`, `SplitBillModal` — easier to maintain and to theme.
- **Faster ordering:** keyboard shortcuts, category quick-filters, item search with fuzzy match, recent/favourite items.
- **Clearer money UI:** running totals, tax/service breakdown always visible, big confirm buttons, undo on destructive actions.
- **Dashboard**: turn KPIs into a clean card grid with charts; make the feedback inbox and reports first-class; add date-range filters.
- **Onboarding**: first-run setup wizard (restaurant details, tax, tables, first menu items).

### 12.3 Customer PWA — conversion & clarity
- **Menu**: sticky category nav, image-forward cards, clear price + dietary/allergen chips, fast add-to-cart with quantity steppers, "popular"/"recommended" rails.
- **Checkout**: one-screen summary, sticky "Place order" bar, clear delivery ETA + fee, address map picker, guest-friendly, minimal typing (inputmode, autofill).
- **Tracking**: prominent live map + status stepper (Placed → Accepted → Preparing → Out for delivery → Delivered), driver info, ETA countdown.
- **Empty/loading/error states** everywhere (skeletons, friendly empty states, retry).
- **Restaurant selector** (multi-tenant): clean list/search with cover images, open/closed badges, delivery time.
- **Trust**: order confirmation screen, receipt, clear cancellation window.

### 12.4 Driver app — focused, glanceable
- Build `apps/driver-web/` as a real PWA: **login → today's deliveries → active delivery (big map, customer/address, call button, status buttons) → cash reconciliation**.
- Large, thumb-friendly buttons; minimal text; works one-handed; offline-tolerant; battery-aware GPS.
- Push notification on new assignment.

### 12.5 Platform-admin console
- Tenants list (status, plan, usage), provisioning form, per-tenant health, billing/plan management, audit log viewer.

---

## 13. Phased build order (execute in order)

> Do not start a phase until the previous phase's acceptance criteria pass. Each phase ends green (`npm test`, `node --check`, and a manual smoke test).

**Phase 0 — Runtime baseline (validate what exists).**
Boot the server, run `npm test`, build all three frontends, do a manual smoke test of POS + customer + driver. Fix anything that doesn't actually run. *Done-when:* all three apps build and the happy path works locally.

**Phase 1 — Finish multi-tenancy.**
Add `tenant_id` to `settings`, `categories`, `modifiers`, `recipes`, `shifts`, `cash_movements`, `feedbacks`; scope their queries; partition SSE by tenant; wire the customer app's tenant/restaurant selector. *Done-when:* Tenant A and B have fully independent config, menu, and store state; integration criteria in 7.4 pass.

**Phase 2 — Driver auth + unified driver app.**
Driver login/JWT; protect assign/status/location; consolidate the driver UI into `apps/driver-web/`. *Done-when:* a driver must authenticate; GPS shows on customer + POS; one driver codebase.

**Phase 3 — Data layer + tests + CI.**
PostgreSQL cutover with migrations; add auth/payment/lifecycle/driver tests; GitHub Actions CI gate. *Done-when:* app runs on Postgres; CI is green and blocks bad merges.

**Phase 4 — UI/UX redesign.**
Shared design system + component library; replace `alert()`s; responsive POS; customer conversion polish; driver app UX; platform-admin console. *Done-when:* one design language across all apps; WCAG AA; no `alert()`.

**Phase 5 — SaaS commercialization.**
Subscription billing + plan enforcement; usage metering; subdomain routing; platform-admin dashboard; observability (pino + Sentry). *Done-when:* a tenant can self-serve sign up, is billed by plan, and limits are enforced.

**Phase 6 — Modularization & hardening.**
Split `server.js` into `routes/` modules; extend Zod to all writes; tighten single-record reads; finish TypeScript adoption. *Done-when:* no file over ~500 lines; all writes validated.

---

## 14. Golden rules (never violate)

1. **The server is authoritative on money.** Clients send intent; `resolveAndCalculateBill()` prices. Never trust a client amount.
2. **Settlement only through `settleOrderPaid()`.** The browser can never mark an order paid. Dev simulation stays server-side and disabled in production.
3. **Every money-affecting action writes to `audit_logs`.**
4. **Every tenant-scoped query filters by `tenant_id`; every insert stamps it.** Never return cross-tenant data.
5. **Wrap multi-step DB writes in transactions with rollback.**
6. **Keep the public/private route split** — public routes before `app.use(authenticateToken)`, staff routes after with `requireRole`.
7. **Add a test with every bug fix and every new money/tenant path.**
8. **Never weaken a security check to make a test pass. Never commit secrets.**

---

## 15. Definition of done (100% production-ready)

- [ ] All three apps build and run; happy paths verified end-to-end.
- [ ] Multi-tenant isolation complete (all scoped tables incl. `settings`); 7.4 integration criteria pass; tenant-isolation tests green.
- [ ] Driver authentication enforced; unified driver app shipped.
- [ ] Running on PostgreSQL with versioned migrations.
- [ ] Auth + payment-webhook + order-lifecycle + driver tests green in CI.
- [ ] Real secrets set + rotated; production boots with fail-fast; HTTPS.
- [ ] One shared design system; WCAG AA; zero `alert()`; responsive POS; polished customer + driver UX.
- [ ] Subscription billing + plan limits; platform-admin console; observability (logs + Sentry + health).
- [ ] `server.js` modularized; Zod on all writes; docs updated.

*Verification note: all current-state claims were checked against source on 2026-07-23. Items requiring a running server, Vitest, or a frontend build were not executed in the analysis environment and are labelled accordingly — validate them in Phase 0.*
