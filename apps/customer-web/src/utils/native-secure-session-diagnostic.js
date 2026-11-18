// Non-destructive diagnostic for verified Android Keystore and iOS Keychain
// plugins. This uses only an ephemeral random test token; it never reads,
// changes or migrates actual customer login credentials.
//
// Must be called explicitly with a platform-specific native adapter after
// installation on a test phone/simulator. Do NOT run on app startup.
export async function verifyNativeSecureSessionBridge({
  secureStore,randomUUID=globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
}={}){
  if(!secureStore || ['get','set','remove'].some(name=>typeof secureStore[name]!=='function') ||
     typeof randomUUID!=='function')return {ready:false,reason:'native-bridge-unavailable'};
  const nonce=randomUUID();
  if(typeof nonce!=='string'||!/^[0-9a-f-]{36}$/i.test(nonce))
    return {ready:false,reason:'secure-random-unavailable'};
  const key='gastroflow_customer_token:__native_probe_'+nonce;
  const value='native-probe-'+randomUUID();
  let written=false;
  try{
    // Unique test key prevents touching another tenant's actual session.
    if(await secureStore.get(key)!==null)return {ready:false,reason:'probe-key-collision'};
    await secureStore.set(key,value);
    written=true;
    if(await secureStore.get(key)!==value)return {ready:false,reason:'native-readback-failed'};
    await secureStore.remove(key);
    written=false;
    if(await secureStore.get(key)!==null)return {ready:false,reason:'native-delete-failed'};
    return {ready:true,reason:'verified'};
  }catch{
    // No exception text is returned: some providers include sensitive keys.
    return {ready:false,reason:'native-bridge-error'};
  }finally{
    if(written){
      // On failures, try to remove the disposable probe only. Never throw a
      // secondary cleanup error or touch any real customer token.
      try{await secureStore.remove(key);}catch{}
    }
  }
}
