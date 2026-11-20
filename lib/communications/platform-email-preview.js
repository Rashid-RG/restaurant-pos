/**
 * Side-effect-free staging email eligibility report. Never invokes a sender.
 * No email addresses or personal data leave this function.
 */
import {normalizeSandboxAddress,sandboxEmailConfig,canRetryEmail} from './platform-email-queue.js';

const DEFAULT_LIMIT=100;
export async function previewSandboxOwnerEmailDispatch({
  dbAll,dbGet,announcementId,env={},now=Date.now(),limit=DEFAULT_LIMIT
}){
  const config=sandboxEmailConfig(env);
  if(!config.enabled)return {enabled:false,eligible:0,blocked:0,pending:0,reasons:[],truncated:false};
  const cap=Math.min(500,Math.max(1,Math.trunc(Number(limit)||DEFAULT_LIMIT)));
  const rows=await dbAll(`SELECT q.announcementId,q.tenant_id AS tenantId,q.userId,q.email,q.status,
    q.attemptCount,q.nextAttemptAt
    FROM platform_owner_communication_email_queue q
    WHERE q.announcementId=?
    ORDER BY q.createdAt,q.tenant_id,q.userId LIMIT ${cap+1}`,[announcementId]);
  const results={enabled:true,eligible:0,blocked:0,pending:0,reasons:{},truncated:rows.length>cap};
  const reason=(key)=>{results.blocked++;results.reasons[key]=(results.reasons[key]||0)+1;};
  for(const row of rows.slice(0,cap)){
    if(!['pending','retry'].includes(row.status)){reason('not_pending');continue}
    results.pending++;
    if(!canRetryEmail(row.status,row.attemptCount)){reason('attempt_limit');continue}
    if(!row.nextAttemptAt||row.nextAttemptAt>now){reason('not_due');continue}
    const address=normalizeSandboxAddress(row.email);
    if(!address||!config.allowed.has(address)){reason('outside_allowlist');continue}
    const data=await dbGet(`SELECT a.status,a.expiresAt,t.status AS tenantStatus,u.role,u.email,
      CASE WHEN p.userId IS NOT NULL THEN 1 ELSE 0 END AS isPlatformAdmin
      FROM platform_owner_announcements a
      JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id
      JOIN tenants t ON t.id=r.tenant_id
      JOIN users u ON u.id=r.userId AND u.tenant_id=r.tenant_id
      LEFT JOIN platform_ownership p ON p.userId=u.id
      WHERE a.id=? AND r.tenant_id=? AND r.userId=?`,
      [announcementId,row.tenantId,row.userId]);
    if(!data||data.status!=='published'||(data.expiresAt&&data.expiresAt<=now)){reason('notice_unavailable');continue}
    if(data.tenantStatus!=='active'||data.role!=='owner'||data.isPlatformAdmin){reason('owner_ineligible');continue}
    if(normalizeSandboxAddress(data.email)!==address){reason('email_changed');continue}
    results.eligible++;
  }
  return {...results,reasons:Object.entries(results.reasons).map(([code,count])=>({code,count}))};
}
