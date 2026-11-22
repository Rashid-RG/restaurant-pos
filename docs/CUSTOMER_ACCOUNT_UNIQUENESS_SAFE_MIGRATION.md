# Customer account uniqueness: live-store-safe migration plan

Status: **research and read-only diagnostics only**. Do not execute a migration automatically.

## Critical operating constraints
A restaurant is actively using GastroFlow POS. Preserve all existing orders, sales, invoices, receipts, accounts, sessions and staff access. Do not apply schema changes or deploy the architecture branch without explicit owner approval. Keep the current staging and Turso database untouched.

## Existing compatibility issue
`server.js` contains two historical `CREATE TABLE IF NOT EXISTS customer_accounts` declarations. One has `email TEXT UNIQUE NOT NULL`, which can create a database-wide email index. The later tenant-aware declaration does not remove constraints on an already existing table. Registration now checks duplicate accounts within a tenant and gracefully handles the legacy unique constraint, but the constraint itself may still prohibit using the same email at multiple restaurants.

## Read-only diagnostics
`inspectCustomerAccountSchema(dbAll)` in `lib/identity/customer-schema-audit.js` uses only:
- `PRAGMA table_info(customer_accounts)`
- `PRAGMA index_list(customer_accounts)`
- `PRAGMA index_info(...)`

It reads *schema metadata only*, not customer records, and performs no writes. It is not invoked on application startup or on any live API request. No automatic migration is included.

## Required acceptance before any migration
1. Establish an encrypted, independently restorable snapshot of the database, with order counts, invoice continuity and per-tenant customer counts checked on a **separate copy**.
2. Inventory legacy global UNIQUE(email), NOT NULL(email), other indexes, foreign-key relationships and any customer references (orders, loyalty, addresses, reset tokens, CRM links) on that copy.
3. Design a tenant-scoped unique index for normalized email plus an appropriate tenant-scoped phone strategy. Account for historical duplicates, blank emails, case folding, and user authentication assumptions.
4. Test a **full table-rebuild migration only on disposable copies**, with migration rollback rehearsals and no orphaned foreign keys or changed account IDs.
5. Exercise customer registration, login, OTP, session recovery, password reset, POS cashier/customer lookup, loyalty, receipt printing and sales reporting across multiple tenants.
6. Schedule a reviewed, separately approved change window with an immediate revert plan. Never auto-run schema rebuilding during normal server boot.

**Current action:** retain the original database schema, add read-only diagnostics and test coverage only. This document does not authorize any rollout.
