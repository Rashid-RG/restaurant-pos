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

## Current acceptance
- [x] Non-mutating schema inventory implemented
- [x] In-memory tests for tenant uniqueness, metadata escaping and no row exposure added
- [ ] Full GitHub Actions results for this change
- [ ] Approved read-only inventory of actual customer schema
- [ ] Encrypted backup and verified restore of a live-data snapshot
- [ ] Clone-only migration and rollback rehearsal
- [ ] Two-tenant E2E tests and printer acceptance
- [ ] Explicit staging deployment/migration approval

**No live database was inspected or modified in this development phase.**
