// Migration contract for a FUTURE reviewed Capacitor Keychain/Android Keystore
// bridge. Not invoked during ordinary login: no native secure-storage plugin is
// installed yet. Keep existing customer sessions intact until device testing.
//
// secureStore methods must be async get(key), set(key,value), remove(key).
// A caller must verify the adapter's native hardware-backed implementation;
// this module does NOT confer encryption on localStorage.
import {customerSessionKey} from './customer-auth-scope.js';

const locks=new Set();

export async function migrateCustomerTokenToNativeStorage({
  tenant,secureStore,legacyStorage=globalThis.localStorage
}={}){
  if(typeof tenant!=='string'||!tenant.trim())return {status:'invalid-tenant'};
  if(!secureStore || typeof secureStore.get!=='function' ||
    typeof secureStore.set!=='function' || typeof secureStore.remove!=='function')
    return {status:'native-store-unavailable'};

  const key=customerSessionKey(tenant);
  if(locks.has(key))return {status:'migration-in-progress'};
  locks.add(key);
  try{
    const oldToken=legacyStorage?.getItem(key);
    // Do not overwrite a secure-store token: it might belong to a newer login.
    const savedToken=await secureStore.get(key);
    if(savedToken){
      if(oldToken && savedToken===oldToken){
        // The native copy has already been confirmed. Do not remove a
        // freshly rotated token that replaced the old one during async I/O.
        if(legacyStorage.getItem(key)===oldToken)legacyStorage.removeItem(key);
        return {status:'already-migrated'};
      }
      return {status:'secure-session-exists'};
    }
    if(!oldToken)return {status:'no-legacy-session'};
    await secureStore.set(key,oldToken);
    // A successful write acknowledgement is not evidence of persistence.
    const persisted=await secureStore.get(key);
    if(persisted!==oldToken)return {status:'verification-failed'};
    // Never clear a newer legacy login if a user signed in during the copy.
    if(legacyStorage.getItem(key)!==oldToken)return {status:'legacy-session-changed'};
    legacyStorage.removeItem(key);
    return {status:'migrated'};
  }catch{
    // Preserve the old session on bridge, storage, or permission failures.
    return {status:'migration-failed'};
  }finally{
    locks.delete(key);
  }
}
