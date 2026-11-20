/**
 * Staging-only, non-delivering installation enrollment for future owner push.
 * Installation IDs are NOT provider push tokens. Store only a keyed digest,
 * never the raw installation ID. No FCM/APNs, notifications or secrets in UI.
 */
import crypto from 'node:crypto';

const INSTALLATION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function pushEnrollmentEnabled(env={}){
  return env.PLATFORM_COMMUNICATIONS_ENABLED==='true' &&
    env.PLATFORM_COMMUNICATIONS_STAGE==='staging' &&
    env.PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED==='true' &&
    typeof env.PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY==='string' &&
    env.PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY.length>=32;
}
export function digestOwnerInstallation(installationId,env={}){
  if(!pushEnrollmentEnabled(env)||!INSTALLATION_ID.test(String(installationId||'')))return null;
  return crypto.createHmac('sha256',env.PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY)
    .update(installationId.toLowerCase()).digest('hex');
}
export function checkInstallationInput(value){
  return Boolean(value&&typeof value==='object'&&
    Object.keys(value).sort().join(',')==='installationId,platform' &&
    INSTALLATION_ID.test(value.installationId) &&
    ['web','android','ios'].includes(value.platform));
}
/** A device can be enrolled for at most one owner/tenant. Never take owner IDs
 * from a request body. A unique digest index prevents cross-tenant reclaims. */
export async function enrollOwnerInstallation({dbGet,dbRun,tenantId,userId,input,env={},now=Date.now()}){
  if(!pushEnrollmentEnabled(env))return {status:'disabled'};
  if(!checkInstallationInput(input))return {status:'invalid'};
  const digest=digestOwnerInstallation(input.installationId,env);
  const existing=await dbGet('SELECT tenant_id,userId FROM platform_owner_communication_devices WHERE deviceHash=?',[digest]);
  if(existing&&(existing.tenant_id!==tenantId||existing.userId!==userId))
    return {status:'conflict'};
  const result=await dbRun(`INSERT INTO platform_owner_communication_devices
    (tenant_id,userId,deviceHash,platform,registeredAt,updatedAt,revokedAt)
    VALUES (?,?,?,?,?,?,NULL)
    ON CONFLICT(tenant_id,userId,deviceHash) DO UPDATE SET
    platform=excluded.platform,updatedAt=excluded.updatedAt,revokedAt=NULL`,
    [tenantId,userId,digest,input.platform,now,now]);
  if(!result)return {status:'error'};
  return {status:'enrolled',deviceId:digest.slice(0,16),platform:input.platform,pushOperational:false};
}
export async function revokeOwnerInstallation({dbRun,tenantId,userId,installationId,env={},now=Date.now()}){
  const digest=digestOwnerInstallation(installationId,env);
  if(!digest)return {status:pushEnrollmentEnabled(env)?'invalid':'disabled'};
  const result=await dbRun(`UPDATE platform_owner_communication_devices SET revokedAt=?,updatedAt=?
    WHERE tenant_id=? AND userId=? AND deviceHash=? AND revokedAt IS NULL`,
    [now,now,tenantId,userId,digest]);
  return {status:Number(result?.changes||0)===1?'revoked':'not_found',pushOperational:false};
}
