// Run from an operator-controlled scheduler or backup verification job.
// Read-only; never copies, deletes or restores a database.
import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkBackupFreshness} from '../lib/backup-freshness.js';
import {sendOperationalAlert} from '../lib/ops-alerts.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.resolve(process.env.BACKUP_DIRECTORY||path.join(root,'backups'));
const raw=Number(process.env.BACKUP_MAX_AGE_HOURS||26);
if(!Number.isFinite(raw)||raw<=0||raw>720)
 throw new Error('BACKUP_MAX_AGE_HOURS must be between 0 and 720 hours.');
const result=checkBackupFreshness(directory,{maxAgeMs:raw*60*60*1000});
if(result.ok){
 console.log(JSON.stringify({event:'backup_fresh',ageHours:Math.round(result.ageMs/3600000)}));
}else{
 console.error(JSON.stringify({event:'backup_missing',reason:result.reason}));
 const alert=await sendOperationalAlert('backup_missing');
 if(!alert.sent&&alert.reason!=='not_configured')
   console.error(JSON.stringify({event:'backup_alert_delivery_failed',reason:alert.reason}));
 process.exitCode=1;
}
