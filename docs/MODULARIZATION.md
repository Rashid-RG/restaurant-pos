# server.js Modularization Plan (Phase 6)

> **Status: planned, NOT done.** `server.js` is ~5,400 lines / 119 routes. Splitting
> it into `routes/` modules is a large pure-refactor with real regression risk —
> and the automated tests currently exercise only ~15 of the 119 routes, so a
> blind split could silently break untested endpoints. This is deliberately left
> as a guided refactor to do **incrementally, behind the growing test suite**,
> rather than in one risky pass.

## 2026-11-18: Commercial SaaS tenancy refactor (incremental)

The production POS entrypoint, settings API contracts, and server database boot sequence remain unchanged. Tenant-scoped settings SQL has been extracted into `lib/tenancy/settings-store.js` using an injected `{dbGet,dbAll,dbRun}` provider, with the previous `getSetting`, `getSettingAny`, `getSettingsMap` and `setSetting` functions in `server.js` retained as compatibility wrappers. This is not a database migration and imports do not execute SQL. The new tests cover two independent restaurant settings sets, key fallback semantics, parameterized reads and tenant-filtered updates. The repository architecture guard enforces the new boundary.

**Next:** add tests before moving one bounded domain at a time; prioritize tenant authorization and payment/reporting route contracts. Keep the existing live restaurant's login, receipt printing, sales and Turso data untouched. Do not deploy this refactor without a separate staging approval.

## 2026-11-18: Tenant authentication policy extraction

A new pure module, `lib/tenancy/access-policy.js`, owns the existing staff claim validation, account-to-token tenant comparison, selected POS URL tenant match, platform owner authorization, permitted staff roles, and customer tenant selector comparison. `server.js` still performs the same JWT verification, account and subscription database lookups, response status codes, and error messages; only these policy decisions were extracted. No API path or login token format was changed, and the active tenant database is not accessed by importing the module.

`tests/tenant-access-policy.test.js` uses two synthetic restaurants to cover cross-tenant staff credentials and URL mismatches, platform owner versus restaurant owner authorization, role revocation and customer session boundaries. The architecture guard requires the new pure module and tests.

**Still required before commercial SaaS certification:** comprehensive two-restaurant API integration tests, route-level tenant filtering audits, staff username uniqueness policy, and a reviewed migration/rollback process. This commit is a non-deployed source refactor and is not proof that every route is tenant secure.

## 2026-11-18: Legacy POS resource ownership boundaries

The existing legacy resource pre-handler now calls pure functions in `lib/tenancy/resource-policy.js`. Explicitly enumerated resource paths map to permitted database tables; the helper extracts URL IDs, body IDs, and table-transfer IDs, while authenticated middleware retains the existing tenant-scoped ownership query and 404 response. No endpoint address, role permission, schema or database operation is added.

`tests/tenant-resource-policy.test.js` covers canonical route mapping, body- and path-supplied IDs, protected table transfer references and cross-restaurant ownership. The real HTTP suite `tests/pos-tenant-url-auth.test.js` now also checks separate staff/menu list visibility for two restaurants and rejects an attempt by one store to overwrite the other store's menu item.

**Remaining security work:** broader route-level authorization, payment and report boundaries, server-wide audit of bypasses and the owner/staff username uniqueness model. Do not deploy this code without explicit staging authorization; it does not imply commercial security certification.

## 2026-11-18: Financial read isolation hardening

The authenticated `/api/reports/x-report` endpoint now requires `tenant_id = req.tenantId` when locating the currently open shift; selecting a staff ID alone is insufficient under malformed historical cross-tenant shift data. The PayHere checkout manual-payment preflight now requires the verified `req.trackingTenant` from the existing order tracking guard when querying `manual_payments`; a similarly named order from another tenant cannot influence this block.

The real HTTP test suite `tests/pos-tenant-url-auth.test.js` includes synthetic two-restaurant financial fixtures, with a deliberately foreign-tenant open shift referencing the same staff ID, and verifies the resulting shift ID, X-report sales, VAT aggregates and COGS menu rows. No schema migration, existing transaction change, or production data operation is part of this batch.

**Risk note:** This checks specific reports and checkout gates. Commercial financial certification still requires complete ledger, reconciliation, cash-drawer, refund and tenant-audit coverage, including backup-based restoration and independent acceptance tests. The branch is not deployed to staging without user approval.

## 2026-11-18: Cashier shift tenant isolation

Cashier shift endpoints now include `req.tenantId` when retrieving active shifts, checking whether a shift is already open, fetching a newly created shift, closing a shift and assigning cash movements to the active drawer. The close-shift SQL update now requires both shift ID and tenant ID. This prevents a malformed or migrated foreign-tenant shift referencing the same staff ID from being used by another restaurant.

The real HTTP two-restaurant test in `tests/pos-tenant-url-auth.test.js` exercises a deliberately conflicting foreign shift, verifies active-shift selection and duplicate-open rejection, cash movement allocation, closing and post-close state, and ensures the foreign shift remains unchanged. All fixtures use a disposable local database. No deployment, database migration or actual restaurant transaction was performed.

**Still required:** full cashier ledger and refund isolation review, settlement idempotency, controlled non-customer staging trial, and a comprehensive cross-tenant financial route audit.

## 2026-11-18: Commercial SaaS financial/operations safety batch

This source-only batch narrows the highest-risk legacy SQL paths while preserving the existing shared database and URL contracts.

- Cash-on-delivery handover lists are now tenant-filtered. Receipt handover rejects duplicate IDs, missing or foreign-tenant orders, non-delivered/non-cash orders, wrong drivers, already-collected receipts and mismatched handover totals. Only verified outstanding tenant orders are updated inside a transaction.
- Payment settlement updates the order, invoice, customer loyalty and order-item notification reads with explicit tenant conditions rather than relying on globally unique IDs alone. The existing webhook signature and settlement authorization remain in place.
- Table delete and transfer statements require tenant ownership. A transfer also verifies the referenced active order belongs to the authenticated restaurant.
- Staff ETA changes, public ETA reads, kitchen-load counts and delivery notification reads are explicitly tenant-filtered.
- `tests/pos-tenant-url-auth.test.js` now exercises real two-restaurant COD handover acceptance/rejection, cross-tenant table operations, scoped ETA updates and ETA capacity computation, in addition to earlier checkout/staff/report tests.
- `scripts/check-repository-architecture.mjs` checks for critical tenant predicate snippets as interim architectural guardrails until the oversized server is modularized.

**Release state:** GitHub source commits only; no staging deployment, database migrations, backup restoration or changes to live restaurant customers/orders. The regression suite must pass before a separate, explicitly authorized staging release. This is not full commercial SaaS certification: wider concurrency testing, payment-provider production tests, tenant admin cleanup, regulatory review, threat modeling and operational recovery drills remain.

## 2026-11-18: Commercial SaaS destructive-operation safety

The legacy `/api/database/import` and `/api/database/reset` endpoints now fail closed by default and always deny in `NODE_ENV=production`, including for the authenticated platform owner. They remain source-compatible for an explicitly enabled *non-production* legacy test scenario (`ENABLE_LEGACY_DATABASE_MUTATIONS=true`), not for commercial live restoration. Use the verified offline recovery process and formal staging approval instead.

The POS table creation/update endpoint no longer uses `INSERT OR REPLACE` on the globally unique table ID (which could delete a foreign restaurant's record). Existing tenant-owned tables are updated with `WHERE id=? AND tenant_id=?`; new tables are inserted normally; provided current-order references must belong to the same tenant. Tests now verify rejected foreign order links and correct same-tenant updates, plus platform-owner reset/import rejection with unchanged records.

**Still open:** full authorization inventory for legacy backend routes, end-to-end payment/refund and backup recovery drills, safe per-tenant staff identity model, backend decomposition, tenant onboarding operations and isolation under concurrency, hardware acceptance, native device verification, and a separate authorized staged release. This batch makes no changes to the running POS or live Turso data.

## What IS done in Phase 6

- **Zod validation** extended from 4 → 9 write routes, matching real bodies with
  `.passthrough()` (so handler-read fields aren't stripped): public orders, staff
  user create, driver login, driver register, saas/tenants — plus the original
  login/shift-open/shift-close/cash-movement. Rejection is integration-tested
  (`tests/integration.test.js` → "Zod validation on write routes").

## Recommended target layout

```
server.js            # app setup, middleware, DB open, mount routers, listen
lib/                 # pure/DI helpers (already the pattern: billing, plans, validation…)
routes/
  auth.js            # /api/auth/*, /api/customer/auth/*, /api/otp/*
  payments.js        # /api/payments/payhere/* (ONE webhook — see security note)
  orders.js          # /api/orders/*, /api/public/orders/*
  catalog.js         # menu_items, categories, modifiers, recipes
  tables.js          # /api/tables/*
  customers.js       # customers, customer_accounts, loyalty
  inventory.js       # ingredients, suppliers, waste
  reports.js         # x-report, vat, cogs, staff performance
  driver.js          # driver auth + /api/public/driver/*
  saas.js            # /api/saas/*, marketplace
  public.js          # storefront: menu, store-info, geocode, feedback, delivery-fee
  sse.js             # stream/pos, stream/store, stream/orders + notify* helpers
```

## Incremental, safe method

1. Extract **pure helpers first** (lowest risk): SSE `notify*`, settings helpers,
   metering helpers → `lib/` with DB helpers injected (like `lib/billing.js`).
2. Move **one domain at a time** into `routes/<domain>.js` as an
   `express.Router()`. Preserve the public/private split: public routers mounted
   before `app.use(authenticateToken)`, staff routers after with `requireRole`.
3. **Add tests for a domain's routes before moving them**, so the move is
   covered. Grow coverage from ~15 → most of 119 routes as you go.
4. Keep `req.tenantId` / `resolvePublicTenant` contracts identical.
5. Run `npm test` + a two-tenant smoke after each domain move.

## Also outstanding (Phase 6 tail)

- **Zod on the remaining ~59 write routes** (same `.passthrough()` pattern).
- **Tighten single-record reads** — add `AND tenant_id = ?` to the few
  `SELECT … WHERE id = ?` that aren't yet tenant-filtered (defense-in-depth; most
  are already scoped from Phase 1).
- **Finish TypeScript adoption** (`tsc --noEmit` already passes; convert modules
  incrementally).

## Security note (blocking, tracked separately)

Before/while touching `payments.js`, remove the duplicate insecure webhook
`POST /api/public/payment/payhere/notify` (~server.js:4082) — it uses a hardcoded
secret fallback and bypasses `settleOrderPaid()`. The canonical
`/api/payments/payhere/webhook` is the single settlement path.

### Done-when
- [ ] No source file over ~500 lines.
- [ ] Zod on all body-accepting write routes.
- [ ] Test coverage across the moved routers; `npm test` green throughout.
