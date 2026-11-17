import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import {snapshotHash} from '../lib/snapshots.js';

const invoke=(backup,db)=>spawnSync(process.execPath,
  ['scripts/reconcile-local-restore.js',backup,db],
  {encoding:'utf8',timeout:15000,env:{...process.env,TURSO_DATABASE_URL:'libsql://never-connected.invalid'}}
);
const withCopy=async callback=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gastroflow-reconcile-'));
 const backup=path.join(dir,'snapshot.json'),file=path.join(dir,'restored.db');
 const db=new sqlite3.Database(file);
 const run=(sql,params=[])=>new Promise((ok,fail)=>db.run(sql,params,error=>error?fail(error):ok()));
 try{await callback({dir,backup,file,run});}
 finally{await new Promise(ok=>db.close(ok));fs.rmSync(dir,{recursive:true,force:true});}
};
const snapshot=tables=>{
 const payload={format:'gastroflow-logical-backup',version:1,createdAt:123,schema:[],tables};
 return {payload,sha256:snapshotHash(payload)};
};
describe('read-only local restore reconciliation',()=>{
 it('verifies two tenant records and binary fields without leaking row contents',async()=>{
  await withCopy(async({backup,file,run})=>{
   await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, amount INTEGER, proof BLOB)');
   await run('INSERT INTO orders VALUES (?,?,?,?)',['secret-order-a','tenant-a',1200,Buffer.from([0,255])]);
   await run('INSERT INTO orders VALUES (?,?,?,?)',['secret-order-b','tenant-b',2400,Buffer.from([1,2])]);
   fs.writeFileSync(backup,JSON.stringify(snapshot([{name:'orders',rows:[
    {id:'secret-order-b',tenant_id:'tenant-b',amount:2400,proof:{$blob:'AQI='}},
    {id:'secret-order-a',tenant_id:'tenant-a',amount:1200,proof:{$blob:'AP8='}},
   ]}])));
   const result=invoke(backup,file);
   expect(result.status,result.stderr).toBe(0);
   expect(JSON.parse(result.stdout)).toMatchObject({ok:true,tableCount:1,recordsExpected:2,recordsRestored:2});
   expect(result.stdout).not.toContain('secret-order');
   expect(result.stdout).not.toContain('tenant-a');
  });
 });
 it('fails closed on mismatched records while revealing only aggregate counts',async()=>{
  await withCopy(async({backup,file,run})=>{
   await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, amount INTEGER)');
   await run("INSERT INTO orders VALUES ('private-id','tenant-a',999)");
   fs.writeFileSync(backup,JSON.stringify(snapshot([{name:'orders',rows:[{id:'private-id',tenant_id:'tenant-a',amount:100}]}])));
   const result=invoke(backup,file);
   expect(result.status).toBe(1);
   expect(JSON.parse(result.stdout)).toMatchObject({ok:false,tables:[{matches:false,expectedCount:1,restoredCount:1}]});
   expect(result.stdout).not.toContain('private-id');
  });
 });
 it('refuses symlinks, missing files, remote URLs and corrupted hashes',async()=>{
  await withCopy(async({dir,backup,file})=>{
   fs.writeFileSync(backup,JSON.stringify(snapshot([])));
   const symlink=path.join(dir,'backup-link.json');
   fs.symlinkSync(backup,symlink);
   expect(invoke(symlink,file).status).toBe(1);
   expect(invoke(backup,'libsql://remote.invalid').status).toBe(2);
   expect(invoke(path.join(dir,'missing.json'),file).status).toBe(1);
   fs.writeFileSync(backup,JSON.stringify({...snapshot([]),sha256:'invalid'}));
   expect(invoke(backup,file).status).toBe(1);
  });
 });
});
