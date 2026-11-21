#!/usr/bin/env node
// Inventory an existing LOCAL SQLite database only. Does not open Turso or write.
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import sqlite3 from 'sqlite3';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';

const input = process.argv[2];
if (!input || process.argv.length !== 3 || input.startsWith('-') || /^(?:file:|https?:|libsql:|wss?:)/i.test(input)) {
  console.error('Usage: node scripts/inventory-local-schema.js /path/to/EXISTING-RESTORED-COPY.db');
  process.exitCode = 2;
} else {
  const filename = resolve(input);
  if (!existsSync(filename) || !lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) {
    console.error('Refusing missing, non-regular, or symlink database path: provide an existing, restored local copy.');
    process.exitCode = 2;
  } else {
    const verified = realpathSync(filename);
    const db = new sqlite3.Database(verified, sqlite3.OPEN_READONLY);
    const all = sql => new Promise((ok, fail) => db.all(sql, (err, rows) => err ? fail(err) : ok(rows)));
    try {
      const report = await inspectDatabaseSchema(all);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error('Schema inventory failed:', error.message);
      process.exitCode = 1;
    } finally {
      await new Promise(ok => db.close(ok));
    }
  }
}
