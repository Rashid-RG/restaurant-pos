import crypto from 'node:crypto';

// Image-only encrypted manual onboarding evidence. Never store document images in
// logs, plain database columns, user JWTs, URLs, or Render ephemeral filesystem.
export const DRIVER_DOCUMENT_KINDS=Object.freeze(['identity_front','identity_back','licence_front','licence_back']);
export const DRIVER_DOCUMENT_MAX_BYTES=2*1024*1024;

export function manualDocumentKey(env=process.env) {
  const value=env.DRIVER_DOCUMENT_ENCRYPTION_KEY;
  if(typeof value!=='string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key=Buffer.from(value,'base64');
  return key.length===32 && key.toString('base64')===value ? key : null;
}
export function manualDocumentsConfigured(env=process.env) {return manualDocumentKey(env)!==null;}

export function decodeManualDocument(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) ||
      !DRIVER_DOCUMENT_KINDS.includes(input.kind) ||
      !['image/jpeg','image/png','image/webp'].includes(input.contentType) ||
      typeof input.data!=='string' || input.data.length>Math.ceil(DRIVER_DOCUMENT_MAX_BYTES*4/3)+8 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) throw new Error('Only JPEG, PNG or WebP documents up to 2 MB are accepted.');
  const bytes=Buffer.from(input.data,'base64');
  if(!bytes.length || bytes.length>DRIVER_DOCUMENT_MAX_BYTES ||
      bytes.toString('base64')!==input.data) throw new Error('Invalid document data.');
  const magic={
    'image/jpeg': bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff,
    'image/png': bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),
    'image/webp': bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'
  };
  if(!magic[input.contentType]) throw new Error('Document file does not match its image type.');
  return {kind:input.kind,contentType:input.contentType,bytes};
}
export function encryptManualDocument(bytes,{tenantId,driverId,kind},key) {
  if(!Buffer.isBuffer(key)||key.length!==32) throw new Error('Document encryption is not configured.');
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(JSON.stringify([tenantId,driverId,kind])));
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
    ciphertext:encrypted.toString('base64'),digest:crypto.createHash('sha256').update(bytes).digest('hex')};
}
export function decryptManualDocument(record,{tenantId,driverId,kind},key) {
  if(!Buffer.isBuffer(key)||key.length!==32) throw new Error('Document encryption is not configured.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify([tenantId,driverId,kind])));
  decipher.setAuthTag(Buffer.from(record.tag,'base64'));
  const plain=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]);
  if(crypto.createHash('sha256').update(plain).digest('hex')!==record.digest) throw new Error('Document failed integrity verification.');
  return plain;
}
export function documentKindsForVehicle(vehicleType){
  return vehicleType==='Bicycle'?['identity_front','identity_back']:
    ['Motorbike','TukTuk','Car'].includes(vehicleType)?DRIVER_DOCUMENT_KINDS.slice():[];
}
