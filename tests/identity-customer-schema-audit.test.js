import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { inspectCustomerAccountSchema } from '../lib/identity/index.js';

async function withDatabase(definition, check) {
  const db = new sqlite3.Database(':memory:');
  const run = sql => new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
  try {
    if (definition) await run(definition);
    return await check({all,run});
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

describe('read-only customer account schema compatibility inspection', () => {
  it('detects the original database-wide email uniqueness without changing it', async () => {
    await withDatabase(
      'CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, tenant_id TEXT)',
      async ({all,run}) => {
        await run("INSERT INTO customer_accounts (id,email,phone,tenant_id) VALUES ('a','same@example.test','0771','restaurant-A')");
        const result = await inspectCustomerAccountSchema(all);
        expect(result).toEqual({
          status:'legacy_global_email_unique',
          tenantColumnPresent:true,
          legacyGlobalEmailUnique:true,
          tenantEmailUnique:false,
          emailNotNull:true
        });
        await expect(run("INSERT INTO customer_accounts (id,email,phone,tenant_id) VALUES ('b','same@example.test','0772','restaurant-B')"))
          .rejects.toThrow(/UNIQUE constraint failed/);
        expect((await all('SELECT COUNT(*) AS count FROM customer_accounts'))[0].count).toBe(1);
      }
    );
  });

  it('recognizes tenant-scoped uniqueness without treating it as global', async () => {
    await withDatabase(
      'CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, email TEXT, tenant_id TEXT, UNIQUE(tenant_id,email))',
      async ({all,run}) => {
        const result=await inspectCustomerAccountSchema(all);
        expect(result.status).toBe('tenant_email_unique');
        expect(result.legacyGlobalEmailUnique).toBe(false);
        expect(result.tenantEmailUnique).toBe(true);
        await run("INSERT INTO customer_accounts VALUES ('a','same@example.test','restaurant-A')");
        await run("INSERT INTO customer_accounts VALUES ('b','same@example.test','restaurant-B')");
        expect((await all('SELECT COUNT(*) AS count FROM customer_accounts'))[0].count).toBe(2);
      }
    );
  });

  it('reports missing and unconstrained tables without creating anything', async () => {
    await withDatabase(null,async({all})=>{
      expect((await inspectCustomerAccountSchema(all)).status).toBe('missing_table');
      expect((await all("SELECT name FROM sqlite_master WHERE type='table'"))).toEqual([]);
    });
    await withDatabase('CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, email TEXT, tenant_id TEXT)',async({all})=>{
      expect((await inspectCustomerAccountSchema(all)).status).toBe('no_detected_email_unique_index');
    });
  });

  it('does not issue mutating statements or read customer records', async () => {
    await withDatabase('CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE)',async({all})=>{
      const statements=[];
      const audit=await inspectCustomerAccountSchema(async sql=>{
        statements.push(sql);
        return all(sql);
      });
      expect(audit.legacyGlobalEmailUnique).toBe(true);
      expect(statements.length).toBeGreaterThan(1);
      expect(statements.every(sql => /^PRAGMA (?:table_info|index_list|index_info)\(/.test(sql))).toBe(true);
    });
  });
});
