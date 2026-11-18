/**
 * SMS sender copy is tenant-scoped. Callers must load the business name from
 * the same restaurant that owns the OTP challenge, never a global shop.
 */
export function buildTenantOtpSmsMessage({storeName,code}) {
  if(!/^\d{6}$/.test(String(code||'')))throw new TypeError('A six-digit OTP is required');
  const name=typeof storeName==='string'?storeName.trim().replace(/[\r\n\t]+/g,' '):'';
  const label=(name||'GastroFlow').slice(0,60);
  return `Your ${label} verification code is ${code}. Valid for 10 minutes.`;
}
