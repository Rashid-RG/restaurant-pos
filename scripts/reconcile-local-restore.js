#!/usr/bin/env node
// Compare an existing, sensitive local backup to an existing local restored DB.
// READ ONLY: never uses Turso credentials, never creates a DB, never writes.
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import {reconcileRestoredSnapshot} from '../lib/restore-reconciliation.js';

const args=process.argv.slice(2);
if(args.length!==2||args.some(value=>!value||value.startsWith('-')||
  /^(?:file:|https?:|libsql:|wss?:)/i.test(value))) {
  console.error('Usage: node scripts/reconcile-local-restore.js EXISTING-LOCAL-BACKUP.json EXISTING-RESTORED-COPY.db');
  process.exitCode=2;
}else{
  const paths=args.map(value=>path.resolve(value));
  try{
    if(paths[0]===paths[1])throw new Error('Snapshot and database paths must differ');
    for(const filename of paths){
      const stat=fs.lstatSync(filename);
      if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Input must be a regular local file, not a symlink');
    }
    const snapshot=JSON.parse(fs.readFileSync(paths[0],'utf8'));
    const db=new sqlite3.Database(paths[1],sqlite3.OPEN_READONLY);
    const all=sql=>new Promise((resolve,reject)=>db.all(sql,(error,rows)=>error?reject(error):resolve(rows)));
    try{
      const report=await reconcileRestoredSnapshot(snapshot,all);
      console.log(JSON.stringify(report,null,2));
      if(!report.ok)process.exitCode=1;
    }finally{await new Promise(resolve=>db.close(resolve));}
  }catch(error){
    // Do not print file paths or any database row values.
    console.error('Offline restore reconciliation failed:',error.code||error.message);
    process.exitCode=1;
  }
}
