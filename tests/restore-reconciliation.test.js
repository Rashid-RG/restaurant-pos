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
   expect(JSON.parse(result.stdout)).toMatchObject({ok:true,integrity:'ok',foreignKeyViolationCount:0,tableCount:1,recordsExpected:2,recordsRestored:2});
   expect(result.stdout).not.toContain('secret-order');
   expect(result.stdout).not.toContain('tenant-a');
  });
 });
 it('reports financial verification for two restaurant tenants without disclosing totals',async()=>{
  await withCopy(async({backup,file,run})=>{
   await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, total NUMERIC)');
   await run('INSERT INTO orders VALUES (?,?,?)',['order-private-a','tenant-secret-A',120.25]);
   await run('INSERT INTO orders VALUES (?,?,?)',['order-private-b','tenant-secret-B',450]);
   fs.writeFileSync(backup,JSON.stringify(snapshot([{name:'orders',rows:[
    {id:'order-private-a',tenant_id:'tenant-secret-A',total:120.25},
    {id:'order-private-b',tenant_id:'tenant-secret-B',total:450},
   ]}])));
   const result=invoke(backup,file);
   expect(result.status,result.stderr).toBe(0);
   expect(JSON.parse(result.stdout)).toMatchObject({
    ok:true,financialVerified:true,
    tenantFinancials:{status:'checked',ok:true,tenantCount:2,mismatchedTenantCount:0},
   });
   expect(result.stdout).not.toContain('tenant-secret');
   expect(result.stdout).not.toContain('450');
  });
 });
 it('runs the complete offline ledger and fiscal invoice acceptance check',async()=>{
  await withCopy(async({backup,file,run})=>{
   const data={
    orders:[{id:'secret-order-a',tenant_id:'secret-A',total:100,invoiceNumber:1},{id:'secret-order-b',tenant_id:'secret-B',total:200,invoiceNumber:2}],
    invoice_counter:[{id:1,lastNumber:2}],
    manual_payments:[{id:'payment-a',tenant_id:'secret-A',orderId:'secret-order-a',amountCents:10000}],
    manual_refunds:[{id:'refund-a',tenant_id:'secret-A',orderId:'secret-order-a',paymentId:'payment-a',settled:1,amountCents:500}],
    refund_transactions:[{id:'refund-a',tenant_id:'secret-A',orderId:'secret-order-a',amountCents:500}],
    cash_movements:[{id:'cash-a',tenant_id:'secret-A',shiftId:'shift-a',amount:5.25}],
    shifts:[{id:'shift-a',tenant_id:'secret-A',startFloat:100,endFloat:null,actualCash:105.25,expectedCash:105.25}],
   };
   await run('CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT, total REAL, invoiceNumber INTEGER)');
   await run('CREATE TABLE invoice_counter (id INTEGER PRIMARY KEY, lastNumber INTEGER)');
   for(const table of ['manual_payments','manual_refunds','refund_transactions'])
    await run(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, tenant_id TEXT, amountCents INTEGER)`);
   await run('CREATE TABLE cash_movements (id TEXT PRIMARY KEY, tenant_id TEXT, amount REAL)');
   await run('CREATE TABLE shifts (id TEXT PRIMARY KEY, tenant_id TEXT, startFloat REAL, endFloat REAL, actualCash REAL, expectedCash REAL)');
   for(const [table,rows] of Object.entries(data))for(const row of rows){
    const keys=Object.keys(row);
    await run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,Object.values(row));
   }
   fs.writeFileSync(backup,JSON.stringify(snapshot(Object.entries(data).map(([name,rows])=>({name,rows})))));
   const result=invoke(backup,file);
   expect(result.status,result.stderr).toBe(0);
   const report=JSON.parse(result.stdout);
   expect(report).toMatchObject({
    ok:true,accountingVerified:true,financialVerified:true,settlementLinksVerified:true,completeFinancialReview:true,recoveryReady:true,
    accounting:{verified:true,invoices:{verified:true,invoiceCount:2},ledgers:{manual_payments:{verified:true},manual_refunds:{verified:true},refund_transactions:{verified:true},cash_movements:{verified:true},shifts:{verified:true}}},
   });
   expect(result.stdout).not.toContain('secret-A');
   expect(result.stdout).not.toContain('secret-order');
   expect(result.stdout).not.toContain('105.25');
   await run('UPDATE manual_refunds SET amountCents=700 WHERE id=?',['refund-a']);
   const inconsistent=invoke(backup,file);
   expect(inconsistent.status).toBe(1);
   expect(JSON.parse(inconsistent.stdout)).toMatchObject({ok:false,accountingVerified:false,accounting:{ledgers:{manual_refunds:{verified:false}}}});
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
 it('rejects orphaned foreign keys even when all backup records match',async()=>{
  await withCopy(async({backup,file,run})=>{
   await run('PRAGMA foreign_keys=OFF');
   await run('CREATE TABLE parents (id TEXT PRIMARY KEY)');
   await run('CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id))');
   await run("INSERT INTO children VALUES ('private-child','absent-parent')");
   fs.writeFileSync(backup,JSON.stringify(snapshot([
    {name:'parents',rows:[]},
    {name:'children',rows:[{id:'private-child',parent_id:'absent-parent'}]},
   ])));
   const result=invoke(backup,file);
   expect(result.status).toBe(1);
   expect(JSON.parse(result.stdout)).toMatchObject({
    ok:false,integrity:'ok',foreignKeyViolationCount:1,
    tables:[{name:'parents',matches:true},{name:'children',matches:true}],
   });
   expect(result.stdout).not.toContain('private-child');
   expect(result.stdout).not.toContain('absent-parent');
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
