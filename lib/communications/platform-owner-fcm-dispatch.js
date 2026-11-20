/**
 * Dormant, explicit one-device FCM dispatch for platform-owner notices.
 * No scheduler, HTTP route, or startup hook imports this module.
 * Every send rechecks the recipient and device against the database.
 */
import {fcmSandboxConfig,sendOneSandboxOwnerFcm} from './platform-fcm-sandbox.js';
import {fcmTokenEnrollmentEnabled,decryptBoundFcmToken} from './platform-fcm-token-registry.js';

export async function dispatchOneStagingOwnerNotice({
  dbGet,dbRun,env={},fetcher,announcementId,tenantId,userId,deviceHash,
  now=Date.now()
}={}){
  if(!fcmSandboxConfig(env).enabled||!fcmTokenEnrollmentEnabled(env)||
    env.PLATFORM_COMMUNICATIONS_FCM_DISPATCH_ENABLED!=='true')
    return {started:false,reason:'DISABLED'};
  if(![announcementId,tenantId,userId,deviceHash].every(x=>
    typeof x==='string'&&x.length>0&&x.length<=180)||
    !/^[a-f0-9]{64}$/.test(deviceHash)||
    typeof dbGet!=='function'||typeof dbRun!=='function'||
    !Number.isSafeInteger(now)||now<=0)
    return {started:false,reason:'INVALID_INPUT'};
  const recipient=await dbGet(`SELECT a.title,a.body
    FROM platform_owner_announcements a
    JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id
    JOIN tenants t ON t.id=r.tenant_id
    JOIN users u ON u.id=r.userId AND u.tenant_id=t.id
    LEFT JOIN platform_ownership p ON p.userId=u.id
    JOIN platform_owner_communication_push_preferences pref
      ON pref.tenant_id=t.id AND pref.userId=u.id
    JOIN platform_owner_communication_devices d
      ON d.tenant_id=t.id AND d.userId=u.id AND d.deviceHash=?
    JOIN platform_owner_communication_fcm_tokens f
      ON f.tenant_id=d.tenant_id AND f.userId=d.userId
      AND f.deviceHash=d.deviceHash
    WHERE a.id=? AND r.tenant_id=? AND r.userId=?
      AND a.status='published' AND (a.expiresAt IS NULL OR a.expiresAt>?)
      AND t.status='active' AND u.role='owner' AND p.userId IS NULL
      AND pref.optedIn=1 AND d.revokedAt IS NULL AND f.revokedAt IS NULL
      AND d.platform IN ('android','ios')
    LIMIT 1`,[deviceHash,announcementId,tenantId,userId,now]);
  if(!recipient)return {started:false,reason:'RECIPIENT_INELIGIBLE'};
  const record=await dbGet(`SELECT f.tokenHash,f.cipherText,f.cipherIv,f.cipherTag
    FROM platform_owner_communication_fcm_tokens f
    WHERE f.tenant_id=? AND f.userId=? AND f.deviceHash=? AND f.revokedAt IS NULL`,
    [tenantId,userId,deviceHash]);
  const token=decryptBoundFcmToken({record,tenantId,userId,deviceHash,env});
  if(!token)return {started:false,reason:'TOKEN_UNAVAILABLE'};
  // Unique device/notice identity means concurrent workers cannot send twice.
  const claim=await dbRun(`INSERT OR IGNORE INTO platform_owner_communication_fcm_dispatch
    (announcementId,tenant_id,userId,deviceHash,status,claimedAt,updatedAt)
    SELECT ?,?,?,?,'sending',?,?
    WHERE EXISTS (
      SELECT 1 FROM platform_owner_announcements a
      JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id
      JOIN tenants t ON t.id=r.tenant_id
      JOIN users u ON u.id=r.userId AND u.tenant_id=t.id
      LEFT JOIN platform_ownership p ON p.userId=u.id
      JOIN platform_owner_communication_push_preferences pref
        ON pref.tenant_id=t.id AND pref.userId=u.id
      JOIN platform_owner_communication_devices d
        ON d.tenant_id=t.id AND d.userId=u.id AND d.deviceHash=?
      JOIN platform_owner_communication_fcm_tokens f
        ON f.tenant_id=d.tenant_id AND f.userId=d.userId AND f.deviceHash=d.deviceHash
      WHERE a.id=? AND r.tenant_id=? AND r.userId=?
        AND a.status='published' AND (a.expiresAt IS NULL OR a.expiresAt>?)
        AND t.status='active' AND u.role='owner' AND p.userId IS NULL
        AND pref.optedIn=1 AND d.revokedAt IS NULL AND f.revokedAt IS NULL
    )`,
    [announcementId,tenantId,userId,deviceHash,now,now,
      deviceHash,announcementId,tenantId,userId,now]);
  if(Number(claim?.changes||0)!==1)return {started:false,reason:'ALREADY_CLAIMED_OR_INELIGIBLE'};
  let outcome;
  try{
    outcome=await sendOneSandboxOwnerFcm({
      env,fetcher,token,announcementId,title:recipient.title,body:recipient.body,now
    });
  }catch{outcome={accepted:false,reason:'MANUAL_REVIEW_REQUIRED'}}
  await dbRun(`UPDATE platform_owner_communication_fcm_dispatch
    SET status=?,updatedAt=? WHERE announcementId=? AND tenant_id=?
      AND userId=? AND deviceHash=? AND status='sending'`,
    [outcome.accepted?'accepted':'manual_review',Date.now(),
      announcementId,tenantId,userId,deviceHash]);
  return {started:true,accepted:outcome.accepted===true,deviceDelivered:false};
}
