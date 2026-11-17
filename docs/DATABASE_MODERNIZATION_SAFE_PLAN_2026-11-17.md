# GastroFlow database modernization — non-destructive plan (2026-11-17)

**Scope:** the existing Turso/libSQL multi-tenant restaurant platform on `codex/production-readiness`. A restaurant is operating the POS. This plan does **not** authorize a migration, live SQL, service restart, or deployment.

## What currently exists
- The active remote storage path is Turso/libSQL, not the provisional Postgres adapter. Do not switch `DATABASE_URL` or deploy a new database driver as a shortcut.
- `lib/database-gate.js` serializes shared connection transactions.
- `scripts/backup.js` creates a logical Turso snapshot that includes **customer and sales records** and writes plaintext JSON locally with restrictive filesystem permissions. That is **not** an encrypted off-site backup by itself. Treat the file as sensitive; encrypt and protect it before moving it anywhere.
- `scripts/verify-restore.js` restores logical backups only into new local databases, checks row equivalence, integrity, and foreign keys.
- `lib/identity/customer-schema-audit.js` checks whether legacy global email uniqueness conflicts with tenant-scoped identities.
- The new `lib/schema-inventory.js` is a read-only schema metadata collector. It is **not called at runtime** and has no Turso credentials or connection creation. Tests use disposable in-memory SQLite.

## Next steps in strict order
1. **Inventory in isolation.** With a *separately approved, read-only* credential or restored local copy, pass a read-only `dbAll` provider to `inspectDatabaseSchema`. Inspect table/column/index/foreign key metadata. Do not output customer rows or share snapshot contents.
2. **Establish recoverability.** Create a timestamped, encrypted, access-controlled backup; verify the snapshot hash, then restore to a **new disposable local database** using `scripts/verify-restore.js`. Record record counts and tenant totals privately. A successful backup *without* a restore drill is not sufficient.
3. **Identify tenant risks.** Review tables without a `tenant_id` (some are legitimately global), and tables with global unique constraints even when `tenant_id` is present. In particular, inspect historical `customer_accounts.email UNIQUE` and relations from orders, loyalty, staff, addresses and payments. `globalUniqueIndexCandidates` is a warning, not proof of an exploitable defect.
4. **Design additive changes only.** Introduce a versioned migration manifest with prechecks and an append-only migration ledger on a disposable copy first. Use tenant-scoped indexes only after analyzing the actual query workload; avoid guessed indexes that slow order writes.
5. **Rehearse high-risk schema updates exclusively on clones.** SQLite constraint replacement often needs a table rebuild. Preserve IDs, invoice sequences, foreign keys, triggers, unique constraints, and dependent views; rehearse rollback and compare row hashes plus per-tenant sales totals.
6. **Test the business contracts.** Verify two-tenant isolation, cash settlement, payments, stock, offline POS recovery, receipt printing, staff roles, customer OTP/login, scheduled orders, delivery tracking, and restore checks.
7. **Release gate.** Present the schema diff, migration timing, rollback/restore evidence and staging acceptance report for explicit approval. Never run a production schema migration as part of ordinary boot or CI.

## How to use the inventory safely
The programmatic API is `inspectDatabaseSchema(dbAll)`, imported from `lib/schema-inventory.js`. `dbAll` must be an **externally supplied read-only query function** against a restored copy or properly limited account. The helper executes only `SELECT` against SQLite schema metadata and `PRAGMA table_info/index_list/index_xinfo/foreign_key_list`; it reads no customer rows. Do **not** invoke it automatically against the active Turso database.

For a **restored, existing local database file only**, run `node scripts/inventory-local-schema.js /path/to/restored-copy.db`. The command refuses missing paths and remote URLs, opens SQLite with `OPEN_READONLY`, and prints structural metadata only. Do not direct it at the restaurant's active database file.

Run `node scripts/check-local-database-health.js /path/to/restored-copy.db` on the same **existing offline restored copy** to test SQLite integrity and foreign key relationships. The checker refuses remote URLs, missing paths and symlinks, uses `OPEN_READONLY`, and prints only aggregate health results. It is not a replacement for the encrypted backup verification and restore rehearsal.

## Offline index coverage review

The current `server.js` already declares `idx_orders_tenant_timestamp`, `idx_orders_tenant_status`, and related tenant-aware order indexes. Do **not** blindly add replacement indexes or remove existing ones.

`reviewIndexCoverage(inventory)` in `lib/index-coverage-review.js` is a pure advisory function. Supply the result of `inspectDatabaseSchema(dbAll)` from a **restored, isolated local database**. It identifies whether a few known order, manual-payment, and timeclock access patterns have a usable left-most column prefix, while excluding partial indexes from general coverage. It flags potentially overlapping non-unique indexes for *manual review only*. It generates and runs no SQL.

An index recommendation is NOT ready for deployment until:
1. Inspect the actual restored schema, query frequency, and indexes (including collation, DESC order, expression keys and partial predicates).
2. Compare `EXPLAIN QUERY PLAN` and representative read/write performance on a **disposable** local copy; confirm improvement under restaurant-relevant tenant sizes.
3. Check impact on POS order writes, stock changes, account registrations, and all tenant access paths.
4. Rehearse backup, restore, rollback, and two-tenant tests; seek explicit approval for any staging schema update.

## Offline tenant foreign-key review

`inspectDatabaseSchema(dbAll)` now retains foreign-key sequence ordering so composite constraints can be evaluated correctly. Use `reviewTenantForeignKeys(inventory)` from `lib/tenant-foreign-key-review.js` against the inventory of a **separate restored database copy**. This pure function makes no SQL calls and inspects no customer rows.

For relationships where both tables have `tenant_id`, it differentiates a composite foreign key containing child and parent `tenant_id` from an ID-only link. It flags ID-only relationships for **manual review**, not as a proven isolation vulnerability: globally unique IDs, route-level authorization, and deliberate cross-table relationships can change the risk. References to global tables are recorded separately and should not be blindly rewritten. Do not add foreign keys, rebuild tables, or rewrite historical tenant IDs without a verified backup, application contract tests, and explicit approval.

## Disposable-only versioned migration rehearsal

`lib/migration-rehearsal.js` now provides `rehearseMigrations({seedStatements, migrations})`. It **constructs its own `:memory:` SQLite database**; it accepts no external connection, file path, Turso URL, or secrets. It is not linked into `server.js`, runtime startup, or any deployment script. A fixture supplies synthetic restaurant/order data. Each migration has an immutable `0001_description` version, a SHA-256 checksum of statements, and a ledger row, all applied inside a transaction. Repeating a matching version is idempotent; reusing a version with different SQL fails. Each operation performs SQLite integrity and foreign-key validation before committing, and errors roll back that transaction.

The rehearsal intentionally permits only *single-statement additive* `ALTER TABLE ... ADD COLUMN` or `CREATE INDEX IF NOT EXISTS` operations. It rejects deletes, drops, updates, and other destructive SQL. This is a testing foundation, **not** a licensed production migration engine; it does not establish that a real-data table rebuild would be safe. Never import it into the runtime database boot path or point migration code at the live Turso URL. Any future production migration runner needs independent approval, backup and restore drills, tenant reconciliation, and release controls.

## Offline before/after schema comparison

`compareDatabaseSchemas(before, after)` in `lib/schema-diff.js` accepts two `inspectDatabaseSchema` inventories captured from **isolated local database copies**. It is a pure function: no database connection, records, SQL execution, credentials, DDL generation, or live Turso access. Differences are classified for review: added/removed tables and columns, column type/nullable/primary-key changes, indexes and uniqueness, foreign-key relationships, and changes to tenant scope or global unique-index candidates.

High-risk flags do not automatically mean a migration is unsafe; equally, an additive-only diff is not proof of safety. Validate the source/target schema against actual restored data, billing/invoice identity continuity, per-tenant balances and record counts, query benchmarks, and restore/rollback rehearsal before requesting staging approval. This comparator is **not** a deployment migration runner. It cannot prove that an existing table rebuild will preserve data.

## Consolidated offline migration assessment

Export **schema metadata only** from two isolated, existing local database copies using `scripts/inventory-local-schema.js`, storing the JSON outputs privately. Then use:

```bash
node scripts/assess-local-schema.js before-schema.json proposed-schema.json
```

This command accepts only two existing local, non-symlink JSON files under 5 MiB. It never opens a SQLite/Turso connection, sends records to a service or writes files. The pure function `assessDatabaseMigration(before, proposed)` combines the before/after schema diff, possible index coverage gaps, overlapping-index candidates, global uniqueness candidates, and tenant foreign-key warnings into one advisory JSON report. Release gates remain `false` until separately verified; a clean report is **not** approval to migrate or deploy.

Always perform actual-data restore reconciliation, query-plan benchmarking, tenant authorization tests, backup retention verification, a rollback rehearsal and obtain explicit staging approval before any real database mutation.

## Recovery-path file safety hardening

The offline schema inventory now refuses symlink, non-regular, missing, and extra-argument paths before opening SQLite in read-only mode. The logical backup restore command now rejects remote URL input/destination strings, symlinked backup inputs, destination paths equal to the backup source, and existing destination paths. It **restores into a private temporary directory** and publishes the verified file using an exclusive hard link on the same filesystem, so an existing destination cannot be overwritten and a failed restore never appears at the requested output path. Restoration continues only to a newly created local database and still validates logical row equivalence, integrity, and foreign keys.

**Operator cautions:** the tool still reads sensitive plaintext logical backups and produces a restored local database containing customer data. Use only approved offline copies in a secure, access-controlled environment. Temporary incomplete restores are cleaned up on failure, but operators must still safeguard the source plaintext snapshot and any successfully restored database as sensitive customer data. A successful test with synthetic data is not proof that the live Turso dataset has a verified recovery copy.

## Offline restore reconciliation (additional recovery evidence)

After a separately authorized logical backup has been securely restored to a **new, isolated local database**, compare it to the original backup without connecting to Turso:

```bash
node scripts/reconcile-local-restore.js existing-local-backup.json verified-restored-copy.db
```

The command opens the existing restored copy with `sqlite3.OPEN_READONLY`, verifies the snapshot's SHA-256 hash, compares canonicalized full table row contents (including BLOB values) without regard to row order, and prints **table names, record counts, and match flags only**. It never prints customer records or order IDs. A mismatch sets a nonzero exit status; a success is one recovery gate, not authorization for migration. The source logical backup **remains plaintext and contains sensitive customer and sales information**. Keep it inside a secure, access-controlled operator environment and never commit it to GitHub or publish it in CI logs. The reconciliation command also executes read-only `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, fails if either detects problems, and reports only an integrity status and violation count (never foreign-key row IDs). The full report's `ok` status requires **both row equality and database structural integrity**. This tool does not validate encrypted archive retention, live Turso data freshness, or per-tenant financial reconciliation; those remain separate acceptance gates.

## Current acceptance
- [x] Non-mutating schema inventory implemented
- [x] In-memory tests for tenant uniqueness, metadata escaping and no row exposure added
- [x] Local-only, read-only schema CLI and safety tests committed
- [x] Offline restored-copy database health checker and isolated regression tests committed
- [x] Pure index-coverage review and disposable-database tests committed
- [x] Offline tenant foreign-key relationship review and composite-key tests committed
- [x] Versioned in-memory additive migration rehearsal and rollback regression tests committed
- [x] Pure offline before/after schema diff with tenant-risk and index regression tests committed
- [x] Consolidated offline assessment CLI and risk-report tests committed
- [x] Read-only restored-copy row reconciliation and privacy regressions committed
- [x] Recovery file-path and atomic new-destination protection regression tests committed
- [ ] Full GitHub Actions results for the latest change
- [ ] Approved read-only inventory of actual customer schema
- [ ] Encrypted backup and verified restore of a live-data snapshot
- [ ] Clone-only migration and rollback rehearsal
- [ ] Two-tenant E2E tests and printer acceptance
- [ ] Explicit staging deployment/migration approval

**No live database was inspected or modified in this development phase.**
