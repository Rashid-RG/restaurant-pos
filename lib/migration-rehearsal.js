/**
 * GastroFlow clone-only migration rehearsal.
 *
 * Deliberately opens an in-memory SQLite database itself: it NEVER accepts a
 * connection, file path, Turso URL, or credentials. It cannot change live data.
 * This is NOT the production migration runner.
 */
import { createHash } from 'node:crypto';
import sqlite3 from 'sqlite3';

const VERSION = /^[0-9]{4}_[a-z][a-z0-9_]{2,63}$/;
const ADDITIVE = /^\s*(?:ALTER\s+TABLE\s+(?:"[^"]+"|[a-z_][\w]*)\s+ADD\s+COLUMN\s+|CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+)/i;

function validateMigration(migration) {
  if (!migration || typeof migration.version !== 'string' || !VERSION.test(migration.version) ||
      !Array.isArray(migration.statements) || migration.statements.length === 0) {
    throw new TypeError('Migration requires an immutable version and nonempty statements');
  }
  for (const sql of migration.statements) {
    if (typeof sql !== 'string' || !ADDITIVE.test(sql) || sql.includes(';') ||
        /\b(?:DROP|DELETE|UPDATE|INSERT|REPLACE|ATTACH|DETACH|VACUUM|PRAGMA)\b/i.test(sql)) {
      throw new Error('Rehearsal supports only single-statement additive column or index changes');
    }
  }
  return createHash('sha256').update(JSON.stringify(migration.statements)).digest('hex');
}

export async function rehearseMigrations({seedStatements = [], migrations = []} = {}) {
  if (!Array.isArray(seedStatements) || !Array.isArray(migrations)) {
    throw new TypeError('Seed statements and migrations must be arrays');
  }
  // No external connection is accepted, even if an operator passes a database URL.
  const db = new sqlite3.Database(':memory:');
  const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, error => error ? reject(error) : resolve()));
  const all = (sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  const applied = [];
  try {
    await run('PRAGMA foreign_keys=ON');
    for (const sql of seedStatements) await run(sql);
    await run('CREATE TABLE schema_migration_rehearsals (version TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
    for (const migration of migrations) {
      const checksum = validateMigration(migration);
      const known = (await all('SELECT checksum FROM schema_migration_rehearsals WHERE version=?', [migration.version]))[0];
      if (known) {
        if (known.checksum !== checksum) throw new Error('Migration version checksum changed');
        applied.push({version:migration.version, status:'already_applied', checksum});
        continue;
      }
      await run('BEGIN IMMEDIATE');
      try {
        for (const sql of migration.statements) await run(sql);
        await run('INSERT INTO schema_migration_rehearsals (version,checksum) VALUES (?,?)', [migration.version,checksum]);
        const integrity = await all('PRAGMA integrity_check');
        const references = await all('PRAGMA foreign_key_check');
        if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || references.length !== 0) {
          throw new Error('Migration rehearsal integrity validation failed');
        }
        await run('COMMIT');
        applied.push({version:migration.version,status:'applied',checksum});
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }
    }
    const ledger = await all('SELECT version,checksum FROM schema_migration_rehearsals ORDER BY version');
    const integrity = await all('PRAGMA integrity_check');
    const references = await all('PRAGMA foreign_key_check');
    return {ok:integrity.length===1 && integrity[0].integrity_check==='ok' && references.length===0,
      applied,ledger,foreignKeyViolationCount:references.length};
  } finally {
    await new Promise((resolve,reject) => db.close(error => error ? reject(error) : resolve()));
  }
}
