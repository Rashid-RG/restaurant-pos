import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sqlite3 from 'sqlite3';

const cli = 'scripts/check-local-database-health.js';
const check = file => spawnSync(process.execPath,[cli,file],{encoding:'utf8',timeout:10000});
const disposable = async callback => {
  const dir=mkdtempSync(join(tmpdir(),'gastroflow-health-'));
  try {
    const file=join(dir,'restored.db');
    const db=new sqlite3.Database(file);
    const run=sql=>new Promise((ok,fail)=>db.run(sql,error=>error?fail(error):ok()));
    try {await callback({dir,file,run});}
    finally {await new Promise(ok=>db.close(ok));}
  }finally{rmSync(dir,{recursive:true,force:true});}
};

describe('offline restored database health checks',()=>{
  it('refuses absent files, remote URLs and symlinks',async()=>{
    await disposable(async({dir,file})=>{
      const missing=join(dir,'absent.db');
      expect(check(missing).status).toBe(2);
      expect(existsSync(missing)).toBe(false);
      expect(check('libsql://example.invalid').status).toBe(2);
      expect(check('file:example.db').status).toBe(2);
      const alias=join(dir,'linked.db');
      symlinkSync(file,alias);
      expect(check(alias).status).toBe(2);
    });
  });

  it('reports healthy structure without exposing customer data',async()=>{
    await disposable(async({file,run})=>{
      await run('CREATE TABLE customers (id TEXT PRIMARY KEY, email TEXT)');
      await run("INSERT INTO customers VALUES ('private-id','private@example.invalid')");
      const result=check(file);
      expect(result.status,result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        format:'gastroflow-local-database-health',ok:true,integrity:'ok',foreignKeyViolationCount:0,tableCount:1,
      });
      expect(result.stdout).not.toContain('private@example.invalid');
      expect(result.stdout).not.toContain('private-id');
    });
  });

  it('fails on orphaned foreign keys without printing row identifiers',async()=>{
    await disposable(async({file,run})=>{
      await run('PRAGMA foreign_keys=OFF');
      await run('CREATE TABLE parent (id TEXT PRIMARY KEY)');
      await run('CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id))');
      await run("INSERT INTO child VALUES ('secret-child','missing-parent')");
      const result=check(file);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ok:false,integrity:'ok',foreignKeyViolationCount:1});
      expect(result.stdout).not.toContain('secret-child');
    });
  });
});
