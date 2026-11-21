import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {secureCustomerAndroidManifest,hardenCustomerAndroid} from '../scripts/harden-food-android.mjs';

const xml='<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="@string/app_name" android:allowBackup="true" android:theme="@style/AppTheme"></application></manifest>';
describe('GastroFlow Food Android data privacy',()=>{
 it('disables backup without altering unrelated app settings or duplicate attributes',()=>{
   const updated=secureCustomerAndroidManifest(xml);
   expect(updated).toContain('android:allowBackup="false"');
   expect(updated).toContain('android:theme="@style/AppTheme"');
   expect(updated).not.toContain('android:allowBackup="true"');
   expect(updated.match(/android:allowBackup=/g)).toHaveLength(1);
   expect(secureCustomerAndroidManifest(updated)).toBe(updated);
 });
 it('blocks malformed native manifests and any root POS invocation',()=>{
   expect(()=>secureCustomerAndroidManifest('x')).toThrow(/refusing/);
   const root=path.resolve('apps/customer-web'),write=vi.fn();
   expect(()=>hardenCustomerAndroid({cwd:process.cwd(),customerRoot:root,exists:()=>true,read:()=>xml,write})).toThrow(/Only apps/);
   expect(write).not.toHaveBeenCalled();
 });
 it('updates only the generated customer Android manifest',()=>{
   const root=path.resolve('apps/customer-web'),write=vi.fn();
   expect(hardenCustomerAndroid({cwd:root,customerRoot:root,exists:()=>true,read:()=>xml,write})).toEqual({changed:true});
   expect(write.mock.calls[0][0]).toBe(path.join(root,'android','app','src','main','AndroidManifest.xml'));
 });
});
