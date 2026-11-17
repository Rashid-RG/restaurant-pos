import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlStore } from '../lib/libsql-store.js';
import { captureSnapshot, snapshotHash, decodeBackupValue, encodeBackupValue } from '../lib/snapshots.js';
import { encryptBackup, decryptBackup } from '../lib/backup-encryption.js';

const secret = 'disposable-recovery-drill-secret-at-least-32-characters';
const runRestore = (input, destination) => spawnSync(
  process.execPath,
  ['scripts/verify-restore.js', input, destination],
  { encoding: 'utf8', timeout: 30000, env: { ...process.env, TURSO_DATABASE_URL: '', DATABASE_URL: '' } },
);

describe('offline logical backup + encrypted recovery drill', () => {
  it('restores multi-tenant orders, relationships and binary values into a NEW local database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gastroflow-recovery-drill-'));
    const source = join(dir, 'synthetic-source.db');
    const backupFile = join(dir, 'decrypted-backup.json');
    const restored = join(dir, 'verified-restored.db');
    let store;
    try {
      store = await createLibsqlStore({ url: `file:${source}` });
      await store.execute('PRAGMA foreign_keys=ON');
      await store.execute('CREATE TABLE restaurants (id TEXT PRIMARY KEY, label TEXT NOT NULL)');
      await store.execute('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, total INTEGER NOT NULL, FOREIGN KEY(tenant_id) REFERENCES restaurants(id))');
      await store.execute('CREATE TABLE attachments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, payload BLOB, FOREIGN KEY(order_id) REFERENCES orders(id))');
      await store.execute('CREATE INDEX idx_order_tenant ON orders(tenant_id)');
      await store.execute('INSERT INTO restaurants VALUES (?, ?)', ['shop-A', 'Fixture A']);
      await store.execute('INSERT INTO restaurants VALUES (?, ?)', ['shop-B', 'Fixture B']);
      await store.execute('INSERT INTO orders VALUES (?, ?, ?)', ['order-A', 'shop-A', 1200]);
      await store.execute('INSERT INTO orders VALUES (?, ?, ?)', ['order-B', 'shop-B', 2300]);
      await store.execute('INSERT INTO attachments VALUES (?, ?, ?)', ['attachment-A', 'order-A', new Uint8Array([0, 1, 127, 255])]);

      const snapshot = await captureSnapshot({
        dbAll: async sql => (await store.execute(sql)).rows,
        dbRun: async sql => store.execute(sql),
      });
      expect(snapshot.sha256).toBe(snapshotHash(snapshot.payload));
      expect(snapshot.payload.tables.find(table => table.name === 'attachments').rows[0].payload)
        .toEqual({ $blob: Buffer.from([0, 1, 127, 255]).toString('base64') });
      const protectedArchive = encryptBackup(Buffer.from(JSON.stringify(snapshot)), secret);
      expect(JSON.stringify(protectedArchive)).not.toContain('order-A');
      const plaintext = decryptBackup(protectedArchive, secret);
      writeFileSync(backupFile, plaintext, { mode: 0o600 });
      const response = runRestore(backupFile, restored);
      expect(response.status, response.stderr).toBe(0);
      expect(JSON.parse(response.stdout)).toMatchObject({
        verified: true, tables: 3, records: 5, sha256: snapshot.sha256,
      });
      expect(existsSync(restored)).toBe(true);
      const verified = await createLibsqlStore({ url: `file:${restored}` });
      try {
        const result = await verified.execute('SELECT tenant_id,total FROM orders ORDER BY id');
        expect(result.rows.map(row => [row.tenant_id, Number(row.total)])).toEqual([['shop-A', 1200], ['shop-B', 2300]]);
        const blob = await verified.execute('SELECT payload FROM attachments WHERE id=?', ['attachment-A']);
        expect(Array.from(blob.rows[0].payload)).toEqual([0, 1, 127, 255]);
        expect((await verified.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
      } finally { verified.close(); }
      expect(runRestore(backupFile, restored).status).not.toBe(0);
      expect(readFileSync(backupFile).equals(plaintext)).toBe(true);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it('round-trips binary backup fields as native Uint8Array for local libSQL parameters', () => {
    const original = new Uint8Array([0, 7, 127, 128, 255]);
    const encoded = encodeBackupValue(original);
    const restored = decodeBackupValue(encoded);
    expect(restored).toBeInstanceOf(Uint8Array);
    expect(restored.constructor).toBe(Uint8Array);
    expect(Array.from(restored)).toEqual(Array.from(original));
    expect(encodeBackupValue(restored)).toEqual(encoded);
    // The local libSQL driver returns ArrayBuffer, not only Uint8Array.
    const arrayBuffer = original.buffer.slice(0);
    expect(encodeBackupValue(arrayBuffer)).toEqual(encoded);
    const padded = new Uint8Array([99, ...original, 99]);
    expect(encodeBackupValue(padded.subarray(1, 6))).toEqual(encoded);
  });

  it('rejects corrupt snapshot data before creating a destination', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gastroflow-recovery-corrupt-'));
    try {
      const source = join(dir, 'invalid.json');
      const destination = join(dir, 'must-not-exist.db');
      const payload = { format: 'gastroflow-logical-backup', version: 1, schema: [], tables: [] };
      writeFileSync(source, JSON.stringify({payload, sha256: 'incorrect'}));
      const result = runRestore(source, destination);
      expect(result.status).not.toBe(0);
      expect(existsSync(destination)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
