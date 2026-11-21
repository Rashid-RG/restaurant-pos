import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { assessDatabaseMigration } from '../lib/database-assessment.js';
import { inspectDatabaseSchema } from '../lib/schema-inventory.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function schema(statements) {
  const db=new sqlite3.Database(':memory:');
  const run=sql=>new Promise((ok,fail)=>db.run(sql,error=>error?fail(error):ok()));
  const all=sql=>new Promise((ok,fail)=>db.all(sql,(error,rows)=>error?fail(error):ok(rows)));
  try {
    for(const statement of statements) await run(statement);
    return await inspectDatabaseSchema(all);
  } finally {await new Promise(ok=>db.close(ok));}
}
const orders='CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, timestamp INTEGER, status TEXT)';
const runCli=(a,b)=>spawnSync(process.execPath,['scripts/assess-local-schema.js',a,b],{
  encoding:'utf8',timeout:10000,env:{...process.env,TURSO_DATABASE_URL:'libsql://unreachable.invalid',TURSO_AUTH_TOKEN:'dummy'}
});

describe('consolidated offline database modernization assessment',()=>{
  it('combines schema, index and tenancy findings without suggesting automatic migrations',async()=>{
    const before=await schema([orders]);
    const after=await schema([orders,'CREATE INDEX idx_tenant_time ON orders(tenant_id,timestamp)']);
    const result=assessDatabaseMigration(before,after);
    expect(result.format).toBe('gastroflow-database-assessment');
    expect(result.metrics.schemaChangeCount).toBe(1);
    expect(result.metrics.highRiskSchemaChanges).toBe(0);
    expect(result.metrics.missingIndexCoverageCandidates).toBe(1);
    expect(result.verdict).toBe('manual_approval_required');
    expect(Object.values(result.releaseGates).every(value=>value===false)).toBe(true);
  });

  it('marks removal of tenant scope as higher risk',async()=>{
    const before=await schema([orders]);
    const after=await schema(['CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT)']);
    const result=assessDatabaseMigration(before,after);
    expect(result.verdict).toBe('high_risk_manual_review');
    expect(result.changes.some(c=>c.kind==='tenant_scope_changed')).toBe(true);
    expect(result.metrics.highRiskSchemaChanges).toBeGreaterThan(0);
  });

  it('CLI reads two existing local inventory JSON files only, with no database connection',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'gastroflow-offline-assessment-'));
    try {
      const before=join(folder,'before.json'), after=join(folder,'after.json');
      const inventory=await schema([orders]);
      writeFileSync(before,JSON.stringify(inventory));
      writeFileSync(after,JSON.stringify(inventory));
      const result=runCli(before,after);
      expect(result.status,result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({format:'gastroflow-database-assessment',metrics:{schemaChangeCount:0}});
      expect(runCli('libsql://remote.invalid',after).status).toBe(2);
      const missing=join(folder,'missing.json');
      expect(runCli(missing,after).status).toBe(1);
      expect(existsSync(missing)).toBe(false);
      const symlink=join(folder,'link.json');
      symlinkSync(before,symlink);
      expect(runCli(symlink,after).status).toBe(1);
    }finally{rmSync(folder,{recursive:true,force:true});}
  });
});
