import { describe, expect, it } from 'vitest';
import { reviewIndexCoverage } from '../lib/index-coverage-review.js';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';
import sqlite3 from 'sqlite3';

async function disposable(test) {
  const db = new sqlite3.Database(':memory:');
  const run = sql => new Promise((ok, fail) => db.run(sql, err => err ? fail(err) : ok()));
  const all = sql => new Promise((ok, fail) => db.all(sql, (err, rows) => err ? fail(err) : ok(rows)));
  try { return await test({run, all}); } finally { await new Promise(ok => db.close(ok)); }
}

describe('database index coverage review', () => {
  it('recognizes the pre-existing tenant-aware order indexes instead of proposing duplicates', async () => {
    await disposable(async ({run, all}) => {
      await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, timestamp INTEGER, status TEXT, total INTEGER)');
      await run('CREATE INDEX idx_orders_tenant_timestamp ON orders(tenant_id, timestamp DESC)');
      await run('CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status)');
      await run('CREATE INDEX idx_orders_tenant_status_time ON orders(tenant_id, status, timestamp)');
      const before = await all("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name");
      const review = reviewIndexCoverage(await inspectDatabaseSchema(all));
      expect(review.findings.find(f => f.table === 'orders' && f.columns[1] === 'timestamp').status).toBe('covered');
      expect(review.findings.find(f => f.table === 'orders' && f.columns[1] === 'status').status).toBe('covered');
      expect(review.duplicatePrefixes.some(f => f.table === 'orders')).toBe(true);
      expect(await all("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")).toEqual(before);
    });
  });

  it('flags candidates but never generates DDL or assumes nonexistent columns', async () => {
    await disposable(async ({run, all}) => {
      await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, timestamp INTEGER, status TEXT)');
      await run('CREATE TABLE manual_payments (id TEXT, tenant_id TEXT, actorId TEXT, createdAt INTEGER)');
      await run('CREATE TABLE timeclock_entries (userId TEXT, clockOut INTEGER)');
      const review = reviewIndexCoverage(await inspectDatabaseSchema(all));
      expect(review.findings.filter(f => f.status === 'review_candidate').length).toBe(4);
      expect(review.note).toMatch(/EXPLAIN QUERY PLAN/);
      expect(JSON.stringify(review)).not.toMatch(/CREATE INDEX|DROP INDEX/i);
    });
  });

  it('does not count partial indexes as general coverage or missing tables as index candidates', async () => {
    await disposable(async ({run, all}) => {
      await run('CREATE TABLE orders (tenant_id TEXT, timestamp INTEGER, status TEXT)');
      await run("CREATE INDEX only_pending ON orders(tenant_id, status) WHERE status='pending'");
      const review = reviewIndexCoverage(await inspectDatabaseSchema(all));
      expect(review.findings.find(f => f.table==='orders' && f.columns[1]==='status').status).toBe('review_candidate');
      expect(review.findings.find(f => f.table==='manual_payments').status).toBe('table_not_present');
    });
  });

  it('fails closed on unknown inventory input', () => {
    expect(() => reviewIndexCoverage({tables:[]})).toThrow(/schema inventory/);
    expect(() => reviewIndexCoverage(null)).toThrow(/schema inventory/);
  });
});
