# GastroFlow commercial multi-tenant SaaS release gates

**Status:** In development. This is a source-controlled acceptance checklist, not a certification or production-release approval. The deployed restaurant POS must continue working independently of all unreleased changes.

## Mandatory constraints
- Existing repository and `codex/production-readiness` branch; do not launch a replacement project.
- The active restaurant uses the staging service and Turso data. No destructive migrations, reset, restore, background data cleanup, or deployment without the owner's explicit release approval.
- Only isolated disposable test databases may be mutated by automated tests.
- After an approved staging release, compare before/after restaurant-level orders, customers, staff, sales totals, financial ledgers and invoices. Historical data counts alone are not sufficient proof.

## Engineering acceptance matrix

| Area | Source-level progress | Release acceptance required |
| --- | --- | --- |
| Tenant-aware login and URL mapping | Extracted authorization policy and real two-store tests | Full role × endpoint authorization matrix; cross-domain and session tests |
| Customer and driver tenancy | Order tracking guard, store isolation tests | Driver GPS + receipt privacy, customer authentication, tenant lifecycle and mobile device tests |
| POS tables and orders | Tenant predicates, safe table upsert without `REPLACE`, order ownership checks | Multi-cashier table transfer, payment and printing regression |
| Financial reports and cashier shifts | Tenant-aware report/shift queries and two-store API tests | Timezone/shift boundary tests, ledger reconciliation per restaurant |
| Manual payments and refunds | Existing tenant-bound manual ledgers and immutable triggers | Concurrency, split payments, refund idempotency, failed provider callback recovery |
| Delivery COD cash | Tenant-filtered lists, ownership/amount/replay checks | Race tests, driver-specific handover ledger, receipt level traceability |
| Platform owner administration | Ownership role separation and provisioning checks | Permission review, subscription webhook robustness, disable/re-enable lifecycle |
| Destructive administration | Legacy import/reset disabled in production and default disabled elsewhere | Offline restore rehearsal, backup retention, independent verification |
| Source architecture | Tenancy repositories/policies extracted; compatibility routes preserved | Gradual backend domain extraction, architecture dependency rules, code ownership |
| Capacity/availability | Multiple stores can serve separate test orders | Real multi-store load tests, resource metrics, overload protection |
| POS hardware | Browser/native QZ printing code present | Windows 58/80mm thermal printer, cut/feed and paper-waste acceptance |
| Native applications | Android/iOS projects and build workflows | Signed releases and real Android/iPhone acceptance |
| Observability/recovery | Infrastructure logs and database tools present | Tenant-safe audit logging, alerts, secret rotation, disaster recovery game day |

## Release criteria

1. Repository architecture guard and full CI (tests, POS/customer/driver builds, smoke) are green at the exact candidate commit.
2. No open critical/high security or data-loss findings after review; real two-tenant end-to-end financial and privilege tests pass.
3. Current staging-connected Turso snapshot is verified, with an independent restore rehearsal and documented rollback procedures. Confirm any new orders placed after the snapshot before release.
4. Owner explicitly approves **that staging commit**, scope and acceptable downtime. Do not deploy to production.
5. Post-release smoke checks: shop login, tenant URL binding, existing orders/customer counts, sales/receipt printing, staff shifts, menu and online order acceptance.
6. Monitor staging behavior and capture sign-off separately from CI. Build success alone does not prove merchant acceptance.

## Next engineering tasks (uncompleted)

1. Audit all legacy SQL and route authorization against an explicit multi-tenant route inventory.
2. Prove refund/manual-payment/COD concurrency and provider-webhook replay behavior using disposable test databases.
3. Design safe per-tenant identity/username model **without** migrating live users until rehearsal and explicit approval.
4. Move one backend domain at a time out of the 7k+ line entrypoint, maintaining compatibility contracts.
5. Test platform subscription lifecycle, account provisioning and tenant suspension under realistic scenarios.
6. Instrument performance and perform staged multi-restaurant load tests.
7. Complete dedicated hardware and native mobile real-device test plans.

**Note:** A green CI run checks only its configured tests. It is not equivalent to all commercial acceptance gates passing.
