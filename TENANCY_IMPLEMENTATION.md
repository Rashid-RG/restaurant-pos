# Multi-Tenancy Implementation — GastroFlow SaaS

**Date:** 2026-07-23 · **Status:** implemented + query-level isolation proven. Syntax verified (`node --check`) across `server.js` and all `lib/*.js`. Full runtime + Vitest run still to be exercised on your machine.

This document explains the multi-tenant model now in the codebase — the decisive piece that turns GastroFlow from a single-tenant app into a SaaS where each restaurant's data is isolated.

## How isolation works

**1. Identity — the tenant travels with the login.**
Every user row has a `tenant_id`. On `POST /api/auth/login` the JWT is signed with `tenant_id`, and `authenticateToken` reads it back into `req.tenantId` on every authenticated request (falling back to `default_tenant`, or an `X-Tenant-Id` header). So the server always knows which tenant a staff request belongs to.

**2. Reads are scoped.** Every tenant-scoped list/report query now carries `WHERE tenant_id = ?` bound to `req.tenantId`:
- Staff lists: `/api/orders`, `/api/customers`, `/api/menu_items`, `/api/tables`, `/api/ingredients`, `/api/users`.
- Reports: X-report, VAT, COGS, staff performance, and the shift cash-up total.

**3. Writes are stamped.** Every insert into a scoped table records the tenant: staff order creation, public/online order creation, menu items, tables, customers, ingredients, and new users all write `tenant_id`.

**4. Public/customer requests resolve their tenant.** Unauthenticated customer requests identify their restaurant via `?tenantId=<id>`, `?tenant=<subdomain>`, or the `X-Tenant-Id` / `X-Tenant-Subdomain` headers (`resolvePublicTenant()`), defaulting to `default_tenant`. The public menu is filtered and online orders are stamped accordingly.

**5. Platform vs. tenant separation.** Tenant management (`GET`/`POST /api/saas/tenants`) and the DB-inspection endpoint are now restricted to the **platform tenant** (`default_tenant`) owner via a `requirePlatformAdmin` guard — a customer tenant owner can no longer list or inspect other tenants.

## Provisioning a new tenant

`POST /api/saas/tenants` (platform-admin only) now creates the tenant **and** seeds a working owner login in one atomic transaction:

```json
POST /api/saas/tenants
{ "name": "Ceylon Spice", "subdomain": "ceylonspice", "ownerEmail": "owner@ceylonspice.lk",
  "plan": "pro", "ownerPassword": "optional", "ownerPin": "optional" }
```

Response returns the owner credentials to hand over securely:
```json
{ "id": "tenant_...", "subdomain": "ceylonspice",
  "ownerCredentials": { "username": "ceylonspice-owner", "password": "<generated>", "pin": "1234",
                        "note": "Share securely; change on first login." } }
```

The new owner logs in at `/api/auth/login`; their JWT carries the new `tenant_id`, and from that point every read/write they make is confined to their tenant.

## Proven

A query-level isolation proof (two tenants, orders + menu + customers) confirms neither tenant can see the other's orders, revenue, or menu. Codified as `tests/tenant_isolation.test.js` (5 cases) to run in CI via `npm test`.

## Known limitations / next steps

- **`settings`, `categories`, `modifiers` are still global** (no `tenant_id` column). Per-tenant branding, delivery fees, tax rates, and category lists need those columns added + scoped. Until then, those config values are shared. *(Recommended next.)*
- **Single-record reads by id** (`SELECT * FROM orders WHERE id = ?`) are not all tenant-filtered. Low risk (requires guessing another tenant's random id) but should be tightened for defense-in-depth.
- **Driver dispatch pool** (`/api/public/driver/orders`) is intentionally cross-tenant (marketplace model). If drivers should be tenant-bound, scope those two queries.
- **Data layer:** still SQLite. For real multi-tenant load, complete the PostgreSQL cutover (`lib/db_adapter.js`) with versioned migrations that include the `tenant_id` columns.
- **Runtime testing:** these changes are syntax-verified but not run end-to-end here (sandbox can't run the server/Vitest). Run `npm test` and a manual two-tenant smoke test on your machine before production.
