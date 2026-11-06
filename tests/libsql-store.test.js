import { describe, it, expect } from 'vitest';
import { createLibsqlStore } from '../lib/libsql-store.js';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';

describe('Durable libSQL adapter', () => {
  it('commits, rolls back and persists through a new connection', async () => {
    const file = path.join(os.tmpdir(), `gastroflow_libsql_${crypto.randomUUID()}.db`);
    let store = await createLibsqlStore({ url: `file:${file}` });
    try {
      await store.execute('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)');
      await store.execute('BEGIN TRANSACTION');
      await store.execute('INSERT INTO probe VALUES (?,?)', [1, 'committed']);
      await store.execute('COMMIT');
      await store.execute('BEGIN TRANSACTION');
      await store.execute('UPDATE probe SET value=? WHERE id=?', ['rolled back', 1]);
      await store.execute('ROLLBACK');
      store.close();
      store = await createLibsqlStore({ url: `file:${file}` });
      expect((await store.execute('SELECT value FROM probe WHERE id=?', [1])).rows[0].value).toBe('committed');
    } finally { store.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true }); }
  });
});
