/**
 * Brevo sandbox lifecycle tracking. No public webhook endpoint and no network calls.
 * Only a separately authenticated provider-event ingestor may call recordVerifiedBrevoEvent.
 * Provider acceptance is not equivalent to mailbox delivery.
 */
const VALID_EVENTS=new Set(['delivered','hard_bounce','soft_bounce','blocked','invalid','spam','unsubscribed']);
const TERMINAL=new Set(['delivered','hard_bounce','blocked','invalid','spam','unsubscribed']);
export function normalizeVerifiedBrevoEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event))return null;
  const messageId=String(event.messageId||'').trim();
  const type=String(event.event||'').trim().toLowerCase();
  if(!VALID_EVENTS.has(type)||!messageId||messageId.length>255||!Number.isSafeInteger(event.timestamp)||event.timestamp<=0)return null;
  return {messageId,type,timestamp:event.timestamp};
}
export async function recordVerifiedBrevoEvent({dbGet,dbRun,event,verified=false,env={},now=Date.now()}){
  if(!verified||env.PLATFORM_COMMUNICATIONS_STAGE!=='staging'||
    env.PLATFORM_COMMUNICATIONS_ENABLED!=='true'||
    env.PLATFORM_COMMUNICATIONS_EMAIL_MODE!=='sandbox')return {recorded:false,reason:'DISABLED_OR_UNVERIFIED'};
  const normalized=normalizeVerifiedBrevoEvent(event);
  if(!normalized)return {recorded:false,reason:'INVALID_EVENT'};
  const receipt=await dbGet(`SELECT eventStatus,acceptedAt,eventAt
    FROM platform_owner_communication_email_receipts WHERE provider='brevo' AND providerMessageId=?`,[normalized.messageId]);
  if(!receipt)return {recorded:false,reason:'UNKNOWN_MESSAGE'};
  if(TERMINAL.has(receipt.eventStatus)||receipt.eventAt&&normalized.timestamp<=receipt.eventAt)
    return {recorded:false,reason:'DUPLICATE_OR_STALE'};
  const result=await dbRun(`UPDATE platform_owner_communication_email_receipts
    SET eventStatus=?,eventAt=?,updatedAt=?
    WHERE provider='brevo' AND providerMessageId=?
    AND eventStatus NOT IN ('delivered','hard_bounce','blocked','invalid','spam','unsubscribed')
    AND (eventAt IS NULL OR eventAt<?)`,
    [normalized.type,normalized.timestamp,now,normalized.messageId,normalized.timestamp]);
  return {recorded:Number(result?.changes||0)===1,reason:Number(result?.changes||0)===1?'UPDATED':'RACED_OR_STALE'};
}
