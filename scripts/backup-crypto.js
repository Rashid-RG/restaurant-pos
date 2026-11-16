// Operator-only encryption/decryption of a preexisting backup snapshot.
// Never writes to existing paths or alters live databases. Output permissions
// are private, and the secret comes only from a private environment variable.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {encryptBackup,decryptBackup} from '../lib/backup-encryption.js';

const [mode,inputArg,outputArg]=process.argv.slice(2);
if(!['encrypt','decrypt'].includes(mode)||!inputArg||!outputArg)
 throw new Error('Usage: node scripts/backup-crypto.js encrypt|decrypt INPUT OUTPUT (set BACKUP_ENCRYPTION_SECRET privately)');
const input=path.resolve(inputArg),output=path.resolve(outputArg);
if(input===output)throw new Error('Input and output must be different paths.');
const secret=process.env.BACKUP_ENCRYPTION_SECRET;
if(!secret||Buffer.byteLength(secret,'utf8')<32)
 throw new Error('BACKUP_ENCRYPTION_SECRET must have at least 32 UTF-8 bytes.');
const stat=fs.lstatSync(input);
if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Input must be a regular backup file.');
const source=fs.readFileSync(input);
let data;
if(mode==='encrypt'){
 data=Buffer.from(JSON.stringify(encryptBackup(source,secret)));
}else{
 data=decryptBackup(JSON.parse(source.toString('utf8')),secret);
}
const descriptor=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
try{
 fs.writeFileSync(descriptor,data);
 fs.fsyncSync(descriptor);
}finally{fs.closeSync(descriptor);}
console.log(JSON.stringify({success:true,mode,bytes:data.length}));
// The original source remains intentionally unchanged. Operators must protect
// it and independently verify restored content before using archived copies.
