// Explicit opt-in for packaged mobile WebView origins.
// This does not grant authentication or access to another tenant.
const ALLOWED_NATIVE_ORIGINS = new Set(['capacitor://localhost','https://localhost']);
export function configuredNativeOrigins(value='') {
  return String(value || '').split(',').map(s=>s.trim()).filter(Boolean)
    .filter((s,i,arr)=>ALLOWED_NATIVE_ORIGINS.has(s) && arr.indexOf(s)===i);
}
export function invalidNativeOriginEntries(value='') {
  return String(value || '').split(',').map(s=>s.trim()).filter(Boolean)
    .filter(s=>!ALLOWED_NATIVE_ORIGINS.has(s));
}
