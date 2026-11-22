import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createIOSSecureSessionStore,IOS_SECURE_SESSION_PLUGIN}
  from '../apps/customer-web/src/utils/native-secure-session-ios.js';

function pluginFixture(){
  const values=new Map();
  return {
    get:vi.fn(async({key})=>({value:values.get(key)??null})),
    set:vi.fn(async({key,value})=>{values.set(key,value)}),
    remove:vi.fn(async({key})=>{values.delete(key)})
  };
}

describe('GastroFlow Food iPhone Keychain plugin contract',()=>{
  const key='gastroflow_customer_token:tenant-a';
  it('refuses hosted, Android and missing iOS native bridges',()=>{
    const plugin=pluginFixture();
    expect(createIOSSecureSessionStore({nativeBuild:false,platform:'ios',plugin})).toBeNull();
    expect(createIOSSecureSessionStore({nativeBuild:true,platform:'android',plugin})).toBeNull();
    expect(createIOSSecureSessionStore({nativeBuild:true,platform:'ios'})).toBeNull();
    expect(IOS_SECURE_SESSION_PLUGIN).toBe('GastroFoodSecureSession');
  });
  it('supports only a named restaurant session and propagates storage failures',async()=>{
    const plugin=pluginFixture();
    const store=createIOSSecureSessionStore({nativeBuild:true,platform:'ios',plugin});
    expect(await store.get(key)).toBeNull();
    await store.set(key,'a-token');
    expect(await store.get(key)).toBe('a-token');
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.set('pos-admin-token','x')).rejects.toThrow(/session key/);
    await expect(store.set(key,'')).rejects.toThrow(/session token/);
    plugin.set.mockRejectedValueOnce(new Error('Keychain locked'));
    await expect(store.set(key,'token')).rejects.toThrow(/Keychain locked/);
  });
  it('requires Swift Keychain, device-only accessibility, and generated app registration',()=>{
    const swift=readFileSync('scripts/native/ios/GastroFoodSecureSessionPlugin.swift','utf8');
    const controller=readFileSync('scripts/native/ios/GastroFoodViewController.swift','utf8');
    const installer=readFileSync('scripts/setup-food-ios-secure-session.rb','utf8');
    const workflow=readFileSync('.github/workflows/food-native-ios-simulator.yml','utf8');
    expect(swift).toContain('CAPPlugin, CAPBridgedPlugin');
    expect(swift).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(swift).toContain('kSecAttrSynchronizable');
    expect(swift).toContain('SecItemCopyMatching');
    expect(swift).toContain('SecItemAdd');
    expect(swift).toContain('SecItemDelete');
    expect(controller).toContain('registerPluginInstance(GastroFoodSecureSessionPlugin())');
    expect(installer).toContain('GastroFoodViewController');
    expect(workflow).toContain('ruby scripts/setup-food-ios-secure-session.rb');
    expect(workflow).toContain('CODE_SIGNING_ALLOWED=NO');
  });
});
