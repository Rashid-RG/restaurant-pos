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
import path from 'path';
import { neon, Pool as NeonPool } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';

const { Pool: PgPool } = pg;

const usePostgres = Boolean(process.env.DATABASE_URL);
const isNeon = usePostgres && process.env.DATABASE_URL.includes('neon.tech');

let dbPool;
let sqliteDb;
let neonSql;
export let drizzleDb;

if (usePostgres) {
  if (isNeon) {
    console.log('[db_adapter] Connecting to Neon Serverless DB via DATABASE_URL…');
    neonSql = neon(process.env.DATABASE_URL);
    dbPool = new NeonPool({ connectionString: process.env.DATABASE_URL });
    drizzleDb = drizzleNeon(neonSql);
  } else {
    console.log('[db_adapter] Connecting to PostgreSQL via DATABASE_URL…');
    dbPool = new PgPool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    drizzleDb = drizzlePg(dbPool);
  }
} else if (process.env.TURSO_DATABASE_URL) {
  console.log('[db_adapter] Remote libSQL storage selected.');
} else {
  // Honour the same DATABASE_FILE override server.js uses so tests/dev share one DB path.
  const sqlitePath = process.env.DATABASE_FILE || path.join(process.cwd(), 'restaurant.db');
  console.log('[db_adapter] Using SQLite fallback at', sqlitePath);
  // Open only if this adapter is actually used; server.js owns the live SQLite connection.
  sqliteDb = null;
}

// Rewrite `?` positional params to Postgres `$1,$2,…`, sanitize string quotes, and convert multi-argument MAX(a, b) -> GREATEST(a, b)
function toPg(sql) {
  let i = 0;
  let pgSql = sql
    .replace(/=\s*"([^"]+)"/g, "= '$1'")
    .replace(/\bIN\s*\(\s*"([^"]+)"\s*\)/g, "IN ('$1')")
    .replace(/\bMAX\s*\(\s*([^,\)]+)\s*,/gi, 'GREATEST($1,');
  return pgSql.replace(/\?/g, () => `$${++i}`);
}

export const isPostgres = usePostgres;

export const query = async (sql, params = []) => {
  if (usePostgres) {
    if (neonSql && neonSql.query) {
      const res = await neonSql.query(toPg(sql), params);
      return { rows: res.rows || res };
    }
    return dbPool.query(toPg(sql), params);
  }
  const sqlite3 = (await import('sqlite3')).default;
  sqliteDb ||= new sqlite3.Database(process.env.DATABASE_FILE || path.join(process.cwd(), 'restaurant.db'));
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve({ rows })));
  });
};

export const execute = async (sql, params = []) => {
  if (usePostgres) {
    if (neonSql && neonSql.query) {
      const res = await neonSql.query(toPg(sql), params);
      const count = res.rowCount ?? (Array.isArray(res.rows) ? res.rows.length : 0);
      return { rowCount: count, changes: count, lastID: undefined };
    }
    const res = await dbPool.query(toPg(sql), params);
    return { rowCount: res.rowCount, changes: res.rowCount, lastID: undefined };
  }
  const sqlite3 = (await import('sqlite3')).default;
  sqliteDb ||= new sqlite3.Database(process.env.DATABASE_FILE || path.join(process.cwd(), 'restaurant.db'));
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
