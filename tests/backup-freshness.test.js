import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkBackupFreshness} from '../lib/backup-freshness.js';
import {snapshotHash} from '../lib/snapshots.js';

const fixed=Date.UTC(2026,10,16,10,0,0);
const name='gastroflow-2026-11-16T10-00-00-000Z.db';
function temp(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gastroflow-backup-freshness-'));
 return {dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function sqliteFile(dir,nameValue=name,contents=Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.alloc(256)]),mtime=fixed){
 const target=path.join(dir,nameValue);
 fs.writeFileSync(target,contents);
 fs.utimesSync(target,new Date(mtime),new Date(mtime));
 return target;
}
describe('Read-only backup freshness monitoring',()=>{
 it('fails closed when there is no backup directory or no completed snapshot',()=>{
  const {dir,cleanup}=temp();
  try{
   expect(checkBackupFreshness(path.join(dir,'unavailable'),{now:fixed}).reason).toBe('backup_directory_unavailable');
   expect(checkBackupFreshness(dir,{now:fixed}).reason).toBe('backup_missing');
  }finally{cleanup();}
 });
 it('accepts a recent file with expected SQLite header and rejects stale files',()=>{
  const {dir,cleanup}=temp();
  try{
   sqliteFile(dir);
   expect(checkBackupFreshness(dir,{now:fixed+3600000})).toEqual({ok:true,ageMs:3600000});
   expect(checkBackupFreshness(dir,{now:fixed+27*3600000})).toEqual({ok:false,reason:'backup_stale',ageMs:27*3600000});
  }finally{cleanup();}
 });
 it('rejects tiny, malformed, future-dated, symlinked and unrelated files',()=>{
  const {dir,cleanup}=temp();
  try{
   fs.writeFileSync(path.join(dir,'customer-data.json'),JSON.stringify({private:'not a backup'}));
   sqliteFile(dir,name,Buffer.alloc(4));
   expect(checkBackupFreshness(dir,{now:fixed}).ok).toBe(false);
   sqliteFile(dir,name,Buffer.alloc(256));
   expect(checkBackupFreshness(dir,{now:fixed}).reason).toBe('backup_invalid');
   fs.unlinkSync(path.join(dir,name));
   const original=sqliteFile(dir,'gastroflow-2026-11-15T10-00-00-000Z.db',undefined,fixed+7200000);
   fs.symlinkSync(original,path.join(dir,name));
   expect(checkBackupFreshness(dir,{now:fixed}).ok).toBe(false);
  }finally{cleanup();}
 });
 it('requires a matching checksum for logical Turso backup JSON',()=>{
  const {dir,cleanup}=temp();
  try{
   const file=path.join(dir,'gastroflow-2026-11-16T10-00-00-000Z.json');
   const payload={format:'gastroflow-logical-backup',version:1,schema:[],tables:[]};
   const doc={payload,sha256:snapshotHash(payload)};
   fs.writeFileSync(file,JSON.stringify(doc));
   fs.utimesSync(file,new Date(fixed),new Date(fixed));
   expect(checkBackupFreshness(dir,{now:fixed}).ok).toBe(true);
   fs.writeFileSync(file,JSON.stringify({...doc,sha256:'tampered'}));
   fs.utimesSync(file,new Date(fixed),new Date(fixed));
   expect(checkBackupFreshness(dir,{now:fixed}).reason).toBe('backup_invalid');
  }finally{cleanup();}
 });
 it('rejects invalid freshness policies',()=>{
  expect(()=>checkBackupFreshness('/missing',{maxAgeMs:0})).toThrow(/policy/);
  expect(()=>checkBackupFreshness('/missing',{minSizeBytes:0})).toThrow(/policy/);
 });
});
