/**
 * Dormant, one-job-per-tick sandbox email worker foundation.
 *
 * Never imported by the running server, HTTP routes, cron or startup.
 * All network-enabled calls require explicit staging flags, an isolated
 * database attestation, a kill-switch release, a strict configured UTC daily
 * quota and one exact announcement ID. Tests inject a fake transport.
 *
 * Quota reservations are never refunded. A crash may consume quota, which is
 * safer than accidentally sending another email after ambiguous acceptance.
 */
import {sandboxBrevoReady,createSandboxBrevoSender} from './platform-brevo-sandbox.js';
import {previewSandboxOwnerEmailDispatch} from './platform-email-preview.js';
import {processSandboxOwnerEmailQueue} from './platform-email-queue.js';

const ACK='I_APPROVE_STAGING_SANDBOX_WORKER';
export function sandboxWorkerConfig(env={}){
  const cap=Number(env.PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP);
  return {
    enabled:sandboxBrevoReady(env) &&
      env.PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED==='true' &&
      env.PLATFORM_COMMUNICATIONS_EMAIL_STOP==='false' &&
      env.PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK===ACK &&
      Number.isInteger(cap)&&cap>=1&&cap<=5,
    dailyCap:Number.isInteger(cap)&&cap>=1&&cap<=5?cap:0,
    maxPerTick:1,
    schedulerConnected:false
  };
}

export async function runSandboxEmailWorkerTick({
  env={},dbAll,dbGet,dbRun,announcementId,fetcher,now=Date.now()
}={}){
  const cfg=sandboxWorkerConfig(env);
  if(!cfg.enabled)return {started:false,reason:'WORKER_DISABLED'};
  if(typeof announcementId!=='string'||!announcementId.trim()||announcementId.length>180)
    return {started:false,reason:'INVALID_ANNOUNCEMENT'};
  if(!Number.isSafeInteger(now)||now<=0||![dbAll,dbGet,dbRun].every(fn=>typeof fn==='function'))
    return {started:false,reason:'INVALID_RUNTIME'};
  const preview=await previewSandboxOwnerEmailDispatch({
    dbAll,dbGet,announcementId,env,now,limit:2
  });
  if(preview.truncated||preview.eligible!==1||preview.pending!==1||preview.blocked!==0)
    return {started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'};
  const day=new Date(now).toISOString().slice(0,10);
  // The first INSERT establishes the durable daily UTC counter. The following
  // conditional UPDATE is atomic across competing workers on the same DB.
  await dbRun(`INSERT OR IGNORE INTO platform_owner_email_sandbox_quota
    (quotaDay,reservedCount,updatedAt) VALUES (?,0,?)`,[day,now]);
  const reservation=await dbRun(`UPDATE platform_owner_email_sandbox_quota
    SET reservedCount=reservedCount+1,updatedAt=?
    WHERE quotaDay=? AND reservedCount<?`,[now,day,cfg.dailyCap]);
  if(Number(reservation?.changes||0)!==1)
    return {started:false,reason:'DAILY_QUOTA_EXHAUSTED'};
  const send=createSandboxBrevoSender({env,fetcher});
  const result=await processSandboxOwnerEmailQueue({
    dbAll,dbGet,dbRun,send,env,now,announcementId,limit:1
  });
  return {started:true,attempted:result.processed,mailboxDelivered:false};
}
