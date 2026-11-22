// JavaScript bridge contract for the first Android Keystore implementation.
// It is NOT active for customer authentication until an approved migration
// has been tested on a signed physical-device build. iPhone must use its own
// reviewed Keychain plugin; never silently fall back to WebView storage.
export const ANDROID_SECURE_SESSION_PLUGIN='GastroFoodSecureSession';

export function createAndroidSecureSessionStore({nativeBuild=false,platform,plugin}={}){
  if(nativeBuild!==true || platform!=='android' ||
    !plugin || typeof plugin.get!=='function' ||
    typeof plugin.set!=='function' || typeof plugin.remove!=='function')return null;

  const assertKey=key=>{
    if(typeof key!=='string'||!key.startsWith('gastroflow_customer_token:')||
       key.length>'gastroflow_customer_token:'.length+220||
       key.length<='gastroflow_customer_token:'.length)
      throw new Error('Invalid customer session key');
  };
  return {
    async get(key){
      assertKey(key);
      const result=await plugin.get({key});
      if(result?.value==null)return null;
      if(typeof result.value!=='string')throw new Error('Invalid secure session response');
      return result.value;
    },
    async set(key,value){
      assertKey(key);
      if(typeof value!=='string'||!value||value.length>8192)
        throw new Error('Invalid customer session token');
      await plugin.set({key,value});
    },
    async remove(key){
      assertKey(key);
      await plugin.remove({key});
    }
  };
}
