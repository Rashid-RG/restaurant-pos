// Restores only to a new local file. Never overwrites an existing/live database.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createClient} from '@libsql/client';
import {snapshotHash,quoteIdentifier,decodeBackupValue,encodeBackupValue} from '../lib/snapshots.js';
const input=process.argv[2];
if(!input||process.argv.length>4||/^(?:file:|https?:|libsql:|wss?:)/i.test(input))
 throw new Error('Usage: node scripts/verify-restore.js EXISTING-LOCAL-BACKUP.json [NEW_LOCAL.db]');
const inputPath=path.resolve(input);
const inputStat=fs.lstatSync(inputPath);
if(!inputStat.isFile()||inputStat.isSymbolicLink())
 throw new Error('Backup input must be an existing regular local file, not a symlink.');
const backup=JSON.parse(fs.readFileSync(inputPath,'utf8'));
if(backup.payload?.format!=='gastroflow-logical-backup'||backup.payload.version!==1||snapshotHash(backup.payload)!==backup.sha256)throw new Error('Unsupported or corrupt backup.');
const requested=process.argv[3];
if(requested&&/^(?:file:|https?:|libsql:|wss?:)/i.test(requested))
 throw new Error('Restore destination must be a new local file path.');
const destination=path.resolve(requested||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gastroflow-restore-')),'verified.db'));
if(destination===inputPath)throw new Error('Restore destination must differ from input.');
// Atomically reserve the output path: a check-then-create can overwrite a newly
// created live file during a race. SQLite initializes the exclusively created
// zero-length file; the archived backup and all other paths remain unchanged.
const reserved=fs.openSync(destination,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0),0o600);
fs.closeSync(reserved);
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
