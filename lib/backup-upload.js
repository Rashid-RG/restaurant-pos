// Upload ONLY already-encrypted GastroFlow backup archives to a narrowly
// configured, short-lived HTTPS presigned PUT URL. No upload is performed
// unless both the destination URL and exact expected hostname are configured.
import fs from 'node:fs';
import crypto from 'node:crypto';

export function validateBackupUploadDestination(url,expectedHost){
 if(typeof expectedHost!=='string'||!expectedHost||expectedHost.includes('/')||expectedHost.includes(':'))
  throw new Error('Backup upload host allowlist is required.');
 let parsed;
 try{parsed=new URL(url);}catch{throw new Error('Invalid backup upload destination.');}
 if(parsed.protocol!=='https:'||parsed.hostname!==expectedHost||
   parsed.username||parsed.password||parsed.hash||parsed.port)
  throw new Error('Backup upload destination is not an approved HTTPS host.');
 return parsed;
}
export function validateEncryptedArchive(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>700*1024*1024)
  throw new Error('Invalid encrypted backup archive size.');
 let envelope;
 try{envelope=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Not an encrypted backup envelope.');}
 if(envelope?.format!=='gastroflow-encrypted-backup'||envelope.version!==1||
    envelope.cipher?.name!=='aes-256-gcm'||typeof envelope.ciphertext!=='string')
  throw new Error('Not an encrypted backup envelope.');
 return crypto.createHash('sha256').update(bytes).digest('hex');
}
export async function uploadEncryptedBackup(file,{
 url=process.env.BACKUP_UPLOAD_PRESIGNED_URL,
 expectedHost=process.env.BACKUP_UPLOAD_HOST,
 fetchImpl=globalThis.fetch,
 timeoutMs=120000
}={}){
 if(!url)return {uploaded:false,reason:'not_configured'};
 const target=validateBackupUploadDestination(url,expectedHost);
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Backup must be a regular file.');
 const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 let bytes;
 try{bytes=fs.readFileSync(descriptor);}finally{fs.closeSync(descriptor);}
 const sha256=validateEncryptedArchive(bytes);
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),Math.min(300000,Math.max(1000,timeoutMs)));
 timeout.unref?.();
 try{
  const response=await fetchImpl(target.href,{
   method:'PUT',headers:{'Content-Type':'application/json'},
   body:bytes,signal:controller.signal,redirect:'error'
  });
  if(response.status<200||response.status>=300)throw new Error('Backup storage rejected encrypted upload.');
  return {uploaded:true,bytes:bytes.length,sha256};
 }catch{throw new Error('Encrypted off-host backup upload failed.');}
 finally{clearTimeout(timeout);}
}
