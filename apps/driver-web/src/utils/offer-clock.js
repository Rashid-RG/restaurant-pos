// The server-issued epoch is authoritative. This helper is presentation-only;
// the server must independently enforce expiration on every claim.
export function offerSecondsRemaining(expiresAt, now=Date.now()){
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=0||!Number.isFinite(now))return null;
  return Math.max(0,Math.ceil((expiresAt-now)/1000));
}
export function offerExpired(expiresAt, now=Date.now()){
  const remaining=offerSecondsRemaining(expiresAt,now);
  return remaining!==null&&remaining===0;
}
