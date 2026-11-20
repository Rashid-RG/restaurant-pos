/**
 * Brevo sandbox receipt lifecycle recorder. Requires upstream authenticated
 * webhook ingestion; does not contact Brevo or send any email.
 * Never confuse API acceptance with mailbox delivery.
 */
const VALID_EVENTS=new Set(['delivered','hard_bounce','soft_bounce','blocked','invalid','spam','unsubscribed']);
const SUPPRESSION=new Set(['hard_bounce','blocked','invalid','spam','unsubscribed']);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeVerifiedBrevoEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event))return null;
  const messageId=typeof event.messageId==='string'?event.messageId.trim():'';
  const type=typeof event.event==='string'?event.event.trim().toLowerCase():'';
  const email=typeof event.email==='string'?event.email.trim().toLowerCase():'';
  if(!VALID_EVENTS.has(type)||!messageId||messageId.length>255||
    email.length>254||!EMAIL.test(email)||
    !Number.isSafeInteger(event.timestamp)||event.timestamp<=0)return null;
  return {messageId,type,email,timestamp:event.timestamp};
}

export async function recordVerifiedBrevoEvent({dbGet,dbRun,event,verified=false,env={},now=Date.now()}){
  if(!verified||env.PLATFORM_COMMUNICATIONS_STAGE!=='staging'||
    env.PLATFORM_COMMUNICATIONS_ENABLED!=='true'||
    env.PLATFORM_COMMUNICATIONS_EMAIL_MODE!=='sandbox')
    return {recorded:false,reason:'DISABLED_OR_UNVERIFIED'};
  const normalized=normalizeVerifiedBrevoEvent(event);
  if(!normalized)return {recorded:false,reason:'INVALID_EVENT'};
  // Resolve message ID to the exact original queue recipient. Message ID alone
  // is insufficient evidence when a payload has been misrouted or spoofed.
  const receipt=await dbGet(`SELECT r.eventStatus,r.acceptedAt,r.eventAt,q.email AS recipientEmail
    FROM platform_owner_communication_email_receipts r
    JOIN platform_owner_communication_email_queue q
      ON q.announcementId=r.announcementId AND q.tenant_id=r.tenant_id AND q.userId=r.userId
    WHERE r.provider='brevo' AND r.providerMessageId=?`,[normalized.messageId]);
  if(!receipt)return {recorded:false,reason:'UNKNOWN_MESSAGE'};
  if(typeof receipt.recipientEmail!=='string'||
    receipt.recipientEmail.trim().toLowerCase()!==normalized.email)
    return {recorded:false,reason:'RECIPIENT_MISMATCH'};
  // Suppression events are final; later verified suppression may supersede a
  // delivery receipt, but ordinary 'delivered' must not clear suppression.
  if(SUPPRESSION.has(receipt.eventStatus)||
    (receipt.eventStatus==='delivered'&&!SUPPRESSION.has(normalized.type))||
    (receipt.eventAt!==null&&receipt.eventAt!==undefined&&normalized.timestamp<=receipt.eventAt))
    return {recorded:false,reason:'DUPLICATE_OR_STALE'};
  const result=await dbRun(`UPDATE platform_owner_communication_email_receipts
    SET eventStatus=?,eventAt=?,updatedAt=?
    WHERE provider='brevo' AND providerMessageId=?
      AND eventStatus NOT IN ('hard_bounce','blocked','invalid','spam','unsubscribed')
      AND (eventStatus!='delivered' OR ? IN ('hard_bounce','blocked','invalid','spam','unsubscribed'))
      AND (eventAt IS NULL OR eventAt<?)`,
    [normalized.type,normalized.timestamp,now,normalized.messageId,normalized.type,normalized.timestamp]);
  const recorded=Number(result?.changes||0)===1;
  return {recorded,reason:recorded?'UPDATED':'RACED_OR_STALE'};
}
