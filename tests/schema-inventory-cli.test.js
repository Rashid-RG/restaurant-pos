import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sqlite3 from 'sqlite3';

describe('local-only schema inventory command', () => {
  it('refuses absent files and remote database URLs without creating a database', () => {
    const root = mkdtempSync(join(tmpdir(), 'gastroflow-db-inventory-'));
    try {
      const missing = join(root, 'missing.db');
      const absent = spawnSync(process.execPath, ['scripts/inventory-local-schema.js', missing], {encoding:'utf8'});
      expect(absent.status).toBe(2);
      expect(existsSync(missing)).toBe(false);
      for (const value of ['libsql://example.invalid', 'https://example.invalid/db', 'file:some.db']) {
        const denied = spawnSync(process.execPath, ['scripts/inventory-local-schema.js', value], {encoding:'utf8'});
        expect(denied.status).toBe(2);
      }
    } finally { rmSync(root, {recursive:true,force:true}); }
  });

  it('refuses symlink input and extra arguments rather than reading unintended databases', async () => {
    const root=mkdtempSync(join(tmpdir(),'gastroflow-db-inventory-link-'));
    try {
      const target=join(root,'real.db'), alias=join(root,'alias.db');
      const db=new sqlite3.Database(target);
      await new Promise(ok=>db.close(ok));
      symlinkSync(target,alias);
      const linked=spawnSync(process.execPath,['scripts/inventory-local-schema.js',alias],{encoding:'utf8'});
      expect(linked.status).toBe(2);
      const extra=spawnSync(process.execPath,['scripts/inventory-local-schema.js',target,'unexpected'],{encoding:'utf8'});
      expect(extra.status).toBe(2);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });

  it('reports schema metadata but never table row values on a disposable local file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gastroflow-db-inventory-'));
    try {
      const filename = join(root, 'sample.db');
      const db = new sqlite3.Database(filename);
      const run = sql => new Promise((ok,fail) => db.run(sql, err => err ? fail(err) : ok()));
      await run('CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT UNIQUE)');
      await run("INSERT INTO customer_accounts VALUES ('id-a','store-a','private@example.invalid')");
      await new Promise(ok => db.close(ok));
      const result = spawnSync(process.execPath, ['scripts/inventory-local-schema.js', filename], {encoding:'utf8'});
      expect(result.status, result.stderr).toBe(0);
      const inventory = JSON.parse(result.stdout);
      expect(inventory.tables[0].name).toBe('customer_accounts');
      expect(inventory.tables[0].review.globalUniqueIndexCandidates).toHaveLength(1);
      expect(result.stdout).not.toContain('private@example.invalid');
      expect(result.stdout).not.toContain('id-a');
    } finally { rmSync(root, {recursive:true,force:true}); }
  });
});
