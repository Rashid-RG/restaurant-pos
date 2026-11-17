// Native tracking resumes should reconcile with the authoritative server
// immediately after the customer returns to the app. Never fabricate progress
// or retry private requests for a completed/revoked order.
const TERMINAL_STATUSES=new Set([
  'delivered','completed','cancelled','rejected','refunded','partially_refunded'
]);
export const NATIVE_RESUME_MIN_INTERVAL_MS=4000;
export function shouldRefreshNativeTrackingOnResume({
  nativeBuild=false,orderId,status,visible=true,online=true,
  now=Date.now(),lastResumeAt=0
}={}){
  if(nativeBuild!==true || !orderId || typeof orderId!=='string')return false;
  if(TERMINAL_STATUSES.has(String(status||'').toLowerCase()))return false;
  if(!visible || !online || !Number.isFinite(now))return false;
  if(Number.isFinite(lastResumeAt) && lastResumeAt>0 &&
     now-lastResumeAt<NATIVE_RESUME_MIN_INTERVAL_MS)return false;
  return true;
}
