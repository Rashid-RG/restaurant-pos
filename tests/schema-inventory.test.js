import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';

async function withMemoryDatabase(runTest) {
  const db = new sqlite3.Database(':memory:');
  const run = sql => new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
  try { await runTest({run, all}); }
  finally { await new Promise(resolve => db.close(resolve)); }
}

describe('read-only database structure inventory', () => {
  it('detects tenant-scoped and legacy-global unique constraints without reading records', async () => {
    await withMemoryDatabase(async ({run, all}) => {
      await run('CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT)');
      await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_email TEXT UNIQUE, FOREIGN KEY(tenant_id) REFERENCES stores(id))');
      await run('CREATE UNIQUE INDEX orders_tenant_email ON orders(tenant_id, customer_email)');
      await run('CREATE TABLE order_notes (id INTEGER PRIMARY KEY, order_id TEXT, tenant_id TEXT)');
      await run("INSERT INTO stores VALUES ('store-a', 'SECRET RESTAURANT')");
      await run("INSERT INTO orders VALUES ('order-a','store-a','sensitive@example.test')");
      const statements = [];
      const report = await inspectDatabaseSchema(async sql => { statements.push(sql); return all(sql); });
      expect(report.format).toBe('gastroflow-schema-inventory');
      expect(report.tableCount).toBe(3);
      const orders = report.tables.find(table => table.name === 'orders');
      expect(orders.hasTenantColumn).toBe(true);
      expect(orders.review.globalUniqueIndexCandidates.length).toBeGreaterThan(0);
      expect(orders.indexes.some(index => index.unique && index.columns.join(',') === 'tenant_id,customer_email')).toBe(true);
      expect(orders.foreignKeys).toContainEqual(expect.objectContaining({from:'tenant_id',toTable:'stores'}));
      expect(report.tables.find(table => table.name === 'stores').review.noTenantColumn).toBe(true);
      expect(statements.every(sql => /^(SELECT type, name, tbl_name AS table_name, sql FROM sqlite_master|PRAGMA (table_info|index_list|foreign_key_list|index_xinfo)\()/i.test(sql))).toBe(true);
      const text = JSON.stringify(report);
      expect(text).not.toContain('sensitive@example.test');
      expect(text).not.toContain('SECRET RESTAURANT');
      expect((await all('SELECT count(*) as n FROM orders'))[0].n).toBe(1);
    });
  });

  it('handles empty schemas and rejects invalid query providers', async () => {
    await withMemoryDatabase(async ({all}) => {
      const report = await inspectDatabaseSchema(all);
      expect(report.tableCount).toBe(0);
      expect(report.tables).toEqual([]);
    });
    await expect(inspectDatabaseSchema(null)).rejects.toThrow(/read-only/);
  });

  it('escapes metadata-supplied identifiers safely', async () => {
    await withMemoryDatabase(async ({run,all}) => {
      await run('CREATE TABLE "odd""table" ("tenant_id" TEXT, "data" TEXT)');
      await run('CREATE INDEX "odd""index" ON "odd""table" ("data")');
      const report = await inspectDatabaseSchema(all);
      expect(report.tables[0].name).toBe('odd"table');
      expect(report.tables[0].indexes[0].name).toBe('odd"index');
    });
  });
});
