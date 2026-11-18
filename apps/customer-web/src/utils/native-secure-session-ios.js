// Explicitly gated iOS Keychain bridge. This mirrors the Android contract,
// but is not activated for existing login/API sessions before real iPhone tests.
export const IOS_SECURE_SESSION_PLUGIN='GastroFoodSecureSession';

export function createIOSSecureSessionStore({nativeBuild=false,platform,plugin}={}){
  if(nativeBuild!==true || platform!=='ios' || !plugin ||
      typeof plugin.get!=='function' || typeof plugin.set!=='function' ||
      typeof plugin.remove!=='function')return null;
  const validateKey=(key)=>{
    if(typeof key!=='string' || !key.startsWith('gastroflow_customer_token:') ||
       key.length<='gastroflow_customer_token:'.length || key.length>256)
      throw new Error('Invalid customer session key');
  };
  return {
    async get(key){
      validateKey(key);
      const result=await plugin.get({key});
      if(result?.value==null)return null;
      if(typeof result.value!=='string')throw new Error('Invalid secure session response');
      return result.value;
    },
    async set(key,value){
      validateKey(key);
      if(typeof value!=='string'||!value||value.length>8192)
        throw new Error('Invalid customer session token');
      await plugin.set({key,value});
    },
    async remove(key){
      validateKey(key);
      await plugin.remove({key});
    }
  };
}
