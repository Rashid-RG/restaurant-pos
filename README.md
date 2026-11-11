# GastroFlow — Restaurant POS, Ordering & Operations

GastroFlow is a multi-restaurant restaurant-operations platform maintained by **Mohammed Rashid ([Rashid-RG](https://github.com/Rashid-RG))**. It combines a staff POS, kitchen display and management workspace, a customer ordering application, a driver application, and a shared Express API.

> **Review refreshed: 11 November 2026, `codex/production-readiness`.** Features described below are present in source, not a guarantee that every integration, device, payment provider, or tenant workflow is certified. The system has a working live Render deployment and passed automated CI on the inspected release; it still requires verified production backups, end-to-end acceptance, hardware tests and concurrency/load testing. Earlier historical reports claiming unconditional “production ready” status must not be treated as current certification.

## Applications and architecture

| Component | Source | Built route / purpose |
| --- | --- | --- |
| Staff POS + owner/manager administration | `src/` | `/` |
| Customer web ordering/tracking | `apps/customer-web/` | `/customer/` |
| Driver delivery application | `apps/driver-web/` | `/driver-app/` |
| Shared backend | `server.js`, `routes/`, `lib/` | Express HTTP API and SSE |
| Common components and device CSS | `shared/` | Shared UI, responsive styles |
| Automated checks | `tests/`, `scripts/`, `.github/workflows/verify.yml` | Vitest, all app builds, production boot smoke |

**Stack:** Node.js 24, React 18, Vite, Express 4, SQLite-compatible SQL, JWT/roles, and server-sent events. The production-oriented remote storage option uses a *compatible libSQL/Turso database* via `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Local SQLite is available for isolated development. The unfinished PostgreSQL adapter is not an approved production cutover.

## Feature guide

These descriptions distinguish a source-implemented screen from full real-world verification.

| Area | Features in current branch | Notes |
| --- | --- | --- |
| POS & checkout | Dine-in, takeaway, delivery orders; tables, modifiers, discounts, tender/receipts, cash/card/manual settlement | Table merging is deliberately disabled pending a corrected settlement flow; validate configured payment provider |
| Kitchen (KDS) | Kitchen tickets, workflow status, order preparation and hand-off | Validate device notifications and real-time reconnects on site |
| Orders & deliveries | Dispatch, driver app, tracking and delivery evidence | Verify GPS/device permissions and offline/retry behavior |
| Menu & inventory | Menu, ingredients, recipes, supplier/purchase operations, stock counts and waste | Validate receiving, wastage and order-linked stock with real store scenarios |
| Customers & support | Customer accounts, ordering, loyalty, support messaging | Protect private guest access and tracking capabilities |
| Sales & reporting | Dashboard, separate **Sold Items**, expenses, shift reports, CSV exports | Sold Items displays **gross item values**, not net revenue or profit; discounts, taxes and refunds require separate reconciliation |
| Restaurant settings | Per-restaurant settings, selectable **IANA time zone**, receipt/printer options and staff account administration | Stored event timestamps remain absolute; displayed dates use restaurant settings where integrated |
| **My Attendance** | Large clock-in / clock-out action, active-shift elapsed time, personal recent history | Accessible to authenticated staff. Clock out asks for confirmation |
| **Staff & Payroll** | Staff profiles, hourly/monthly pay, allowances/deductions, attendance history, draft monthly payroll, recorded paid status | Manager/owner access. **No automatic wage transfer, statutory tax withholding or filings**; payroll values are estimates |
| **Manual Attendance** | Owner/manager enters a missing completed clock interval, reason and attributable audit record | Overlaps are rejected. Entry uses the input device's local time; review timezone differences before saving |
| **Cash Drawer** | Staff opening float, cash in/out, closing counted cash, shift expected cash, differences and daily sales report | Drawer cash is **not** the same as daily gross revenue; card/online/driver collections do not automatically enter a cashier's drawer |
| Platform/SaaS | Tenant provisioning, platform-owner capabilities and gated subscription billing | Subscription collection is separately feature-flagged and provider-dependent |

### Daily operating workflow

1. **Staff attendance:** Each worker opens **My Attendance** and clocks in. Owners/managers can go to **Staff & Payroll → Attendance** to add missing completed sessions with an explanation and review the manual-entry audit log.
2. **Open the physical drawer:** A cashier opens **Cash Drawer**, counts the opening change/float and enters that amount. This creates an existing `shifts` record for the signed-in employee.
3. **Operate the POS:** Record sales using normal settlement flows; enter paid-outs or cash added to the drawer as cash movements. Cash-only amounts affect expected drawer cash; card and online tenders do not.
4. **Close and balance:** Count the physical cash, enter the counted amount, and confirm shift closure. The shift stores expected cash, actual cash and discrepancy. The daily report shows per-shift reconciliation alongside separate paid-sales totals.
5. **Review payroll:** Owner/manager configures compensation, checks completed attendance and creates a monthly **draft**. Confirm actual obligations and payments outside the app; the “Mark paid” action records an acknowledgment, **not** a transfer.

**Caution:** Cash Drawer reports group shifts by the restaurant-local day **on which each shift opened**, while the paid-sales summary uses settlement dates. Overnight shifts, refunds, partially settled invoices and cross-shift handovers need manual reconciliation before financial close. The report is not a bank or accounting-system statement.

### Roles and multi-restaurant boundaries

Signed-in employee requests derive their tenant from the authenticated identity, and the newer staff/payroll/workday endpoints filter data by restaurant. **Staff & Payroll** and manual attendance require owner/manager roles; only an owner may mark a payroll record paid. **My Attendance** exposes the signed-in employee's recent attendance. Cash Drawer reporting is scoped to the restaurant and to the employee for non-management roles.

The repository contains tenant isolation and route-level tests. **This is not evidence of unlimited restaurant capacity, perfect authorization on every historical endpoint, or crash-free parallel use.** Run realistic two-tenant and concurrent-payment tests before onboarding more stores. Read [SaaS release gates](docs/SAAS_RELEASE_GATES.md) and [the comprehensive review](docs/COMPREHENSIVE_REVIEW_2026-11-05.md).

## Local development

Requirements: **Node.js 24** and npm. No production database credentials are needed for isolated local development.

```bash
git clone https://github.com/Rashid-RG/restaurant-pos.git
cd restaurant-pos
git checkout codex/production-readiness
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if necessary. Replace placeholder secrets with local-only values; set `NODE_ENV=development` and point `DATABASE_FILE` to an isolated local file. **Never connect a local dev run to the live Turso database or commit credentials, backups or customer data.**

```bash
npm run start:all
```

| App | Local URL |
| --- | --- |
| POS | http://localhost:3000 |
| Customer | http://localhost:3001 |
| Driver | http://localhost:3002 |
| Backend | http://localhost:5000 |

Or build all three and run a production-style server with properly configured environment variables:

```bash
npm run build:all
npm run start:production
```

The server health endpoint is `GET /api/health`; it returns readiness only after database initialization. The production start command does **not** set `NODE_ENV` for you.

## Tests and quality checks

```bash
npm run check
npm test
npm run build:all
node scripts/production-smoke.js
npm audit
```

The GitHub **Verify** workflow on `codex/production-readiness` and pull requests installs dependencies, runs syntax checks, Vitest, all three Vite builds and a production-process smoke test on fresh isolated databases. The inspected feature release passed the full workflow on 11 November 2026 (run **43007932975**, source commit `5fc9d0e8`). This evidence applies to that commit, not automatically to later changes or live external services. A repository README edit alone does not prove fresh code validation.

Tests include time-zone boundaries, paid-item aggregation, attendance/payroll calculations, tenant/role isolation for newer routes, and cash drawer arithmetic. Test success does not certify physical printer/cutter hardware, provider webhooks, external email/SMS, high-concurrency checkout or full restore under failure.

## Database schema, backup and safe upgrades

The live system has a shared SQL database with restaurant/tenant identifiers. Startup initializes existing tables and uses additive `CREATE TABLE IF NOT EXISTS` for newer modules. Recent modules include:

| Table | Data |
| --- | --- |
| `staff_profiles` | Tenant-specific employee profile attributes |
| `staff_compensation` | Pay type, rate, allowance and deduction |
| `staff_payroll_records` | Monthly payroll snapshots and payment acknowledgment |
| `manual_attendance_audit` | Manager-attributed manual attendance entries |

Attendance is linked to existing `timeclock_entries`, and drawer opening/closing uses existing `shifts` and `cash_movements` records. **The new feature schema is additive; this does not guarantee that all historical startup migrations are reversible.**

For a **remote libSQL/Turso logical backup** on an authorized machine, configure the existing production connection securely, choose a protected output directory and run:

```bash
npm run backup
node scripts/verify-restore.js /secure/path/to/gastroflow-BACKUP.json
```

The verifier restores to a **new local database only**, checks a checksum and verifies row integrity; it does not restore over live data. For an ordinary local SQLite file, `npm run backup` produces a verified `.db` backup. Protect backups because they contain sensitive customer and staff records; keep an **off-host encrypted copy**, and test your actual recovery procedure. Do **not** run `npm run backup` inside an ephemeral Render instance and assume the backup will survive its replacement. A verified backup for the live Turso database has **not** been established as part of this README review.

**Safe upgrade sequence:** take a verified off-host backup → test restoration into a disposable database → confirm the target Render branch and database URL → use a separate staging database for migration acceptance → deploy manually → check `/api/health`, database startup logs and business workflows → monitor/errors/rollback plan. **Rolling back the app binary is not a database restore.** No reset, destructive seed or live DB overwrite is authorized by README instructions.

## Render deployment

The actively used service is named **`gastroflow-staging`**, despite the staging-like name:

- URL: https://gastroflow-staging.onrender.com
- Render service ID: `srv-dblpvdt9el5s73eebt0g`
- Git branch: `codex/production-readiness`
- Automatic deploy: **off** (GitHub commits alone do not update the running service)
- Build: `npm ci --include=dev && npm run build:all`
- Start: `npm run start:production`
- Health check: `/api/health`

During the 11 November 2026 review, Render reported commit **`5fc9d0e8`** as live and a successful manual deployment. This is a timestamped observation, not a permanent live-status guarantee. The existing free, single-instance service is **not** a multi-instance, high-availability production topology; plan for cold starts, resource limits and managed backups. Use the [deployment guide](docs/DEPLOYMENT_GUIDE.md) for full environment requirements. `render.yaml` is an example and does not itself change the existing service.

Never commit `JWT_SECRET`, `CUSTOMER_JWT_SECRET`, `TURSO_AUTH_TOKEN`, PayHere credentials or actual employee/customer data. Enable payment/subscription integrations only after sandbox validation and merchant approval.

## Current review findings and known limits

1. **Recovery remains the top priority.** Source code includes a backup/export and isolated restore verifier, but the live Turso restore point was not independently verified here. Capture and rehearse recovery before risky upgrades.
2. **Cash reconciliation requires operational acceptance.** The new drawer screen uses legacy cashier settlement and manual payment/refund ledgers and separate day/shift windows. Verify split tenders, carry-over floats, paid-outs, handovers, refunds, overnight shifts and drawer hardware with real cashiers.
3. **Time and payroll policies need review.** Manual attendance entry currently interprets `datetime-local` using the device time zone, then displays restaurant-local times; managers working in other zones must check entries carefully. Pay estimates do not automatically apply employment-law rules, overtime, leave, tax or provident-fund contributions.
4. **Multi-tenant load remains unproven.** The newer APIs have tenant isolation tests and one process serializes database transactions. This does not establish safe throughput or availability under many simultaneous stores, cashiers and delivery clients.
5. **Provider/device checks are not complete.** Finish PayHere sandbox/live callback verification, thermal printers and cutters, driver GPS, push/SSE reconnects and offline retry acceptance. Table merging stays disabled.
6. **Historical documentation is not authoritative for today's release.** Documents such as `DEPLOYMENT_READINESS.md`, `PRODUCTION_VERDICT.md` and `TENANCY_IMPLEMENTATION.md` reflect older code snapshots and can contain outdated counts, paths or readiness claims. Prefer this README, actual source and newer [SaaS release gates](docs/SAAS_RELEASE_GATES.md).
7. **Review scope:** This update was based on connected GitHub source files, project audit documents, prior CI results and Render deployment metadata. It was **not** an exhaustive line-by-line security audit, physical device test, live payment audit, direct SQL inspection of Turso, penetration test or controlled load test.

## Reference documents

- [Latest comprehensive review (snapshot)](docs/COMPREHENSIVE_REVIEW_2026-11-05.md)
- [SaaS release gates](docs/SAAS_RELEASE_GATES.md)
- [Production launch plan](docs/PRODUCTION_LAUNCH_PLAN.md)
- [Deployment guide](docs/DEPLOYMENT_GUIDE.md)
- [Billing follow-up](docs/BILLING_FOLLOWUP.md)
- [Inventory operations](docs/INVENTORY_OPERATIONS.md)
- [Device responsiveness](docs/DEVICE_RESPONSIVENESS.md)
- [Microfeature inventory](docs/GastroFlow_Microfeature_Inventory.csv)
- [API route inventory](docs/GastroFlow_API_Route_Inventory.csv)

## License

[MIT License](LICENSE). Copyright © 2026 Mohammed Rashid (Rashid-RG).
