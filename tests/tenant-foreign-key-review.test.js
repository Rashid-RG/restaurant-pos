import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';
import { reviewTenantForeignKeys } from '../lib/tenant-foreign-key-review.js';

async function inMemory(check) {
  const db = new sqlite3.Database(':memory:');
  const run = sql => new Promise((resolve,reject) => db.run(sql,error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve,reject) => db.all(sql,(error,rows) => error ? reject(error) : resolve(rows)));
  try { await check({run,all}); } finally { await new Promise(resolve => db.close(resolve)); }
}

describe('offline tenant foreign key relationship review', () => {
  it('recognizes composite tenant FKs and flags tenantless links for manual review', async () => {
    await inMemory(async ({run,all}) => {
      await run('CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT)');
      await run('CREATE TABLE parent_orders (tenant_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(tenant_id,id))');
      await run('CREATE TABLE order_items (tenant_id TEXT, orderId TEXT, FOREIGN KEY(tenant_id,orderId) REFERENCES parent_orders(tenant_id,id))');
      await run('CREATE TABLE loose_notes (tenant_id TEXT, orderId TEXT, FOREIGN KEY(orderId) REFERENCES parent_orders(id))');
      await run('CREATE TABLE store_preferences (tenant_id TEXT REFERENCES stores(id))');
      await run("INSERT INTO stores VALUES ('shop-A','PRIVATE SHOP')");
      const reviewed = reviewTenantForeignKeys(await inspectDatabaseSchema(all));
      expect(reviewed.findings.find(item => item.childTable === 'order_items')).toMatchObject({
        status:'tenant_pair_in_foreign_key',
        columns:[{from:'tenant_id',to:'tenant_id'},{from:'orderId',to:'id'}],
      });
      expect(reviewed.findings.find(item => item.childTable === 'loose_notes').status).toBe('tenant_pair_missing_manual_review');
      expect(reviewed.findings.find(item => item.childTable === 'store_preferences').status).toBe('global_or_unscoped_table_review');
      expect(reviewed.counts.tenantPairMissing).toBe(1);
      expect(reviewed.counts.tenantPairPresent).toBe(1);
      expect(JSON.stringify(reviewed)).not.toContain('PRIVATE SHOP');
    });
  });

  it('returns no findings for a schema without foreign keys and rejects invalid inventory', async () => {
    await inMemory(async ({run,all}) => {
      await run('CREATE TABLE receipts (id TEXT, tenant_id TEXT)');
      const result = reviewTenantForeignKeys(await inspectDatabaseSchema(all));
      expect(result.counts).toEqual({total:0,tenantPairMissing:0,tenantPairPresent:0});
      expect(result.findings).toEqual([]);
    });
    expect(() => reviewTenantForeignKeys(null)).toThrow(/schema inventory/);
    expect(() => reviewTenantForeignKeys({tables:[]})).toThrow(/schema inventory/);
  });

  it('reports unknown parent tables without inventing tenant coverage', () => {
    const inventory = {
      format:'gastroflow-schema-inventory',
      tables:[{name:'child',hasTenantColumn:true,foreignKeys:[{id:0,sequence:0,from:'order_id',toTable:'absent',toColumn:'id'}]}],
    };
    const report=reviewTenantForeignKeys(inventory);
    expect(report.findings[0].status).toBe('parent_not_in_inventory');
  });
});
