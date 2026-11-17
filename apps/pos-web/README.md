# GastroFlow POS application boundary — incremental migration

**Live-store safety:** A restaurant is actively operating GastroFlow POS. The existing POS entrypoint, Vite root, asset URLs, receipt printing, server API paths, and deployment configuration MUST remain unchanged until an explicitly authorized, tested rollout. No deployment or database writes are part of this change.

## Current runtime (unchanged)

- Root `index.html` loads `/src/main.jsx`.
- `src/App.jsx` is the POS application and continues to control the shop and platform-owner views.
- `vite.config.js` and `npm run build` still build the existing POS.
- The running restaurant's sales, logins, receipts and thermal print paths are unaffected by this repository-only refactor.

## Proposed new application root

`apps/pos-web/src/App.jsx` currently re-exports the existing app, **not** a separate independently deployable POS. The first genuinely moved utilities are `staff-session.js`, `kitchen-recovery.js`, `sold-items.js`, and `offlineSync.js` under `apps/pos-web/src/utils/`. Each corresponding `src/utils/` path remains a compatibility re-export, so existing callers require no changes. The moved sold-items utility still imports the original restaurant-time helper without changing its timezone calculations.

## Safe incremental move checklist

1. Move self-contained POS-only utility modules, one at a time, with compatibility exports and unit tests.
2. Inventory asset, CSS, printer, storage, provider, and server-side imports before moving visual components.
3. Prepare an isolated POS build root, preserving the existing output filenames, manifest, asset paths, API proxy and deployed URL.
4. Compare built contents and run POS checkout, kitchen, receipt printing (58mm/80mm), staff login persistence and tenant isolation regression suites.
5. Test on staging and on a separate, non-customer dataset only after explicit approval.
6. Switch the build entrypoint only after owner approval and an identified rollback method. **Never silently deploy.**

This initial organization step does not change the active Vite entrypoint or any database schema.

The offline sales queue uses the original tenant-specific localStorage keys and unchanged server acknowledgement behavior. The original import path remains a re-export of the single canonical module so no duplicate in-memory queue or extra connectivity listener is created.

## Component boundary (incremental)

`apps/pos-web/src/components/SupportTicketsView.jsx` now owns the POS support-ticket view. The previous `src/components/SupportTicketsView.jsx` is a compatibility re-export. Its existing `/api/tickets` data access, staff token, POS context and view selection are unchanged; root `src/App.jsx` and Vite still provide the active application entrypoint. The POS print path and sales routes were not moved.

`apps/pos-web/src/components/StoreStatusScreen.jsx` now owns the tenant suspension/deletion screen. Its previous `src/components/StoreStatusScreen.jsx` path is a compatibility re-export; tenant status polling, store switching, and bootstrap gating remain unchanged. This change does not alter tenant status or server authorization policies.

`apps/pos-web/src/components/SubscriptionBilling.jsx` owns the standalone restaurant subscription view; the former `src/components/SubscriptionBilling.jsx` remains a compatibility re-export. Payment endpoints, PayHere destination allowlist, and subscription form semantics are unchanged. No payment or POS configuration was deployed.

The manager service-exceptions workflow now resides in `apps/pos-web/src/components/ServiceExceptions.jsx`, with the former `src/components/ServiceExceptions.jsx` as a compatibility re-export. Its tenant-bound pending edit key, idempotent retry token, server-authoritative repricing, and `/api/service-exceptions/` endpoint remain unchanged. No live sale or customer database operation was executed during this refactor.

The restaurant floor-plan view is now canonically located at `apps/pos-web/src/components/FloorPlan.jsx`; `src/components/FloorPlan.jsx` remains a compatibility re-export. Existing table add/delete, order assignment, transfer/merge request paths and POS navigation behavior are unchanged. This move does not fix or alter existing floor-plan QR URLs, business logic or printer behavior; those require separate review and authorization.
