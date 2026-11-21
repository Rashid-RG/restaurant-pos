/**
 * Staging-only FCM token registration for verified owner installations.
 * Encrypted at rest using AES-256-GCM with owner/tenant/device binding as AAD.
 * No send calls, and never returns raw tokens to an API response.
 * The owner is derived from the authenticated session, NOT request input.
 */
import crypto from 'node:crypto';
import {digestOwnerInstallation,pushEnrollmentEnabled} from './platform-push-enrollment.js';

const TOKEN=/^[A-Za-z0-9:_-]{20,4096}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor=env=>{
  if(typeof env.PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY!=='string')return null;
  const encoded=env.PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY;
  if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))return null;
  const key=Buffer.from(encoded,'base64');
  return key.length===32?key:null;
};
export function fcmTokenEnrollmentEnabled(env={}){
  return pushEnrollmentEnabled(env)&&
    env.PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED==='true'&&
    env.PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED==='true'&&
    Boolean(keyFor(env));
}
const aadFor=(tenantId,userId,deviceHash)=>Buffer.from(
  JSON.stringify([tenantId,userId,deviceHash]),'utf8'
);
const digestFor=(token,key)=>crypto.createHmac('sha256',key).update(token,'utf8').digest('hex');

export function encryptBoundFcmToken({token,tenantId,userId,deviceHash,env}){
  if(!fcmTokenEnrollmentEnabled(env)||!TOKEN.test(token)||!tenantId||!userId||!deviceHash)
    return null;
  const key=keyFor(env),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aadFor(tenantId,userId,deviceHash));
  const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return {
    tokenHash:digestFor(token,key),
    cipherText:ciphertext.toString('base64'),
    cipherIv:iv.toString('base64'),
    cipherTag:cipher.getAuthTag().toString('base64')
  };
}
/** Server-internal helper only: caller must enforce session owner and tenant. */
export function decryptBoundFcmToken({record,tenantId,userId,deviceHash,env}){
  if(!fcmTokenEnrollmentEnabled(env)||!record||!tenantId||!userId||!deviceHash)return null;
  try{
    const key=keyFor(env);
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(record.cipherIv,'base64'));
    decipher.setAAD(aadFor(tenantId,userId,deviceHash));
    decipher.setAuthTag(Buffer.from(record.cipherTag,'base64'));
    const token=Buffer.concat([
      decipher.update(Buffer.from(record.cipherText,'base64')),decipher.final()
    ]).toString('utf8');
    return TOKEN.test(token)&&digestFor(token,key)===record.tokenHash?token:null;
  }catch{return null}
}
export async function registerOwnerFcmToken({
  dbGet,dbRun,tenantId,userId,input,env={},now=Date.now()
}={}){
  if(!fcmTokenEnrollmentEnabled(env))return {status:'disabled'};
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='installationId,token'||
    typeof input.installationId!=='string'||!UUID.test(input.installationId)||
    typeof input.token!=='string'||!TOKEN.test(input.token))
    return {status:'invalid'};
  if(!tenantId||!userId||typeof dbGet!=='function'||typeof dbRun!=='function')
    return {status:'invalid'};
  const deviceHash=digestOwnerInstallation(input.installationId,env);
  const installation=await dbGet(`SELECT platform FROM platform_owner_communication_devices
    WHERE tenant_id=? AND userId=? AND deviceHash=? AND revokedAt IS NULL`,
    [tenantId,userId,deviceHash]);
  if(!installation||!['android','ios'].includes(installation.platform))
    return {status:'device_not_enrolled'};
  const encrypted=encryptBoundFcmToken({
    token:input.token,tenantId,userId,deviceHash,env
  });
  const existing=await dbGet(`SELECT tenant_id,userId,deviceHash
    FROM platform_owner_communication_fcm_tokens WHERE tokenHash=?`,
    [encrypted.tokenHash]);
  if(existing&&(existing.tenant_id!==tenantId||
    existing.userId!==userId||existing.deviceHash!==deviceHash))
    return {status:'token_already_bound'};
  try{
    await dbRun(`INSERT INTO platform_owner_communication_fcm_tokens
      (tenant_id,userId,deviceHash,tokenHash,cipherText,cipherIv,cipherTag,registeredAt,updatedAt,revokedAt)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(tenant_id,userId,deviceHash) DO UPDATE SET
      tokenHash=excluded.tokenHash,cipherText=excluded.cipherText,
      cipherIv=excluded.cipherIv,cipherTag=excluded.cipherTag,
      updatedAt=excluded.updatedAt,revokedAt=NULL`,
      [tenantId,userId,deviceHash,encrypted.tokenHash,encrypted.cipherText,
        encrypted.cipherIv,encrypted.cipherTag,now,now]);
    return {status:'registered',platform:installation.platform,pushOperational:false};
  }catch{
    // Unique token collision or unavailable storage: fail closed, never echo token.
    return {status:'unavailable'};
  }
}
export async function revokeOwnerFcmToken({
  dbRun,tenantId,userId,installationId,env={},now=Date.now()
}={}){
  if(!fcmTokenEnrollmentEnabled(env))return {status:'disabled'};
  if(!UUID.test(String(installationId||''))||!tenantId||!userId)return {status:'invalid'};
  const deviceHash=digestOwnerInstallation(installationId,env);
  const result=await dbRun(`UPDATE platform_owner_communication_fcm_tokens
    SET revokedAt=?,updatedAt=? WHERE tenant_id=? AND userId=? AND deviceHash=?
      AND revokedAt IS NULL`,[now,now,tenantId,userId,deviceHash]);
  return {status:Number(result?.changes||0)===1?'revoked':'not_found',pushOperational:false};
}
