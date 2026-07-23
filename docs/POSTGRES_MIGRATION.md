# PostgreSQL Migration Plan (Phase 3)

> **Status: NOT DONE — groundwork only.** The live database is still SQLite. This
> document is the actionable cutover plan. It **must be executed and validated
> against a real PostgreSQL instance** — it was not run in the analysis sandbox
> (no Postgres server, `psql` not installed, `DATABASE_URL` unset). Do not point
> production at Postgres until the checklist below passes.

## Why not already done

`server.js` talks to SQLite directly (`new sqlite3.Database(...)` + hand-rolled
`dbRun/dbAll/dbGet`). A correct Postgres cutover is bounded but real, and it
changes the money/data path, so it needs to be validated by running the app +
the test suite against Postgres — which this environment can't do. Shipping an
unvalidated cutover would risk breaking the working SQLite app.

## Migration surface (measured against current `server.js`)

| Item | Count | Action |
|---|---|---|
| Query call sites (`dbRun/dbAll/dbGet`) | 406 | Route through `lib/db_adapter.js` (`?`→`$n` handled) |
| Double-quoted string literals (`= "paid"`) | 38 | **Rewrite to single quotes** — Postgres reads `"paid"` as an identifier |
| `INSERT OR REPLACE` | 7 | → `INSERT … ON CONFLICT (<pk>) DO UPDATE SET …` |
| `INSERT OR IGNORE` | 4 | → `INSERT … ON CONFLICT DO NOTHING` |
| `PRAGMA …` | 4 | SQLite-only — skip when on Postgres |
| `AUTOINCREMENT` | 0 | none — good |
| `datetime()` / `strftime()` | 0 | none — timestamps are epoch millis (`Date.now()`), portable — good |

Everything else (parameterized queries, `CREATE TABLE IF NOT EXISTS`, the
composite-PK `settings` table, `ALTER TABLE ADD COLUMN`) is broadly compatible,
though types differ (`REAL`→`double precision`, `INTEGER`/text as-is).

## Cutover steps

1. **Dialect-neutralize the SQL in `server.js`** (do this first, keep running on SQLite):
   - Replace the 38 double-quoted string literals with single quotes. Grep:
     `grep -nE '= *"[a-z_]+"' server.js`.
   - Convert the 7 `INSERT OR REPLACE` and 4 `INSERT OR IGNORE` to `ON CONFLICT`
     forms (each needs its conflict target = the table's PK/unique key).
   - Guard the 4 `PRAGMA` calls so they only run on SQLite.
   - Re-run `npm test` (still on SQLite) — must stay green.

2. **Route DB access through the adapter.** Replace the direct `sqlite3` handle +
   `dbRun/dbAll/dbGet` with `lib/db_adapter.js` (`query` for SELECT, `execute`
   for writes). Keep the same helper names so call sites don't change:
   ```js
   import { query, execute } from './lib/db_adapter.js';
   const dbAll = async (sql, p) => (await query(sql, p)).rows;
   const dbGet = async (sql, p) => (await query(sql, p)).rows[0];
   const dbRun = (sql, p) => execute(sql, p); // {changes,lastID}
   ```
   Note: `lastID` isn't available on Postgres — the codebase already generates its
   own string ids (`ord_…`, `drv_…`), so this is only relevant for the
   `invoice_counter` path (which uses an explicit counter row, not lastID) — verify.

3. **Migration tooling.** Add `node-pg-migrate` (or Prisma Migrate). Author
   migration `001_init` from the current schema with `tenant_id` present from the
   start on every scoped table (`users, orders, menu_items, tables, ingredients,
   customers, categories, modifiers, recipes, shifts, cash_movements, feedbacks,
   promotions, customer_accounts, drivers`) and the composite-PK `settings`
   table. The existing `initTables()` becomes the SQLite-dev fallback only.

4. **Validate against Postgres.**
   ```bash
   docker run -d --name gf-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
   export DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
   npm run migrate up      # once tooling is added
   DATABASE_URL=$DATABASE_URL npm test   # integration tests must pass on PG
   DATABASE_URL=$DATABASE_URL npm run server   # boot + two-tenant smoke
   ```

## Done-when (Phase 3 data-layer acceptance)

- [ ] SQL is dialect-neutral; `npm test` green on SQLite.
- [ ] App boots on Postgres via `DATABASE_URL`; `/api/health` reports connected.
- [ ] `tests/integration.test.js` (auth + payment webhook + lifecycle + driver)
      passes with `DATABASE_URL` set.
- [ ] Two-tenant smoke (menu/settings/SSE isolation) passes on Postgres.
- [ ] Versioned migrations run cleanly on an empty database.

Until every box is checked, keep SQLite as the live path.
