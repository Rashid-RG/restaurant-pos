/**
 * Manually-invoked, one-message-at-a-time Brevo sandbox run.
 * This module is intentionally NOT imported by routes/server/scheduler.
 * Calling it requires separate operational authorization outside the app.
 */
import {sandboxBrevoReady,createSandboxBrevoSender} from './platform-brevo-sandbox.js';
import {previewSandboxOwnerEmailDispatch} from './platform-email-preview.js';
import {processSandboxOwnerEmailQueue} from './platform-email-queue.js';

export const SANDBOX_SEND_CONFIRMATION='SEND_ONE_APPROVED_SANDBOX_EMAIL';

export async function runOneApprovedSandboxBrevoEmail({
  env={},dbAll,dbGet,dbRun,fetcher,announcementId,confirmation,now=Date.now()
}={}){
  if(!sandboxBrevoReady(env)||
    env.PLATFORM_COMMUNICATIONS_MANUAL_SEND_ENABLED!=='true'||
    confirmation!==SANDBOX_SEND_CONFIRMATION)
    return {started:false,reason:'NOT_AUTHORIZED'};
  if(typeof announcementId!=='string'||!announcementId.trim()||announcementId.length>180)
    return {started:false,reason:'INVALID_ANNOUNCEMENT'};
  if(typeof dbAll!=='function'||typeof dbGet!=='function'||typeof dbRun!=='function')
    return {started:false,reason:'MISSING_STORAGE'};
  // No implicit global batch: require exactly one currently eligible queued
  // recipient for this announcement. Preview is read-only and may be stale;
  // the worker rechecks tenant eligibility and atomically claims the job.
  const preview=await previewSandboxOwnerEmailDispatch({
    dbAll,dbGet,announcementId,env,now,limit:2
  });
  if(preview.truncated||preview.eligible!==1||preview.blocked!==0||preview.pending!==1)
    return {started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE',eligible:preview.eligible,blocked:preview.blocked};
  const sender=createSandboxBrevoSender({env,fetcher});
  const result=await processSandboxOwnerEmailQueue({
    dbAll,dbGet,dbRun,send:sender,env,now,announcementId,limit:1
  });
  // A worker attempt is not proof of API acceptance, delivery, or reading.
  return {started:true,attempted:result.processed,mailboxDelivered:false};
}
