// Online SQLite backup: never copy the main .db file without its active WAL.
import sqlite3 from 'sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(process.env.DATABASE_FILE || path.join(root, 'restaurant.db'));
const directory = path.resolve(process.env.BACKUP_DIRECTORY || path.join(root, 'backups'));
if (!fs.existsSync(source)) throw new Error('Database file does not exist; refusing to create an empty backup.');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = path.join(directory, `gastroflow-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const database = new sqlite3.Database(source, sqlite3.OPEN_READONLY);
try {
  await new Promise((resolve, reject) => database.backup(destination, error => error ? reject(error) : resolve()));
  fs.chmodSync(destination, 0o600);
  const copy = new sqlite3.Database(destination, sqlite3.OPEN_READONLY);
  try {
    const rows = await new Promise((resolve, reject) => copy.all('PRAGMA integrity_check', (error, rows) => error ? reject(error) : resolve(rows)));
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  } finally { await new Promise(resolve => copy.close(resolve)); }
  console.log(`Verified backup: ${destination}`);
} finally { await new Promise(resolve => database.close(resolve)); }
