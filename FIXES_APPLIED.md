# Fixes Applied — Phase 0/1 Security & Quality Hardening

**Date:** 2026-07-23 · **Scope:** safe, non-breaking hardening (no multi-tenancy rewrite, no Postgres cutover — those remain open by choice). Every change was syntax-verified (`node --check` on `server.js` and all `lib/*.js`) and logic-checked where testable.

## Security fixes
- **Restored production fail-fast (A7 regression).** The boot check had been replaced by a silent hardcoded `JWT_SECRET` fallback. Re-added: in `NODE_ENV=production` the server now `exit(1)`s if `JWT_SECRET` or `PAYHERE_MERCHANT_SECRET` is missing or a known insecure default. Dev fallback is clearly labelled dev-only.
- **Fixed PayHere secret-name mismatch.** Webhook signature used `PAYHERE_MERCHANT_SECRET`; checkout used `PAYHERE_SECRET`; `.env.example` defined only the latter → payments would break in prod. Added normalization so either name works, and corrected `.env.example`.
- **Role-gated 7 privileged routes** (`requireRole`): `/api/inventory/suppliers` (GET+POST), `/api/inventory/waste`, `/api/staff/performance`, `/api/driver/cash-reconciliation` (+`/handover`), `/api/marketplace/partner-earnings`. *(db/inspect, reports, and driver create/approve were already gated by earlier edits.)*
- **Hardened the public driver status endpoint.** `/api/public/driver/status` accepted any status string (could mark an order `paid`). Now restricted to a delivery-lifecycle allow-list.
- **Stopped internal error leakage.** Added an `errMsg()` helper (generic message in production, detail in dev, always logged server-side) and replaced all **107** `error: err.message` client responses.

## Quality fixes
- **Wired Zod validation** onto `/api/auth/login`, `/api/cash-movements`, `/api/shifts/open`, `/api/shifts/close` (schemas existed but were applied to 0 routes). Numeric fields use coercion so string inputs still validate.
- **Fixed a real bug in `/api/reports/cogs`** — it referenced undefined variables (`profitMargin`, `marginPercentage`, `cogsReport`) and would throw at runtime. Now computes and returns correctly.
- **De-duplicated routes.** Removed the dead second `GET /api/orders`. For `POST /api/public/orders/:id/cancel`, removed the *inferior* copy and kept the robust transactional one (correct `menuItemId` column, frees the table, audit log + SSE). Zero remaining duplicate routes.

## Ops / secrets
- Confirmed `.gitignore` covers `.env`, `*.db*`, `node_modules/`, `dist/`.
- `.env.example` now uses safe placeholders + correct variable names + generation hint.
- Added `SECURITY_ROTATE_ME.md` — the live Gmail app password + Notify.lk key must be rotated by you (external credentials I can't rotate).

## Still open (by scope choice — larger, needs local testing)
- **Multi-tenant isolation** — the decisive SaaS blocker: add tenant-resolution middleware and `WHERE tenant_id = ?` on every scoped query.
- **PostgreSQL cutover + migrations.**
- **Test coverage** beyond billing (auth, payment webhook, tenancy) + CI gate.
- Finish `alert()`→toast in the POS UI; split `server.js` into modules.

## Verification
`node --check` passes on `server.js` and every `lib/*.js`. Confirmed: 0 duplicate routes, 0 `err.message` leaks (107 → `errMsg`), 4 routes validated, fail-fast present, 7 routes newly role-gated, validation coercion works (`"500"` → `500`). The full server run + Vitest suite still need to be exercised on your machine (the sandbox can't run them — blocked npm registry + platform-mismatched `node_modules`).
