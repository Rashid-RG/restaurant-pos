/**
 * lib/db_adapter.js — Database abstraction for the Postgres cutover (Phase 3).
 *
 * ⚠️ STATUS: groundwork, NOT yet the live path. server.js still talks to SQLite
 * directly via its own dbRun/dbAll/dbGet helpers. This adapter exists so the
 * cutover can be done incrementally and validated against a real Postgres
 * instance (see docs/POSTGRES_MIGRATION.md). Do not flip DATABASE_URL in
 * production until that checklist passes.
 *
 * Interface (Promise-based, mirrors the shapes server.js already expects):
 *   query(sql, params)   -> { rows }                     (SELECT)
 *   execute(sql, params) -> { changes, lastID, rowCount } (INSERT/UPDATE/DELETE)
 *
 * Placeholders: write SQL with `?` positional params (SQLite style). For Postgres
 * they are rewritten to $1,$2,… Note this rewrite is naive — it does not skip `?`
 * characters inside string literals, so avoid literal `?` in SQL (use params).
 *
 * DIALECT: this adapter does NOT translate SQLite-only syntax. Before enabling
 * Postgres the SQL in server.js must be made dialect-neutral (see the migration doc):
 *   - double-quoted string literals ("open") -> single quotes ('open')  [Postgres
 *     treats "open" as an identifier]
 *   - INSERT OR REPLACE / INSERT OR IGNORE -> INSERT ... ON CONFLICT ...
 *   - PRAGMA statements are SQLite-only (no-op / skip on Postgres)
 */
import pg from 'pg';
import sqlite3 from 'sqlite3';
import path from 'path';

const { Pool } = pg;

const usePostgres = Boolean(process.env.DATABASE_URL);

let dbPool;
let sqliteDb;

if (usePostgres) {
  console.log('[db_adapter] Connecting to PostgreSQL via DATABASE_URL…');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  // Honour the same DATABASE_FILE override server.js uses so tests/dev share one DB path.
  const sqlitePath = process.env.DATABASE_FILE || path.join(process.cwd(), 'restaurant.db');
  console.log('[db_adapter] Using SQLite fallback at', sqlitePath);
  sqliteDb = new sqlite3.Database(sqlitePath);
}

// Rewrite `?` positional params to Postgres `$1,$2,…`.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export const isPostgres = usePostgres;

export const query = async (sql, params = []) => {
  if (usePostgres) {
    return dbPool.query(toPg(sql), params);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve({ rows })));
  });
};

export const execute = async (sql, params = []) => {
  if (usePostgres) {
    const res = await dbPool.query(toPg(sql), params);
    return { rowCount: res.rowCount, changes: res.rowCount, lastID: undefined };
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID, rowCount: this.changes });
    });
  });
};

export async function closeDb() {
  if (usePostgres && dbPool) await dbPool.end();
  else if (sqliteDb) await new Promise((r) => sqliteDb.close(() => r()));
}
