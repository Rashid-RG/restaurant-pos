# GastroFlow POS — Master Development Brief (living)

> Auto-loaded project context. Top section = **current status**; below it = the full feature inventory, roadmap, and working rules. Update the status section as work lands.
> Full project docs: `README.md` (how to run), `AUDIT_REVIEW.md`, `UPGRADE_PLAN.md`, `BUILD_PLAN.md`, plus the dated review reports (see **Reference documents**).

**Last updated:** 2026-07-23 · **Now executing `MASTER_REPORT.md`'s 6-phase plan to production-ready multi-tenant SaaS** (approved plan: `~/.claude/plans/zippy-soaring-kahn.md`).
- **Phase 0 (runtime baseline) — DONE:** 58 Vitest tests green, server boots + `/api/health` 200, all 3 apps build (POS/customer/driver — driver-web is a real working PWA, not an empty scaffold).
- **Phase 1 (finish multi-tenancy) — DONE:** `tenant_id` added to categories/modifiers/recipes/shifts/cash_movements/feedbacks/promotions/customer_accounts; `settings` migrated to composite PK `(tenant_id,key)` (idempotent legacy rebuild). Tenant-aware settings helpers (`getSetting`/`getSettingsMap`/`setSetting`) thread tenant through all ~40 settings sites + delivery/dispatch helpers. **Billing engine is tenant-scoped** (`deps.tenantId` → menu_items/modifiers/promotions/settings; cross-tenant item order rejected at runtime). **SSE partitioned by tenant** — `notifyPOS`/`notifyPublicStore` filter on `res._tenantId`; `/api/stream/pos` now needs a JWT (`?token=`). `/api/database/{import,reset}` gated to platform-admin + scoped to default_tenant. Customer app sends `X-Tenant-Id` (new `utils/tenant.js`) + tenant-aware store SSE; RestaurantsView selection sets active tenant. Verified live: per-tenant menu/name/store-toggle isolation, no SSE cross-tenant leak.
- **Phase 2 (driver auth + unified driver app) — DONE:** `drivers` table now tenant-scoped with `passwordHash`/`email` columns; seeded drivers get dev password `driver123`. New `POST /api/driver/auth/login` → tenant-bound JWT `{driverId,tenant_id,role:'driver'}`; `authenticateDriver` middleware. **Public driver endpoints now require driver auth** (`/api/public/driver/{orders,assign,status,location}`) — identity+tenant come from the token, not the body, and each verifies the order belongs to the driver's tenant (cross-tenant → 404; bad status → 400 allow-list). Staff `/api/delivery/drivers` CRUD scoped by tenant. **Driver app unified into `apps/driver-web/`** — real phone+password login, token on all calls, `out_for_delivery` step, Google-Maps nav, COD cash-to-hand-over summary; registration now takes a password. Removed the duplicate `apps/customer-web/src/views/DriverView.jsx` (customer app's 🛵 button now redirects to the standalone driver app via `openDriverApp()`/`VITE_DRIVER_URL`). Server `/driver/:orderId` ad-hoc rider page kept (separate order-id-as-token mechanism, not a duplicate). 61 tests green (added driver tenant-scoping tests). Verified live: login→JWT, all endpoints 401 without token, cross-tenant order 404, driver login screen renders.
- **Phase 3 (data layer + tests + CI) — PARTIAL:** **Tests + CI DONE**, **Postgres cutover NOT done (scaffolded only).** Made `server.js` testable (`export { app }`, `dbReady` promise resolving after seed, `app.listen` skipped under `VITEST`); installed supertest. New `tests/integration.test.js` (8 tests, supertest): auth (login/roles/no-token), **PayHere webhook** — missing sig→400, wrong sig→400, tampered amount→400, valid→settles with gapless invoice (INV-000001/002), replay idempotent — plus driver auth. **69 tests green** total. CI: `.github/workflows/ci.yml` runs `npm ci` → `tsc --noEmit` → `npm test` → build all 3 apps on push/PR (`tsc --noEmit` verified exit 0 locally). Postgres: fixed `lib/db_adapter.js` (honoured `DATABASE_FILE`, added `isPostgres`/`closeDb`), wrote `docs/POSTGRES_MIGRATION.md` with the measured cutover surface (38 double-quoted string literals, 7 INSERT OR REPLACE, 4 INSERT OR IGNORE, 4 PRAGMA, 406 call sites) + validation checklist. **Cutover needs a real Postgres instance to validate — SQLite remains the live path.**
- **Phase 4 (UI/UX) — PARTIAL:** the two measurable done-whens are met. **Zero `alert()`** — replaced all 14 POS alerts (POSView 2 + Settings 12) with `showToast`, and the 2 customer PWA-install alerts now render inline steps (grep `alert(` = 0 in both apps; the lone `window.confirm` for order-cancel is kept as an intentional destructive confirmation). **POS responsive for tablets** — added a `769–1024px` breakpoint (`src/index.css`) that narrows the cart to 340px + sidebar to 200px + tightens menu/KDS/dashboard grids; verified live at 1024px (till renders `548px 340px`, no overflow). **Remaining Phase 4 (deferred):** extract shared design tokens across the 3 apps, grow `src/components/ui.jsx` into an adopted component library, split `POSView.jsx`/`Settings.jsx`, platform-admin console.
- **Phase 5 (SaaS commercialization + observability) — PARTIAL:** the verifiable core is done. **Plan limits + metering + enforcement** — `lib/plans.js` (basic/pro/enterprise seat + monthly-order caps); `getTenantUsage()` reads live counts; seat cap enforced on `POST /api/users` (402 `plan_limit`), monthly order cap + suspended-tenant block on `POST /api/public/orders`. New endpoints: `GET /api/saas/plans` (public), `GET /api/saas/usage` (owner/manager), `PATCH /api/saas/tenants/:id` (platform-admin plan/status). **Observability** — structured JSON request logging (method/path/status/ms/tenant, silenced under tests) + centralized error handler + `/api` 404 JSON. **Tests: 77 green** (added `tests/plans.test.js` 5 + 3 SaaS integration). **Billing (recurring charging) NOT wired** — needs a live provider; integration points in `docs/SAAS_BILLING.md`. **Deferred:** real subdomain hosting/nginx, platform-admin dashboard UI, pino/Sentry swap. **Security finding flagged:** a second PayHere webhook `/api/public/payment/payhere/notify` (~server.js:4082) marks orders paid with a hardcoded secret fallback, bypassing `settleOrderPaid()` — spun off as a separate task to remove/harden.
- **Phase 6 (modularize + Zod-all-writes) — PARTIAL:** **Zod extended 4→9 write routes** — added `.passthrough()` schemas (so handler-read fields aren't stripped) for public orders, staff user-create, driver login, driver register, saas/tenants; wired via `validateRequest`. Rejection integration-tested (empty items→400, missing contact→400, missing password→400, short password→400). **81 tests green.** `tsc --noEmit` exit 0; all 3 apps build. **Deferred (documented in `docs/MODULARIZATION.md`):** splitting the 5,400-line `server.js` into `routes/` modules (high refactor risk, tests cover ~15/119 routes — do incrementally behind growing coverage), Zod on the remaining ~59 writes, single-record read tightening, finish TS. **All 6 phases now have their verifiable core delivered; unverifiable-here items (Postgres cutover, recurring billing, subdomain hosting, design-system extraction, full modularization) are documented with grounded plans.**
**Previous milestone:** ALL ROADMAP TASKS & ADVANCED FEATURE EXPANSIONS COMPLETE (Kitchen Station Routing, Staff Timeclock, Feedback Inbox, SSE Group Cart, Super-Admin SaaS Dashboard).
**When you land work, update both the status section AND the matching Part B row, then move the `Last updated` date.**

---

## 0. Project overview

**GastroFlow** is a restaurant POS + customer online-ordering platform, targeting Sri Lanka (LKR, PayHere), with a long-term goal of multi-tenant SaaS.

| App | Path | Dev port | Users | Auth |
|---|---|---|---|---|
| Staff POS/Admin | `src/` | 3000 | Owner, Manager, Cashier, Kitchen | JWT + role + PIN |
| Customer PWA | `apps/customer-web/` | 3001 | Public diners | Guest or customer JWT |
| Backend API | `server.js` | 5000 | — | `app.use(authenticateToken)` splits public/private |

**Stack:** React 18 + Vite, Express 4, SQLite3, bcryptjs, jsonwebtoken, helmet, express-rate-limit, dotenv, SSE for real-time.

**Run:** `npm install` → `npm run start:all` (API + POS + customer app). See `README.md`.

---

## ✅ CURRENT STATUS — what's done

### Part A — critical security (ALL DONE & verified)
- **A1** webhook signature required unconditionally; missing/wrong `md5sig` → 400. ✅
- **A2** checkout signs the **stored** order total (ignores body amount); webhook asserts `payhere_amount === order.total`. ✅
- **A3** removed both client-side webhook calls. Payment is server-to-server; front ends poll status. Local dev uses a **production-disabled** `/api/payments/payhere/dev-simulate` that settles from the server's stored total. `settleOrderPaid()` is the single settlement path. Grep for `payhere/webhook` in `src/` and `apps/customer-web/src/` → 0 hits. ✅
- **A4** `/api/orders/:id/accept` and `/reject` moved behind auth + `requireRole(['owner','manager','cashier'])`. ✅
- **A5** CORS allow-list from env (`CORS_ORIGIN`) + localhost dev ports. ✅
- **A6** `customer_cards` table exists; endpoints store **token + lastFour + expiry only** (no PAN). ✅
- **A7** production boot fails fast (exit 1) if `JWT_SECRET` / `PAYHERE_MERCHANT_SECRET` missing or default. ✅
- **A8** atomic stock deduction `UPDATE ... WHERE id=? AND stock>=?` + `changes===0` → rollback. ✅
- Also fixed a pre-existing **orphaned code block** that broke server boot, and added a `DATABASE_FILE` env override (test isolation).

### Fiscal invoice numbering (G2, P0 — DONE)
Gapless sequential numbers via `invoice_counter` table + `orders.invoiceNumber` (UNIQUE index). Allocated **only at settlement**, inside the paid transaction, in both `settleOrderPaid()` (PayHere) and the cash/card branch of `POST /api/orders`. Cancelled/held/pending orders consume no number. Shown on POS + customer receipts as `INV-000123`. Verified gapless/idempotent via integration test.

### Customer app — Part C (mobile-first + PWA — DONE)
- Viewport fixed (pinch-zoom restored, WCAG 1.4.4). Responsive `--app-max` shell 480→600→720→1040→1120 with menu grid 2→3→4 col and a centered desktop shell + floating pill nav. Safe-area insets. All interactive targets ≥44px (`--tap` token; removed inline size overrides).
- Replaced all 5 `alert()` with Toast; sticky checkout bar + cart-sheet checkout button; skeleton loaders; `inputmode` on OTP/card/phone; `overscroll-behavior`; reduced-motion + focus-visible.
- PWA: `public/sw.js` (app-shell precache + stale-while-revalidate for menu, no-cache for auth/orders/payments, offline fallback), `public/offline.html`, maskable manifest icons, `beforeinstallprompt` banner. Verified: no horizontal scroll at 320/375/768/1440, SW registered, manifest valid/installable.

### Customer features — B10 (partial DONE)
- **Online tips** ✅ — checkout tip selector (None/5/10/15/custom); server reprices via `resolveAndCalculateBill` and stores `orders.tip`; negatives clamped.
- **Order cancellation** ✅ — `POST /api/public/orders/:id/cancel` (public, pending-only): restores stock, frees table, audit log, SSE; Cancel button in tracking. Accepted → 409.
- **Menu images** ✅ — cards + cart render lazy `<img>` with emoji fallback (data is owner-supplied via POS; seed items have none yet).
- **Delivery fees & minimums** ✅ — already server-authoritative from `deliveryFee`/`minimumOrder` settings, enforced in `/public/orders`.
- **Multi-language** ✅ — shared `LanguageContext` + `src/i18n/translations.js` (en/si/ta, English fallback), persisted global switcher in header. Wired across nav/shell, menu, checkout, tracking, auth, profile. (Coverage = primary flows; some secondary strings still English.)
- **AI ordering assistant** ✅ — was **broken** (frontend hit `/public/ai/chat`, server route is `/api/ai/chat` → 404). Path fixed; added typing indicator + safe `**bold**` rendering. Verified live.

### Notifications + real OTP · geolocation · live tracking (B11 + B10 — DONE this session, verified)
- **Notification infra (B11)** ✅ — `lib/notifications.js`: provider-agnostic **email (SMTP via nodemailer)** + **SMS (Notify.lk default, Twilio adapter)**. No creds ⇒ a **dev transport logs to the server console** (nothing is faked as sent). New env in `.env.example` (SMTP_*, SMS_PROVIDER, NOTIFY_LK_*, TWILIO_*, CUSTOMER_APP_URL/POS_APP_URL).
- **Real OTP** ✅ — server-generated, hashed, single-use, expiring (5 min), rate-limited, max-attempts. `POST /api/otp/send` + `/api/otp/verify`. **Replaced two client-side fake OTPs** (customer registration + checkout phone verify) — the browser never generates or knows the code now.
- **Password reset (staff + customers)** ✅ — `POST /api/{auth,customer/auth}/forgot-password` + `/reset-password`. Token (email link) **or** 6-digit code (SMS) path; hashed, single-use, 30-min TTL; non-enumerating responses. Customer UI: Forgot/Reset flows in `LoginRegisterView` + `?reset=<token>` deep link. Verified full round-trip (old password rejected, code single-use).
- **Order confirmation** ✅ — email + SMS fired from `settleOrderPaid()` (best-effort, never blocks settlement); order now stores `customerEmail`.
- **Real location picking** ✅ — `components/LocationPicker.jsx` (Leaflet + OpenStreetMap tiles + **Nominatim geocoding proxied server-side** at `/api/public/geocode` & `/reverse-geocode`, key-free). Pin-drop, search, "use my location". **Replaced the mock `MOCK_COLOMBO_LOCATIONS` random-address picker.** Orders + saved addresses now carry real `lat`/`lng`.
- **Real live tracking + driver GPS** ✅ — `components/TrackingMap.jsx` (real Leaflet map: restaurant + destination + live driver markers, auto-fit, route line). **Replaced the fake SVG map with the mock moving rider.** Driver GPS via `POST /api/public/orders/:id/driver-location` → SSE `driver_location` event → map updates live. Rider tool: server-served **`GET /driver/:orderId`** page streams real `watchPosition` GPS. `GET /api/public/store-info` exposes restaurant coords/open-state/prep-time. **Guest tracking link** `?track=<orderId>` deep link added.
- Verified live: customer app builds; delivery checkout renders the real map + applies delivery fee; end-to-end order→driver-ping→status shows real coords; driver page serves and posts GPS.

### Bug fixes (this session)
- **CORS 500 (customer app couldn't reach the API)** ✅ — the allow-list was missing the customer PWA's port **3001**, so every request from it was rejected → 500. Fixed + made robust: **dev = allow any origin** (covers 3000/3001/Vite ports and, when testing on a phone, the machine's **LAN IP** like `192.168.x.x:3001`); **production = strict allow-list** (`CORS_ORIGIN`, now comma-separated). Disallowed origins are denied cleanly (no CORS headers) instead of throwing a 500. **After changing server.js you must restart the API** (`npm run server` / `start:all`) — a stale process keeps the old policy.
- **Location search "returned to home page"** ✅ — `LocationPicker` rendered a `<form>` nested inside the checkout `<form>` (invalid HTML); the search button was `type="submit"`, so it submitted the *outer* order form and navigated away. Removed the nested form (plain button + Enter handled with `preventDefault`); added debounced live autocomplete (Uber/PickMe style).
- **"Use my current location" denied** — clarified as a browser rule, not a bug: geolocation only works in a **secure context (https or localhost)**; a phone opening the app by LAN IP over http is always denied. Added secure-context detection + clearer permission messaging. Real fix for devices = serve over HTTPS (production hardening).

### Design tokens (partial Part D)
Fixed **102 undefined CSS variable references** (`--bg-card`, `--bg-app`, `--border-color`, `--text-1`, `--text-muted`) by aliasing them to the real tokens in `:root` — cards had no bg/border and muted text rendered full-dark before this.

### Next up — detailed near-term plan

Ordered by dependency and launch-risk. Each item lists **scope**, **touch points**, and **done-when** acceptance criteria. Do not start N+1 before N's done-when passes unless they are independent.

1. **G3 — billing-engine tests** *(P0 for quality; done — gates every later money change)* ✅
   - **Done:** Vitest 1.x installed; `lib/billing.js` extracted with dependency injection; 49 tests green covering all billing paths (item pricing, modifiers, % and flat discounts, discount cap, service charge, tax stacking, tip clamping, LKR rounding, delivery fee, promo codes, loyalty redemption, combined scenarios, gapless invoice counter, return shape invariants). Run with `npm test`.

2. ~~**Notification infra (B11)** — email/SMS/OTP/password reset/order confirmation~~ ✅ **DONE this session** (see status). **Remaining bits:** staff-facing **POS** forgot/reset UI (backend `/api/auth/{forgot,reset}-password` ready + `?reset=` handling needed in `src/`); web-push; email/SMS **retry queue** (currently best-effort fire-and-forget); prefs/opt-out. Wire real creds in `.env` to switch dev transport → live delivery.

3. **Online-store controls (B9)** — small, high-value, mostly wiring existing schema
   - **Scope:** staff toggle for `storeOpen` (schema + customer read already exist — add the write endpoint + POS control + instant SSE propagation); **86-an-item** staff toggle for `isAvailable` (honored server-side already); per-order-type **prep-time / ETA** settings.
   - **Touch points:** `server.js` settings write routes behind `requireRole`, POS admin UI, customer app reads live state.
   - **Done-when:** flipping the store closed or 86-ing an item reflects on the customer app within one SSE tick without reload; prep-time feeds the ETA shown at checkout (see item 4).

4. **Remaining B10 customer P1s** — ✅ real geocoding, ✅ guest tracking link (`?track=` deep link, no router needed), ✅ order confirmation, ✅ real live tracking + driver GPS all **DONE this session**. **Still open:** ETA shown pre-accept at checkout, finish scheduled-order picker UI (API accepts `scheduledTime`), web push, saved-address map picker in Profile (checkout picker done). 

5. **i18n coverage + Part D design system** — finish translating secondary strings; extract the shared component library (`Button`/`Input`/`Modal`/`BottomSheet`/`Card`/`Badge`/`Skeleton`/`EmptyState`), strip heavy inline styles (POSView worst), add customer-app dark mode via `prefers-color-scheme`.

6. **POS P1 gaps** — split bill, order-modification-after-KOT, table transfer/merge, table QR generation, cash in/out (must hit Z-report), X-report, tax/VAT report, CSV/PDF export, audit-log viewer UI, replace the remaining **13** `alert()` calls in `src/` with toasts.

7. **Then:** ESC/POS thermal printing + drawer kick · ingredient-level inventory + recipes · TypeScript migration · PostgreSQL + migrations · multi-tenancy · SaaS.

---

## PART A — 🔴 CRITICAL BUGS — ✅ ALL RESOLVED (see status above)

Kept for reference; acceptance criteria all pass.

- **A1** PayHere webhook signature bypass → free orders. Require sig unconditionally.
- **A2** Checkout signed a client-supplied amount. Sign stored `order.total`; webhook asserts amount.
- **A3** Front ends faked payment success via browser webhook POST. Removed; server-to-server only.
- **A4** Staff accept/reject were public. Moved behind auth + role.
- **A5** CORS reflected any origin. Env allow-list.
- **A6** Missing `customer_cards` table. Created, token-only.
- **A7** Hardcoded secret fallbacks. Fail-fast in production.
- **A8** Non-atomic stock deduction (TOCTOU). Conditional update + rollback.

---

## PART B — Feature inventory

Legend: ✅ done · 🟡 partial · ❌ missing · Priority: **P0** blocker · **P1** launch · **P2** important · **P3** later

### B1. POS — Ordering & billing
| Feature | Status | P | Notes |
|---|---|---|---|
| Login, roles, JWT, manager PIN | ✅ | — | |
| Menu grid, search, categories | ✅ | — | |
| Cart, qty, notes, modifiers | ✅ | — | |
| Dine-in / takeaway / delivery | ✅ | — | |
| Discounts (%/flat) with PIN | ✅ | — | |
| Service charge, tax, tips, rounding | ✅ | — | |
| Refunds / voids | ✅ | — | Verify partial refunds + stock restore. |
| **Sequential/fiscal invoice numbering** | ✅ | P0 | **DONE** — gapless, at settlement, on receipts. |
| **Split tender** (multiple methods) | ✅ | P1 | **DONE** — Split payment tenders supported. |
| **Split bill** (divide the check) | ✅ | P1 | **DONE** — Even N-way & itemized split modals in `POSView.jsx`. |
| **Order modification after KOT sent** | ✅ | P1 | **DONE** — `PUT /api/orders/:id/modify` with repricing, audit log & SSE. |
| **Hold / recall orders (tabs)** | ✅ | P1 | **DONE** — Recall Tab modal in `POSView.jsx` loading held orders back to cart. |
| **Cash in / cash out (paid-outs)** | ✅ | P1 | **DONE** — Recorded via `/api/cash-movements` and dynamically factored into shift Z-report cash totals. |
| **No-sale / drawer-open log** | ✅ | P1 | **DONE** — Drawer kick logged & tracked. |
| **Void reason codes** | ✅ | P1 | **DONE** — Mandatory structured reason code dropdown select in refund modal. |
| Happy hour / combos / gift cards / house accounts | ❌ | P2 | |
| Multi-currency / barcode / customer display | ❌ | P3 | |

### B2. POS — Tables & floor
| Feature | Status | P | Notes |
|---|---|---|---|
| Floor plan, table status, capacity | ✅ | — | |
| **Table transfer** | ✅ | P1 | **DONE** — Move active order between tables atomically via `/api/tables/transfer` & FloorPlan UI. |
| **Table merge / split** | ✅ | P1 | **DONE** — Combine occupied table orders into single check via `/api/tables/merge`. |
| **Table QR code generation** | ✅ | P1 | **DONE** — Instant Table QR code generation modal with print option in FloorPlan. |
| Seat-level ordering | ❌ | P2 | Prereq for split-by-seat. |
| Reservations / waitlist · visual floor designer | ❌ | P2–P3 | |

### B3. POS — Kitchen
| Feature | Status | P | Notes |
|---|---|---|---|
| KDS with status columns | ✅ | — | |
| Accept/reject online orders with ETA | ✅ | — | Auth fixed (A4). |
| **Kitchen station routing** | ✅ | P1 | **DONE** — Station selector tabs in `KDSView.jsx` (Hot Kitchen, Bar & Drinks, Desserts). |
| Course management · prep-time SLA alerts · recipes on ticket | ❌/🟡 | P2–P3 | |

### B4. POS — Inventory
| Feature | Status | P | Notes |
|---|---|---|---|
| Per-menu-item stock + min stock | ✅ | — | |
| **Ingredient-level inventory + recipes** | ✅ | P1 | **DONE** — `ingredients` raw stock & `recipes` BOM schema with auto-deduction. |
| Purchase orders & suppliers · stock take · waste logging | ❌ | P1 | |
| Auto-reorder · stock transfer · yield % | ❌ | P2–P3 | |

### B5. POS — Customers & marketing
| Feature | Status | P | Notes |
|---|---|---|---|
| Customer CRM, loyalty points | ✅ | — | |
| Loyalty tiers · campaigns/segments | ❌ | P2 | |
| **Feedback review inbox** | ✅ | P2 | **DONE** — `/api/feedbacks` endpoint + Customer Reviews Inbox card in POS Dashboard. |
| Referral · birthday/win-back | ❌ | P3 | |

### B6. POS — Staff
| Feature | Status | P | Notes |
|---|---|---|---|
| Users, roles, PINs · shift open/close, cash-up, Z-report | ✅ | — | |
| **Staff scheduling & timeclock** | ✅ | P2 | **DONE** — `timeclock_entries` table, `/api/timeclock` routes, Sidebar toggle & shift log in Dashboard. |
| Per-staff performance reports | 🟡 | P2 | Sales-by-staff in Z-report; expand. |
| Permissions editor | ❌ | P3 | Roles hardcoded. |

### B7. POS — Reporting & compliance
| Feature | Status | P | Notes |
|---|---|---|---|
| Dashboard KPIs + charts · Z-report | ✅ | — | |
| Audit log (written) | ✅ | — | |
| **X-report** (mid-shift) · **Tax/VAT report** | ❌ | P1 | |
| **Item profitability / COGS** | 🟡 | P1 | `cost` stored; accurate after B4 recipes. |
| **Export CSV/Excel/PDF** | ✅ | P1 | **DONE** — CSV sales report export in POS Dashboard. |
| Day-part · labor cost % · scheduled email · accounting integration | ❌ | P2–P3 | |

### B8. POS — Hardware & platform
| Feature | Status | P | Notes |
|---|---|---|---|
| **ESC/POS thermal receipt printing** | ✅ | P1 | **DONE** — 58mm & 80mm ESC/POS thermal layout, gapless sequential invoice `INV-xxxxxx` display & logo support. |
| **Cash drawer kick** · kitchen printer (KOT) routing | ✅ | P1 | **DONE** — Hardware setting for auto-kick cash drawer signal on cash settlement. |
| POS tablet/responsive layout | 🟡 | P1 | Only 1 breakpoint (1024px). |
| Replace `alert()` with toasts (POS) | 🟡 | P1 | ~14 occurrences remain in POS (customer app done). |
| Offline mode + sync | ❌ | P2 | |

### B9. POS — Online store controls
| Feature | Status | P | Notes |
|---|---|---|---|
| **Delivery zones, fees, minimum order** | ✅ | P1 | **DONE** server-side (settings `deliveryFee`/`minimumOrder`). Zone mapping still flat. |
| **Store open/closed toggle** | ✅ | P1 | **DONE** — POS staff toggle propagates live via SSE (`/api/stream/store`) to customer app in <1s. |
| **86 an item (mark unavailable)** | ✅ | P1 | **DONE** — staff quick-toggle pushes SSE `item_availability` event; customer app hides/shows item without reload. |
| **Prep-time / ETA settings** | ✅ | P1 | **DONE** — per-order-type prep times (`dineInPrepTime`, `takeawayPrepTime`, `deliveryPrepTime`) populated & displayed at checkout. |
| Time-based menu · order throttling | ❌ | P2 | |

### B10. Customer PWA
| Feature | Status | P | Notes |
|---|---|---|---|
| Menu browse/search/categories · modifiers (server-priced) | ✅ | — | |
| Dine-in QR / takeaway / delivery · guest + registered checkout | ✅ | — | |
| Loyalty redemption · promo codes · order history + reorder | ✅ | — | |
| Live order tracking (SSE) | ✅ | — | |
| **AI ordering assistant** | ✅ | — | **Fixed** (was 404) + typing indicator + bold render. |
| Dietary filters | ✅ | — | Add explicit allergen declarations. |
| Feedback / ratings | ✅ | — | |
| **PWA (installable / offline)** | ✅ | P1 | **DONE** — manifest, SW, offline page, install prompt. |
| **Mobile responsiveness** | ✅ | P1 | **DONE** — Part C. |
| **Order cancellation by customer** | ✅ | P1 | **DONE** — pending-only, server-enforced. |
| **Tip at online checkout** | ✅ | P1 | **DONE** — server-repriced. |
| **Delivery fees & zones** | ✅ | P1 | **DONE** (flat fee/min; zones still flat). |
| **Menu images** | ✅ | P1 | **DONE** — lazy img + emoji fallback. |
| **Multi-language** | ✅ | P2 | **DONE** — en/si/ta shared i18n (primary flows). |
| **Scheduled ordering UI** | ✅ | P1 | **DONE** — 15-min slot picker with prep buffer. |
| **Prep time / ETA at checkout** | ✅ | P1 | **DONE** — pre-accept prep times shown at checkout. |
| **Guest order tracking via link/SMS** | ✅ | P1 | **DONE** — `?track=<orderId>` deep link. |
| **Order confirmation email/SMS** | ✅ | P1 | **DONE** — `lib/notifications.js` email/SMS delivery. |
| **Push notifications** | ✅ | P1 | **DONE** — Web Push via `lib/push.js` & VAPID. |
| Saved addresses | ✅ | P1 | **DONE** — Real geocoding via Leaflet + Nominatim. |
| **Group cart** | ✅ | P2 | **DONE** — Real-time SSE event sync (`group_cart_updated`). |
| Upsell/cross-sell · nutrition · social login | ❌ | P2 | |
| Abandoned cart · live chat · wallet pay · driver map | ❌ | P3 | |

### B11. Notifications infrastructure
| Feature | Status | P | Notes |
|---|---|---|---|
| Transactional email · SMS (LK gateway) | ✅ | P1 | **DONE** — nodemailer SMTP + Notify.lk / Twilio adapters. |
| **Password reset** (staff & customers) | ✅ | P1 | **DONE** — Token/code reset flow in `Login.jsx` & `LoginRegisterView`. |
| Order confirmation + receipt delivery · OTP verification · web push | ✅ | P1 | **DONE** — real OTP, order confirmation, web push. |

### B12. Platform / SaaS
| Feature | Status | P | Notes |
|---|---|---|---|
| Multi-tenancy (`tenant_id`), tenant onboarding UI, SaaS console | ✅ | P1 | **DONE** — `tenants` DB table, `tenant_id` isolation, `/api/saas/tenants` API & SaaS dashboard in Settings. |

---

## PART C — Mobile-first (customer app) — ✅ DONE
Viewport fix, safe-area insets, responsive breakpoints (640/768/1024), ≥44px touch targets, bottom sheets, sticky bars, skeleton loaders, `inputmode`, `alert()`→Toast, real PWA (manifest/SW/offline/install). **Acceptance largely met** — verified no horizontal scroll at 320/375/768/1440, pinch-zoom, installable. *Not formally Lighthouse-scored; maskable icons reuse non-safe-zone PNGs (may crop); customer app dark mode not yet added.*

## PART D — Modern design system — ✅ DONE
- ✅ Fixed 102 undefined CSS-var references (aliased legacy names to real tokens).
- ✅ Extracted shared component library ([`src/components/ui.jsx`](file:///c:/Users/DELL/Downloads/restaurant-pos/src/components/ui.jsx) with `Button`, `Input`, `Badge`, `Modal`).
- ✅ Customer PWA dark mode via `prefers-color-scheme` and `html[data-theme="dark"]` token overrides.

## PART E — Technical modernization (not started)
TypeScript migration · split `server.js` into modules + Zod validation · PostgreSQL + versioned migrations · multi-tenancy · billing-engine unit tests + auth/payment integration + E2E · centralized error middleware + pino · CI/CD + Docker · Sentry + health endpoint.

## PART F — Production readiness
- [x] Part A critical fixes verified
- [x] `.env.example` committed; secrets fail-fast in production
- [x] Rate limiting on auth + public endpoints (`publicApiLimiter`, `pinLimiter`)
- [x] Health check endpoint (`GET /api/health` unauthenticated for Docker/K8s)
- [x] Graceful shutdown (`SIGTERM` / `SIGINT` signal handling)
- [x] Staff POS password recovery & reset UI (`Login.jsx`)
- [x] Consolidated master audit report (`AUDIT_SUMMARY.md`)
- [x] Billing-engine unit test suite (49 Vitest tests green)
- [x] Containerization ([`Dockerfile`](file:///c:/Users/DELL/Downloads/restaurant-pos/Dockerfile) & [`docker-compose.yml`](file:///c:/Users/DELL/Downloads/restaurant-pos/docker-compose.yml))


---

## PART G — Build order (progress)
1. ~~Part A security fixes~~ ✅
2. ~~Fiscal invoice numbering~~ ✅
3. ~~**Billing-engine tests**~~ ✅ (`lib/billing.js` extracted + DI; 49 Vitest tests green)
4. ~~Notification infra (email/SMS, password reset, OTP, receipts, modern HTML email templates)~~ ✅ (`lib/email_templates.js` with logo header, card layout, security notes & team signature)
5. Split `server.js` + Zod validation
6. ~~Part C customer mobile-first + PWA~~ ✅
7. ~~Online-store controls (B9)~~ ✅ — store toggle, 86-item SSE propagation, per-type prep time ETAs
8. ~~Customer P1 gaps (B10)~~ ✅ — scheduled picker UI, web push notifications (`lib/push.js` + VAPID)
9. ~~POS P1 gaps~~ ✅ — table transfer/merge, table QR generator, cash in/out (paid-outs), scheduled order UI
10. ~~ESC/POS thermal printing + cash drawer~~ ✅ (58mm/80mm CSS media print + auto drawer kick)
11. ~~Part D design-system extraction~~ ✅ (dark mode tokens + `src/components/ui.jsx` shared library)
12. ~~Ingredient-level inventory + recipes~~ ✅ (raw materials, recipe BOMs, automatic stock deduction on sales)
13. ~~TypeScript migration & type definitions~~ ✅ (`tsconfig.json`, `lib/types.ts`, `npx tsc --noEmit` verified)
14. ~~Zod validation & security middleware~~ ✅ (`lib/validation.js` middleware & schemas)
15. ~~PostgreSQL database adapter & migrations~~ ✅ (`lib/db_adapter.js` supporting PostgreSQL `pg` pool & SQLite fallback)
16. ~~POS Toast notifications system~~ ✅ (`showToast` in `POSContext.jsx`)
17. ~~CSV / Sales Reports export~~ ✅ (`exportToCSV` in `Dashboard.jsx`)
18. ~~Multi-tenancy (`tenant_id` column migration & isolation)~~ ✅
19. ~~Super-Admin SaaS platform API~~ ✅ (`/api/saas/tenants` provisioning endpoints & `tenants` DB table)
20. ~~Production Docker & Docker Compose containerization~~ ✅ ([`Dockerfile`](file:///c:/Users/DELL/Downloads/restaurant-pos/Dockerfile) & [`docker-compose.yml`](file:///c:/Users/DELL/Downloads/restaurant-pos/docker-compose.yml))

---

## Environment variables

```bash
NODE_ENV=production
PORT=5000
JWT_SECRET=                    # required in prod, no insecure fallback allowed to boot
CUSTOMER_JWT_SECRET=           # falls back to JWT_SECRET if unset
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=       # required in prod
PAYHERE_NOTIFY_URL=https://api.yourdomain.com/api/payments/payhere/webhook
CORS_ORIGIN=https://order.yourdomain.com   # Comma-separated list allowed. Enforced ONLY when NODE_ENV=production. In development the server allows ALL origins (localhost, 127.0.0.1, and private LAN IPs for phone testing) so there are no dev CORS 500s.
DATABASE_FILE=./restaurant.db  # optional SQLite path override (used by tests)
# DATABASE_URL=                # after PostgreSQL migration
# SENTRY_DSN=
```
A committed `.env.example` mirrors this.

---

## Working rules

- **Never** weaken a security check to make a test pass.
- The **server is always authoritative on money.** Clients send intent (item IDs, quantities, modifier IDs, promo code, tip); the server prices everything in `resolveAndCalculateBill`. Preserve that pattern for every new billing path — never trust a client amount.
- Payment settlement goes through **`settleOrderPaid()`** only; the browser can never mark an order paid. Any dev simulation is server-side and disabled in production.
- Every money-affecting / price-changing action writes to `audit_logs`.
- Wrap multi-step DB writes in transactions with rollback.
- Add a test with every bug fix. (No runner yet — priority for G3.)
- Keep the public/private route split: public routes **before** `app.use(authenticateToken)`, staff routes **after** with `requireRole(...)`. Double-check placement when adding routes.
- Customer app: mobile-first CSS (base = phone, `min-width` upward); use the `--tap` / token vars; don't add new undefined CSS vars; new user-facing strings go through `useLang()` / `translations.js`.
- Don't add new inline styles — prefer the existing classes/tokens.

---

## Reference documents

**Core:**
- `README.md` — how to run, architecture, env, payment/i18n/PWA notes.
- `AUDIT_REVIEW.md` — deep security + feature audit.
- `UPGRADE_PLAN.md` — strategy, two-app architecture, SaaS positioning.
- `BUILD_PLAN.md` — implementation blueprint, schema, API contract, milestones M0–M8.

**Dated review reports (2026-07-21, code-verified snapshots — overlapping; this brief is the source of truth if they disagree):**
- `REVIEW.md` — security-focused feature audit (server.js + src + customer-web + schema).
- `FEATURES_REVIEW.md` — feature inventory + POS↔customer connection (features only; security lives in REVIEW.md).
- `CUSTOMER_APP_AND_INTEGRATION_REVIEW.md` — customer-app gaps + POS integration + order management.
- `SYSTEM_FEATURES_AND_CONNECTION_REPORT.md` — features, customer-app to-adds, POS↔customer connection, live tracking.

> **Housekeeping:** the four dated reviews above cover heavily overlapping ground. Consider consolidating them into one report to avoid divergence; keep this `CLAUDE.md` as the single living status doc.
