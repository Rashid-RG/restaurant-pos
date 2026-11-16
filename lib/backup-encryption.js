// AES-256-GCM encrypted backup envelope, independent of cloud storage provider.
// Private encryption key is never stored in the archive or logged.
import crypto from 'node:crypto';

const MAGIC='gastroflow-encrypted-backup';
const VERSION=1;
const SCRYPT_N=1<<15, SCRYPT_R=8, SCRYPT_P=1;
const KEY_BYTES=32, SALT_BYTES=32, NONCE_BYTES=12, TAG_BYTES=16;
const MIN_SECRET_BYTES=32;
const MAX_ENCRYPTED_BYTES=512*1024*1024;

function validateSecret(secret){
 if(typeof secret!=='string'||Buffer.byteLength(secret,'utf8')<MIN_SECRET_BYTES)
   throw new Error('BACKUP_ENCRYPTION_SECRET must have at least 32 UTF-8 bytes.');
}
function keyFor(secret,salt){
 return crypto.scryptSync(secret,salt,KEY_BYTES,{N:SCRYPT_N,r:SCRYPT_R,p:SCRYPT_P,maxmem:64*1024*1024});
}
export function encryptBackup(plaintext,secret){
 validateSecret(secret);
 const bytes=Buffer.isBuffer(plaintext)?plaintext:Buffer.from(plaintext);
 if(bytes.length===0||bytes.length>MAX_ENCRYPTED_BYTES)throw new Error('Invalid backup size.');
 const salt=crypto.randomBytes(SALT_BYTES),nonce=crypto.randomBytes(NONCE_BYTES);
 const cipher=crypto.createCipheriv('aes-256-gcm',keyFor(secret,salt),nonce);
 const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return {
  format:MAGIC,version:VERSION,
  kdf:{name:'scrypt',N:SCRYPT_N,r:SCRYPT_R,p:SCRYPT_P,salt:salt.toString('base64')},
  cipher:{name:'aes-256-gcm',nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64')},
  ciphertext:ciphertext.toString('base64')
 };
}
function exactBase64(value,bytes){
 if(typeof value!=='string'||!value||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
   throw new Error('Invalid encrypted backup envelope.');
 const result=Buffer.from(value,'base64');
 if(result.toString('base64')!==value||(bytes!==undefined&&result.length!==bytes))
   throw new Error('Invalid encrypted backup envelope.');
 return result;
}
export function decryptBackup(envelope,secret){
 validateSecret(secret);
 if(!envelope||envelope.format!==MAGIC||envelope.version!==VERSION||
   envelope.kdf?.name!=='scrypt'||envelope.kdf.N!==SCRYPT_N||
   envelope.kdf.r!==SCRYPT_R||envelope.kdf.p!==SCRYPT_P||
   envelope.cipher?.name!=='aes-256-gcm')
   throw new Error('Unsupported encrypted backup format.');
 const salt=exactBase64(envelope.kdf.salt,SALT_BYTES);
 const nonce=exactBase64(envelope.cipher.nonce,NONCE_BYTES);
 const tag=exactBase64(envelope.cipher.tag,TAG_BYTES);
 const ciphertext=exactBase64(envelope.ciphertext);
 if(!ciphertext.length||ciphertext.length>MAX_ENCRYPTED_BYTES)
   throw new Error('Invalid encrypted backup size.');
 try{
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyFor(secret,salt),nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]);
 }catch{throw new Error('Encrypted backup authentication failed.');}
}
