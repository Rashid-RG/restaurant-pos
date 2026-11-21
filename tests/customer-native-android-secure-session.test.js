import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createAndroidSecureSessionStore,ANDROID_SECURE_SESSION_PLUGIN}
  from '../apps/customer-web/src/utils/native-secure-session-android.js';

const key='gastroflow_customer_token:restaurant-a';
function fakePlugin(){
 const saved=new Map();
 return {
   get:vi.fn(async ({key})=>({value:saved.get(key)??null})),
   set:vi.fn(async ({key,value})=>{saved.set(key,value)}),
   remove:vi.fn(async ({key})=>{saved.delete(key)})
 };
}
describe('GastroFlow Food Android Keystore bridge boundaries',()=>{
 it('never creates a browser or iOS adapter, or falls back when native bridge is missing',()=>{
   const plugin=fakePlugin();
   expect(createAndroidSecureSessionStore({nativeBuild:false,platform:'android',plugin})).toBeNull();
   expect(createAndroidSecureSessionStore({nativeBuild:true,platform:'ios',plugin})).toBeNull();
   expect(createAndroidSecureSessionStore({nativeBuild:true,platform:'android'})).toBeNull();
 });
 it('adapts get, set and remove without exposing raw localStorage',async()=>{
   const plugin=fakePlugin();
   const store=createAndroidSecureSessionStore({nativeBuild:true,platform:'android',plugin});
   expect(ANDROID_SECURE_SESSION_PLUGIN).toBe('GastroFoodSecureSession');
   expect(await store.get(key)).toBeNull();
   await store.set(key,'a-private-token');
   expect(await store.get(key)).toBe('a-private-token');
   await store.remove(key);
   expect(await store.get(key)).toBeNull();
 });
 it('validates the token scope and values before calling native code',async()=>{
   const plugin=fakePlugin();
   const store=createAndroidSecureSessionStore({nativeBuild:true,platform:'android',plugin});
   await expect(store.set('gastroflow_pos_token','x')).rejects.toThrow(/session key/);
   await expect(store.set(key,'')).rejects.toThrow(/session token/);
   await expect(store.get('gastroflow_customer_token:')).rejects.toThrow(/session key/);
   await expect(store.set(key,'x'.repeat(8193))).rejects.toThrow(/session token/);
   expect(plugin.set).not.toHaveBeenCalled();
 });
 it('propagates native storage errors instead of silently storing raw tokens',async()=>{
   const plugin=fakePlugin();
   plugin.set.mockRejectedValueOnce(new Error('KeyStore unavailable'));
   const store=createAndroidSecureSessionStore({nativeBuild:true,platform:'android',plugin});
   await expect(store.set(key,'token')).rejects.toThrow(/KeyStore unavailable/);
 });
 it('confirms Android uses AES-GCM Keystore and registers only this customer plugin',()=>{
   const java=readFileSync('apps/customer-web/android/app/src/main/java/com/rstechnologies/gastrofood/FoodSecureSessionPlugin.java','utf8');
   const activity=readFileSync('apps/customer-web/android/app/src/main/java/com/rstechnologies/gastrofood/MainActivity.java','utf8');
   expect(java).toContain('@CapacitorPlugin(name = "GastroFoodSecureSession")');
   expect(java).toContain('AndroidKeyStore');
   expect(java).toContain('AES/GCM/NoPadding');
   expect(java).toContain('cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8))');
   expect(java).toContain('preferences().edit().putString');
   expect(java).not.toContain('Log.d(');
   expect(activity).toContain('registerPlugin(FoodSecureSessionPlugin.class)');
 });
});
