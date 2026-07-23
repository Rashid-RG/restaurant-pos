# server.js Modularization Plan (Phase 6)

> **Status: planned, NOT done.** `server.js` is ~5,400 lines / 119 routes. Splitting
> it into `routes/` modules is a large pure-refactor with real regression risk —
> and the automated tests currently exercise only ~15 of the 119 routes, so a
> blind split could silently break untested endpoints. This is deliberately left
> as a guided refactor to do **incrementally, behind the growing test suite**,
> rather than in one risky pass.

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
