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
export function interpretVeriffDecision(payload,checkType='identity',now=Date.now()) {
  const verification=payload?.verification;
  if (!verification || typeof verification.id!=='string' || !verification.id.trim()) return null;
  const outcome=String(verification.status || '').toLowerCase();
  let state=outcome==='approved' ? 'verified' :
    outcome==='declined' ? 'rejected' :
    outcome==='resubmission_requested' ? 'resubmit' :
    ['expired','abandoned'].includes(outcome) ? 'expired' : 'review';
  let documentExpiry=null;
  if(checkType==='driving_licence' && state==='verified') {
    const doc=verification.document;
    // Never mistake a successful passport/NIC or non-LK permit for a valid LK driving licence.
    if(doc?.type!=='DRIVERS_LICENSE' || doc.country!=='LK' ||
       doc?.specimen?.nonStandardDrivingLicense===true || doc?.specimen?.hasSecurityRisk===true) {
      state='review';
    } else {
      // Veriff only extracts validUntil when the integration is enabled; missing dates
      // require human review and must not become an invented expiry or entitlement.
      const date=doc.validUntil;
      if(typeof date!=='string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) state='review';
      else {
        const expiry=Date.parse(date+'T23:59:59.999Z');
        if(!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0,10)!==date || expiry<=now)
          state='review';
        else documentExpiry=date;
      }
    }
  }
  return {sessionId:verification.id,state,...(checkType==='driving_licence'?{documentExpiry}: {})};
}
export function drivingLicenceProviderEnabled(env=process.env) {
  return veriffConfigured(env) && env.VERIFF_DRIVER_LICENCE_ENABLED==='true';
}
export async function createVeriffSession({driverId,checkType='identity',env=process.env,fetchImpl=fetch}) {
  if (!['identity','driving_licence'].includes(checkType)) throw new Error('Invalid verification purpose');
  if (!veriffConfigured(env)) throw new Error('Identity verification provider is not configured');
  if (typeof driverId!=='string' || !/^drv_[a-z0-9-]{10,80}$/i.test(driverId)) throw new Error('Invalid application ID');
  const origin=trustedVeriffBase(env.VERIFF_BASE_URL);
  const body=JSON.stringify({verification:{vendorData:driverId,...(checkType==='driving_licence'?{document:{type:'DRIVERS_LICENSE',country:'LK'}}:{})}});
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
