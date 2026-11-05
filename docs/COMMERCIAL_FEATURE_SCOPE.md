# Commercial feature and UI scope

Updated 5 November 2026. This is the delivery scope for GastroFlow's staff, customer and driver applications and platform administration. It distinguishes working code from unfinished workflows. A screen, a passing local test or a healthy deployment alone does not certify production readiness. The detailed historical microfeature inventory remains useful, but newer release-gate documents take precedence for status.

## Feature-to-screen map

| Area | Implemented foundation / current UI | Remaining feature and UI work | Acceptance evidence required |
| --- | --- | --- | --- |
| Counter POS | Menu/cart, cash shifts, saved partial cash/bank receipts, balances, server totals and final receipts; responsive payment dialog | Partial-receipt reversal, mixed/bank refund reconciliation, safe table merge/transfer, manager approvals with reasons, consistent discount/tax/rounding presentation, cash close variance review | Mixed tenders, simultaneous settlement, reconnect, refund, shift close and real receipt printer |
| Tables and service | Tables and dine-in ordering foundation | Visual floor plan, reservations/waitlist, seating/course controls, table occupancy and safe bill ownership transitions | Two waiters changing a table concurrently; no lost orders or duplicate bills |
| Kitchen | Persisted station routing, per-item preparation, elapsed timers, notes/modifiers and paid-but-unfulfilled tickets | Started-ticket amendment/reconciliation, structured allergy metadata, course firing, expediter controls and alert preferences | Order placed/edited/paid/cancelled while preparing; every required item stays visible until fulfilled |
| Inventory | Raw ingredients/menu stock; new supplier, purchase, receipt, count, waste, recipe and history screens | Supplier credits/returns, invoice matching, reorder suggestions, yield and batch/expiry tracking, broader legacy adjustment journal coverage | Transaction rollback, tenant isolation, replay, shortages and stale counts; physical count reconciliation |
| Menu management | Items, availability, categories and ingredient recipes | Modifier groups and limits, variants, allergen/dietary labels, timed menus, multi-channel pricing and sold-out explanation | One pricing/availability rule across POS/customer/group/offline workflows |
| Customers and ordering | Restaurant discovery, menu/cart, account, loyalty foundation, private group cart, checkout recovery, tracking and support | Scheduled slots/capacity, reservation integration, complete group delivery form, promotion controls, verified notifications and self-service account lifecycle | Real device checkout, private retry after disconnect, capacity contention and no duplicate charges |
| Delivery | Assignment, driver app, browser location, order chat and private proof workflow | Reconnect-safe location history, stale-GPS indication, delivery zones/ETA validation, assignment escalation, durable offline queue and cash handover reconciliation | Real mobile background/location permissions, poor connectivity, reassignment and proof retry |
| Restaurant SaaS | Separate tenant owners, staff roles, platform provisioning, plan limits and subscription UI foundation | Provider-certified subscriptions/renewals/dunning, plan change/proration, complete usage metering, self-service onboarding and owner transfer | Cross-tenant API/report/export/event tests; real subscription lifecycle and account recovery |
| Platform administration | Audited support access, readiness, recorded financial activity and snapshot tools | Full platform reconciliation, tenant lifecycle/export/deletion, operator approvals and support-access retention policy | Reconciliation against provider statements, audited support drill and access revocation |
| Reports | Sales and operational reporting foundation | Consistent net/gross/tax/refund definitions, restaurant/business-day filters, scheduled exports, stock valuation and margin reconciliation | Reports reconcile with immutable source transactions across refunds, dates and tenants |
| Operations | Health endpoint, startup configuration checks, staging, logical backup/restore tooling | Durable event outbox/replay, printer spool/retry UI, off-host backup scheduling, restore drills, monitoring alerts and incident recovery | Actual alert delivery, failed-job recovery, hosted concurrency, target database restore and rollback |
| Devices and accessibility | Responsive layouts, touch controls, safe areas, zoom, shared device styles and new responsive inventory workbench | Real iOS/Safari/Android acceptance, keyboard/screen-reader audit, localization and measured accessibility fixes | Checkout/POS/kitchen/driver tasks on target devices, not only simulated widths |

## Inventory release delivered in this revision

Owners/managers use Inventory → Purchasing & stock operations. Six tabs are connected to server operations: Purchases, Suppliers, Stock counts, Waste, Recipes and Activity. Native dialogs support supplier entry, purchase entry, receipt entry and waste entry. Count lines show expected and physical quantities. Recipe lines show base units and ingredient cost. Activity includes stock movements and manager actions.

Purchases record stock commitments only. They do not send supplier messages, create payments, represent accounts payable or implement tax invoices. Receiving updates available stock, with compatible kg/g and L/ml conversions and weighted ingredient costs. Cancelling a partially received purchase closes its remainder without removing received stock. Counts reject changes when stock has moved since their snapshot. Waste rejects shortages. Saved request IDs make repeated mutations safe; an unconfirmed browser update can be retried after reload.

Details, endpoint contracts and limitations are in [INVENTORY_OPERATIONS.md](INVENTORY_OPERATIONS.md).

## UI requirements for every subsequent feature

- Show loading, empty, validation, permission, unavailable and recovery states with meaningful actions.
- Present actual server state. Never show payment, delivery, notification or save success based only on a client click.
- Protect multi-step writes against duplicate submission and response loss. Explain an uncertain outcome and recover it before starting another operation.
- Keep essential actions reachable on phone, tablet, landscape and desktop. Support touch, keyboard, zoom and reduced motion; use motion to explain state without delaying service.
- Show restaurant context, role, units, currency and timezone where relevant. Independent owners must never receive another restaurant's data.
- Provide an audit trail for money, stock and privileged actions, with useful references and reasons.

## Delivery order and release gates

1. Validate inventory and the new [cash/bank/kitchen increment](CASH_BANK_SERVICE_READINESS.md) on staging.
2. Finish remaining money exceptions: partial-receipt reversals, mixed/bank refunds, safe bill/table merge and printer recovery.
3. Validate the new independent station/item fulfillment workflow on actual kitchen devices and finish started-ticket amendment handling.
4. Finish customer scheduling and driver reconnect/cash-handover workflows.
5. Complete SaaS billing, onboarding, metering and platform reconciliation.
6. Run external acceptance: hosted concurrent transactions, original-data migration/restore, merchant lifecycle, actual printers/phones, notifications and monitoring.

These are outstanding deliverables, not declarations that every commercial feature is present. Main/original production remains separate until migration and operational gates pass. See [SAAS_RELEASE_GATES.md](SAAS_RELEASE_GATES.md) and [PRODUCTION_LAUNCH_PLAN.md](PRODUCTION_LAUNCH_PLAN.md).
