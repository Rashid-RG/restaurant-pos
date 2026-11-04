// Restores only to a new local file. Never overwrites an existing/live database.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createClient} from '@libsql/client';
import {snapshotHash,quoteIdentifier,decodeBackupValue,encodeBackupValue} from '../lib/snapshots.js';
const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/verify-restore.js BACKUP.json [NEW_LOCAL.db]');
const backup=JSON.parse(fs.readFileSync(input,'utf8'));
if(backup.payload?.format!=='gastroflow-logical-backup'||backup.payload.version!==1||snapshotHash(backup.payload)!==backup.sha256)throw new Error('Unsupported or corrupt backup.');
const destination=path.resolve(process.argv[3]||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gastroflow-restore-')),'verified.db'));
if(fs.existsSync(destination))throw new Error('Destination exists; refusing to overwrite.');
const client=createClient({url:`file:${destination}`});
try {
 await client.execute('PRAGMA foreign_keys=OFF');
 for(const item of backup.payload.schema.filter(row=>row.type==='table'))await client.execute(item.sql);
 let records=0;
 for(const table of backup.payload.tables){
  for(const row of table.rows){const keys=Object.keys(row);await client.execute({sql:`INSERT INTO ${quoteIdentifier(table.name)} (${keys.map(quoteIdentifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,args:keys.map(key=>decodeBackupValue(row[key]))});records++;}
  const restored=await client.execute(`SELECT * FROM ${quoteIdentifier(table.name)}`);
  const canonical=row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,encodeBackupValue(value)])));
  if(JSON.stringify(restored.rows.map(canonical).sort())!==JSON.stringify(table.rows.map(canonical).sort()))throw new Error('Restored records differ from the backup.');
 }
 for(const item of backup.payload.schema.filter(row=>row.type!=='table').sort((a,b)=>({index:1,view:2,trigger:3}[a.type]-{index:1,view:2,trigger:3}[b.type])))await client.execute(item.sql);
 const integrity=await client.execute('PRAGMA integrity_check');if(integrity.rows[0].integrity_check!=='ok')throw new Error('Restored database failed integrity check.');
 const foreign=await client.execute('PRAGMA foreign_key_check');if(foreign.rows.length)throw new Error('Restored database has foreign-key violations.');
 fs.chmodSync(destination,0o600);
 console.log(JSON.stringify({verified:true,tables:backup.payload.tables.length,records,sha256:backup.sha256,destination}));
}finally{client.close()}
