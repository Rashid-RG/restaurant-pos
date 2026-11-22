/**
 * Restricted staging Brevo transactional webhook authentication and normalization.
 * Uses Brevo's configured bearer authentication, not a fictional provider signature.
 * Treat the bearer value as a server-only credential.
 */
import crypto from 'node:crypto';

export function brevoWebhookEnabled(env={}){
  return env.PLATFORM_COMMUNICATIONS_ENABLED==='true' &&
    env.PLATFORM_COMMUNICATIONS_STAGE==='staging' &&
    env.PLATFORM_COMMUNICATIONS_EMAIL_MODE==='sandbox' &&
    env.PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED==='true' &&
    env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED==='true' &&
    typeof env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN==='string' &&
    env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN.length>=32;
}

export function authenticateBrevoWebhook(authorization,env={}){
  if(!brevoWebhookEnabled(env)||typeof authorization!=='string')return false;
  const match=/^Bearer ([A-Za-z0-9._~+\/-]{32,512})$/.exec(authorization);
  if(!match)return false;
  const a=crypto.createHash('sha256').update(match[1]).digest();
  const b=crypto.createHash('sha256').update(env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN).digest();
  return crypto.timingSafeEqual(a,b);
}

const EVENT_MAP=Object.freeze({
  delivered:'delivered',hard_bounce:'hard_bounce',hardbounce:'hard_bounce',
  soft_bounce:'soft_bounce',softbounce:'soft_bounce',
  blocked:'blocked',invalid:'invalid',invalid_email:'invalid',
  spam:'spam',unsubscribed:'unsubscribed'
});

export function normalizeBrevoTransactionalPayload(payload,now=Date.now()){
  if(!payload||Array.isArray(payload)||typeof payload!=='object')return null;
  const event=EVENT_MAP[String(payload.event||'').trim().toLowerCase()];
  const messageId=payload['message-id'];
  const email=typeof payload.email==='string'?payload.email.trim().toLowerCase():'';
  if(!event||typeof messageId!=='string'||!messageId.trim()||messageId.length>255||
    email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return null;
  // Brevo specifies ts_event as epoch seconds; accept integer epoch milliseconds
  // only in ts_epoch, never free-form local timezone dates.
  const seconds=payload.ts_event;
  const millis=Number.isSafeInteger(seconds)&&seconds>0?seconds*1000:
    (Number.isSafeInteger(payload.ts_epoch)?payload.ts_epoch:null);
  if(!Number.isSafeInteger(millis)||millis<=0||millis>now+5*60_000||
    millis<now-90*86400_000)return null;
  return {event,messageId:messageId.trim(),email,timestamp:millis};
}
