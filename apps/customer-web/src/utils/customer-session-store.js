// Centralized customer session token operations. This remains the EXISTING
// WebView/localStorage backend for compatibility: it is NOT hardware-backed
// secure storage. A future native Keychain/Keystore adapter can replace it
// without scattering session mutations across the app.
//
// Never merge tokens from different restaurants, overwrite a newer login with
// an old request, or clear a token just because the network is unavailable.
import {customerSessionKey} from './customer-auth-scope.js';

export function readCustomerSessionToken(tenant,storage=globalThis.localStorage){
  try{return storage?.getItem(customerSessionKey(tenant))||null;}catch{return null;}
}
export function saveCustomerSessionToken(tenant,token,storage=globalThis.localStorage){
  if(typeof token!=='string'||!token.trim())throw new Error('Customer session token is required.');
  storage.setItem(customerSessionKey(tenant),token);
}
export function clearCustomerSessionToken(tenant,storage=globalThis.localStorage){
  storage.removeItem(customerSessionKey(tenant));
}
// An older 401 or expired tracking response must not log out a newer session.
// Return whether the expected session was actually removed.
export function clearCustomerSessionTokenIfMatch(tenant,expectedToken,storage=globalThis.localStorage){
  if(typeof expectedToken!=='string'||!expectedToken)return false;
  const key=customerSessionKey(tenant);
  if(storage?.getItem(key)!==expectedToken)return false;
  storage.removeItem(key);
  return true;
}
