/**
 * Staging-only platform-owner communication email queue.
 *
 * This module never imports production notification senders and has no automatic
 * server hook. A dedicated staging worker must inject a provider explicitly.
 * Never use it with real customer destinations.
 */
const ADDRESS=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeSandboxAddress(value){
  const result=String(value||'').trim().toLowerCase();
  return result.length<=254&&ADDRESS.test(result)?result:null;
}
export function sandboxEmailConfig(env={}){
  const allowed=new Set(String(env.PLATFORM_COMMUNICATIONS_TEST_EMAILS||'').split(',')
    .map(normalizeSandboxAddress).filter(Boolean));
  return {
    allowed,
    enabled:env.PLATFORM_COMMUNICATIONS_ENABLED==='true' &&
      env.PLATFORM_COMMUNICATIONS_STAGE==='staging' &&
      env.PLATFORM_COMMUNICATIONS_EMAIL_ENABLED==='true' &&
      env.PLATFORM_COMMUNICATIONS_EMAIL_MODE==='sandbox' && allowed.size>0
  };
}
export function sandboxEmailAllowed(address,env={}){
  const config=sandboxEmailConfig(env);
  const normalized=normalizeSandboxAddress(address);
  return Boolean(config.enabled&&normalized&&config.allowed.has(normalized));
}
export function emailRetryDelayMs(attempt){
  const n=Math.min(6,Math.max(1,Math.trunc(Number(attempt)||1)));
  return Math.min(6*60*60*1000,60_000*2**(n-1));
}
export function canRetryEmail(status,attemptCount){
  return ['pending','retry'].includes(status)&&Number(attemptCount)<5;
}
/** Records are always inserted as blocked unless an explicit sandbox allowlist
 * authorizes a known test address. Unverified owner emails never enter the queue. */
export async function enqueueSandboxOwnerEmails({dbAll,dbRun,announcementId,env={},now=Date.now()}){
  const configuration=sandboxEmailConfig(env);
  if(!configuration.enabled)return {queued:0,blocked:0,disabled:true};
  const rows=await dbAll(`SELECT r.tenant_id AS tenantId,r.userId,u.email,a.status,a.expiresAt,t.status AS tenantStatus
    FROM platform_owner_announcement_recipients r
    JOIN users u ON u.id=r.userId AND u.tenant_id=r.tenant_id AND u.role='owner'
    JOIN tenants t ON t.id=r.tenant_id
    JOIN platform_owner_announcements a ON a.id=r.announcementId
    LEFT JOIN platform_ownership p ON p.userId=u.id
    WHERE r.announcementId=? AND p.userId IS NULL`,[announcementId]);
  let queued=0,blocked=0;
  for(const row of rows){
    if(row.status!=='published'||row.tenantStatus!=='active'||(row.expiresAt&&row.expiresAt<=now)){
      blocked++;continue;
    }
    const address=normalizeSandboxAddress(row.email);
    if(!address||!configuration.allowed.has(address)){blocked++;continue;}
    const result=await dbRun(`INSERT OR IGNORE INTO platform_owner_communication_email_queue
      (announcementId,tenant_id,userId,email,status,attemptCount,nextAttemptAt,createdAt,updatedAt)
      VALUES (?,?,?,?,'pending',0,?,?,?)`,[announcementId,row.tenantId,row.userId,address,now,now,now]);
    queued+=Number(result?.changes||0);
  }
  return {queued,blocked,disabled:false};
}
/**
 * An injected send function is required. Sender is invoked only after rechecking
 * the allowlist, recipient ownership and active tenant status.
 * Ambiguous provider errors are marked manual_review instead of blind retry,
 * to avoid duplicate customer-facing mail.
 */
export async function processSandboxOwnerEmailQueue({dbAll,dbGet,dbRun,send,env={},now=Date.now(),limit=10,announcementId=null}){
  if(!sandboxEmailConfig(env).enabled)return {processed:0,disabled:true};
  if(typeof send!=='function')throw new TypeError('A staging sandbox email transport is required.');
  const cap=Math.min(25,Math.max(1,Math.trunc(Number(limit)||10)));
  const rows=await dbAll(`SELECT announcementId,tenant_id AS tenantId,userId,email,status,attemptCount
    FROM platform_owner_communication_email_queue
    WHERE status IN ('pending','retry') AND nextAttemptAt<=?
    ${announcementId?'AND announcementId=?':''}
    ORDER BY nextAttemptAt LIMIT ${cap}`,announcementId?[now,announcementId]:[now]);
  let processed=0;
  for(const job of rows){
    if(!canRetryEmail(job.status,job.attemptCount))continue;
    const address=normalizeSandboxAddress(job.email);
    if(!sandboxEmailAllowed(address,env))continue;
    // Never trust queued user and tenant IDs without checking current membership.
    const data=await dbGet(`SELECT a.title,a.body,a.status,a.expiresAt,t.status AS tenantStatus,
       u.email, u.role,CASE WHEN p.userId IS NOT NULL THEN 1 ELSE 0 END AS isPlatformAdmin
       FROM platform_owner_announcements a
       JOIN tenants t ON t.id=?
       JOIN users u ON u.id=? AND u.tenant_id=t.id
       LEFT JOIN platform_ownership p ON p.userId=u.id
       JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id AND r.tenant_id=t.id AND r.userId=u.id
       WHERE a.id=?`,[job.tenantId,job.userId,job.announcementId]);
    if(!data||data.status!=='published'||data.tenantStatus!=='active'||data.role!=='owner'
      ||data.isPlatformAdmin|| (data.expiresAt&&data.expiresAt<=now)
      ||normalizeSandboxAddress(data.email)!==address)continue;
    // Conditional claim: only one worker can move this particular job to sending.
    const claim=await dbRun(`UPDATE platform_owner_communication_email_queue
      SET status='sending',attemptCount=attemptCount+1,lastAttemptAt=?,updatedAt=?
      WHERE announcementId=? AND tenant_id=? AND userId=? AND status=? AND attemptCount=?`,
      [now,now,job.announcementId,job.tenantId,job.userId,job.status,job.attemptCount]);
    if(Number(claim?.changes||0)!==1)continue;
    try{
      const receipt=await send({to:address,subject:data.title,text:data.body,
        idempotencyKey:`${job.announcementId}:${job.tenantId}:${job.userId}`});
      if(receipt?.success!==true)throw new Error('Provider did not confirm acceptance.');
      await dbRun(`UPDATE platform_owner_communication_email_queue
        SET status='accepted',deliveredAt=?,updatedAt=?,lastErrorCode=NULL
        WHERE announcementId=? AND tenant_id=? AND userId=? AND status='sending'`,
        [Date.now(),Date.now(),job.announcementId,job.tenantId,job.userId]);
    }catch{
      // Do not blindly retry after a potentially successful provider delivery.
      await dbRun(`UPDATE platform_owner_communication_email_queue
        SET status='manual_review',lastErrorCode='DELIVERY_UNCONFIRMED',updatedAt=?
        WHERE announcementId=? AND tenant_id=? AND userId=? AND status='sending'`,
        [Date.now(),job.announcementId,job.tenantId,job.userId]);
    }
    processed++;
  }
  return {processed,disabled:false};
}

/**
 * Provider request may have completed before the worker crashed.
 * Recover old 'sending' claims to manual review, never automatic retry.
 * No side effects are performed when staging sandbox delivery is disabled.
 */
export async function reconcileStaleSandboxEmailClaims({dbRun,env={},now=Date.now(),staleAfterMs=15*60_000}){
  if(!sandboxEmailConfig(env).enabled)return {disabled:true,reviewRequired:0};
  const age=Math.max(60_000,Math.trunc(Number(staleAfterMs)||0));
  const result=await dbRun(`UPDATE platform_owner_communication_email_queue
    SET status='manual_review',lastErrorCode='STALE_SENDING_UNCONFIRMED',updatedAt=?
    WHERE status='sending' AND lastAttemptAt IS NOT NULL AND lastAttemptAt<?`,
    [now,now-age]);
  return {disabled:false,reviewRequired:Number(result?.changes||0)};
}

/** A reviewer may safely close an uncertain attempt as failed, without sending again. */
export async function closeSandboxEmailReview({dbRun,announcementId,tenantId,userId,now=Date.now()}){
  const result=await dbRun(`UPDATE platform_owner_communication_email_queue
    SET status='failed',lastErrorCode='CLOSED_BY_REVIEWER',updatedAt=?
    WHERE announcementId=? AND tenant_id=? AND userId=? AND status='manual_review'`,
    [now,announcementId,tenantId,userId]);
  return Number(result?.changes||0)===1;
}
