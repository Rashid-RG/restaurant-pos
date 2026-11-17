import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';
import { compareDatabaseSchemas } from '../lib/schema-diff.js';

async function inventory(statements) {
  const db=new sqlite3.Database(':memory:');
  const run=sql=>new Promise((ok,fail)=>db.run(sql,err=>err?fail(err):ok()));
  const all=sql=>new Promise((ok,fail)=>db.all(sql,(err,rows)=>err?fail(err):ok(rows)));
  try{
    for(const sql of statements) await run(sql);
    return await inspectDatabaseSchema(all);
  } finally {await new Promise(ok=>db.close(ok));}
}
const base=[
  'CREATE TABLE shops (id TEXT PRIMARY KEY)',
  'CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, total INTEGER NOT NULL, FOREIGN KEY(tenant_id) REFERENCES shops(id))',
  'CREATE INDEX idx_orders_tenant ON orders(tenant_id)',
];
describe('offline database schema comparison',()=>{
  it('is stable when inventories contain the same structures in another order',async()=>{
    const prior=await inventory(base);
    const shuffled={...prior,tables:[...prior.tables].reverse().map(t=>({
      ...t,indexes:[...t.indexes].reverse(),columns:[...t.columns].reverse(),
      foreignKeys:[...t.foreignKeys].reverse(),
    }))};
    expect(compareDatabaseSchemas(prior,shuffled)).toMatchObject({
      changed:false,highRiskCount:0,changes:[],approvalRequired:false,
    });
  });

  it('flags additive changes without executing or returning SQL',async()=>{
    const prior=await inventory(base);
    const next=await inventory([
      ...base,
      'ALTER TABLE orders ADD COLUMN source TEXT',
      'CREATE INDEX idx_orders_source ON orders(tenant_id,source)',
    ]);
    const result=compareDatabaseSchemas(prior,next);
    expect(result.changes).toContainEqual({kind:'column_added',table:'orders',name:'source',impact:'manual_review'});
    expect(result.changes).toContainEqual({kind:'index_added',table:'orders',name:'idx_orders_source',impact:'manual_review'});
    expect(result.highRiskCount).toBe(0);
    expect(result.approvalRequired).toBe(true);
    expect(JSON.stringify(result)).not.toContain('CREATE INDEX');
  });

  it('classifies removed tenant scope, foreign key and index as high risk',async()=>{
    const prior=await inventory(base);
    const next=await inventory([
      'CREATE TABLE shops (id TEXT PRIMARY KEY)',
      'CREATE TABLE orders (id TEXT PRIMARY KEY, total INTEGER NOT NULL)',
    ]);
    const result=compareDatabaseSchemas(prior,next);
    expect(result.changes.map(x=>x.kind)).toEqual(expect.arrayContaining([
      'column_removed','foreign_keys_changed','tenant_scope_changed','index_removed',
    ]));
    expect(result.highRiskCount).toBeGreaterThanOrEqual(4);
  });

  it('flags legacy global uniqueness differences without reading customer records',async()=>{
    const prior=await inventory([
      'CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT UNIQUE)',
      "INSERT INTO customer_accounts VALUES ('private','shop-a','sensitive@example.invalid')",
    ]);
    const next=await inventory([
      'CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT, UNIQUE(tenant_id,email))',
    ]);
    const diff=compareDatabaseSchemas(prior,next);
    expect(diff.changed).toBe(true);
    expect(diff.changes.some(c=>c.kind==='global_unique_candidates_changed')).toBe(true);
    expect(JSON.stringify(diff)).not.toContain('sensitive@example.invalid');
  });

  it('fails closed on incorrect or duplicate table inventories',()=>{
    const baseInventory={format:'gastroflow-schema-inventory',version:1,tables:[]};
    expect(()=>compareDatabaseSchemas(null,baseInventory)).toThrow(/version 1/);
    expect(()=>compareDatabaseSchemas(baseInventory,{...baseInventory,tables:[{name:'a'},{name:'A'}]})).toThrow(/unique/);
  });
});
