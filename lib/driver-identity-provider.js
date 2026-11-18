import crypto from 'node:crypto';

/**
 * Provider-controlled automated driver identity review.
 * Only genuine signed Veriff decisions can update identity evidence.
 * No document images, NIC numbers or biometric templates are stored locally.
 */
export function veriffConfigured(env = process.env) {
  return Boolean(env.VERIFF_API_KEY && env.VERIFF_SHARED_SECRET && env.VERIFF_BASE_URL);
}
export function trustedVeriffBase(raw) {
  // Never accept end-user-controlled provider hosts or credentials via query parameters.
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || !/(^|\.)veriff\.com$/i.test(url.hostname)) {
    throw new Error('VERIFF_BASE_URL must be a Veriff HTTPS API origin');
  }
  return url.origin;
}
export function veriffHmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
export function verifyVeriffWebhook({rawBody,signature,authClient,env=process.env}) {
  if (!veriffConfigured(env) || !Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > 131072 ||
      typeof signature!=='string' || !/^[0-9a-f]{64}$/i.test(signature) ||
      typeof authClient!=='string' || authClient!==env.VERIFF_API_KEY) return false;
  const actual=Buffer.from(signature,'hex');
  const expected=Buffer.from(veriffHmac(rawBody,env.VERIFF_SHARED_SECRET),'hex');
  return crypto.timingSafeEqual(actual,expected);
}
export function interpretVeriffDecision(payload) {
  const verification=payload?.verification;
  if (!verification || typeof verification.id!=='string') return null;
  const outcome=String(verification.status || '').toLowerCase();
  const state=outcome==='approved' ? 'verified' :
    outcome==='declined' ? 'rejected' :
    outcome==='resubmission_requested' ? 'resubmit' :
    ['expired','abandoned'].includes(outcome) ? 'expired' : 'review';
  return {sessionId:verification.id,state};
}
export async function createVeriffSession({driverId,env=process.env,fetchImpl=fetch}) {
  if (!veriffConfigured(env)) throw new Error('Identity verification provider is not configured');
  if (typeof driverId!=='string' || !/^drv_[a-z0-9-]{10,80}$/i.test(driverId)) throw new Error('Invalid application ID');
  const origin=trustedVeriffBase(env.VERIFF_BASE_URL);
  const body=JSON.stringify({verification:{vendorData:driverId}});
  const response=await fetchImpl(origin+'/v1/sessions',{
    method:'POST',
    headers:{'content-type':'application/json','x-auth-client':env.VERIFF_API_KEY,
      'x-hmac-signature':veriffHmac(body,env.VERIFF_SHARED_SECRET)},
    body,signal:AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new Error('Verification provider did not create a session');
  const data=await response.json();
  const session=data?.verification;
  if(!session?.id || !session?.url) throw new Error('Provider returned incomplete session');
  const link=new URL(session.url);
  if(link.protocol!=='https:' || !/(^|\.)veriff\.com$/i.test(link.hostname)) throw new Error('Untrusted verification link');
  return {sessionId:session.id,url:session.url};
}
