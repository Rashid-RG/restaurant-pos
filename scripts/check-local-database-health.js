#!/usr/bin/env node
// Offline, read-only integrity check on an EXISTING local restored SQLite copy.
// Never connects to Turso, runs a migration, or changes a live store.
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import sqlite3 from 'sqlite3';

const input = process.argv[2];
if (!input || process.argv.length !== 3 || input.startsWith('-') ||
    /^(?:file:|https?:|libsql:|wss?:)/i.test(input)) {
  console.error('Usage: node scripts/check-local-database-health.js /path/to/EXISTING-RESTORED-COPY.db');
  process.exitCode = 2;
} else {
  const filename = resolve(input);
  if (!existsSync(filename) || !lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) {
    console.error('Refusing missing, non-regular, or symlink database path. Supply an existing local restored copy.');
    process.exitCode = 2;
  } else {
    const real = realpathSync(filename);
    const db = new sqlite3.Database(real, sqlite3.OPEN_READONLY);
    const all = sql => new Promise((ok,fail) => db.all(sql,(error,rows) => error ? fail(error) : ok(rows)));
    try {
      const [integrity, foreignKeys, tables] = await Promise.all([
        all('PRAGMA integrity_check'),
        all('PRAGMA foreign_key_check'),
        all("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"),
      ]);
      const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok' && foreignKeys.length === 0;
      // Report only aggregate metadata, never IDs, emails or rows from the database.
      console.log(JSON.stringify({
        format: 'gastroflow-local-database-health',
        ok,
        integrity: integrity.length === 1 && integrity[0].integrity_check === 'ok' ? 'ok' : 'failed',
        foreignKeyViolationCount: foreignKeys.length,
        tableCount: Number(tables[0]?.count || 0),
      }));
      if (!ok) process.exitCode = 1;
    } catch (error) {
      console.error('Local database health check failed:', error.message);
      process.exitCode = 1;
    } finally {
      await new Promise(ok => db.close(ok));
    }
  }
}
