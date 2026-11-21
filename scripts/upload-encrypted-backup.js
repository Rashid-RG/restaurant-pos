// Operator-run only. A short-lived object-storage presigned PUT URL must be
// configured through a private runner; do not commit URL or credentials.
import 'dotenv/config';
import path from 'node:path';
import {uploadEncryptedBackup} from '../lib/backup-upload.js';
import {runMonitoredBackup} from '../lib/ops-alerts.js';

const filename=process.argv[2];
if(!filename)throw new Error('Usage: npm run backup:upload -- /private/encrypted-backup.enc.json');
const result=await runMonitoredBackup(()=>uploadEncryptedBackup(path.resolve(filename)));
if(!result.uploaded)throw new Error('Off-host backup upload is not configured.');
console.log(JSON.stringify({uploaded:true,bytes:result.bytes,sha256:result.sha256}));
// This only proves a successful HTTPS PUT response, not independent remote
// persistence, bucket retention, or successful restore of the uploaded bytes.
