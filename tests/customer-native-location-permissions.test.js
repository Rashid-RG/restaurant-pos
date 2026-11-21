import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {
  LOCATION_PURPOSE,withAndroidLocationPermissions,withIosLocationPurpose,
  nativePermissionPaths,applyCustomerLocationPermissions
} from '../scripts/setup-food-native-location-permissions.mjs';

const xml='<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="GastroFlow Food"></application>\n</manifest>';
const plist='<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>GastroFlow Food</string></dict></plist>';

describe('GastroFlow Food native foreground location permissions',()=>{
  it('adds only coarse/fine foreground permissions and keeps GPS hardware optional',()=>{
    const updated=withAndroidLocationPermissions(xml);
    expect(updated).toContain('android.permission.ACCESS_COARSE_LOCATION');
    expect(updated).toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(updated).toContain('android:required="false"');
    expect(updated).not.toContain('ACCESS_BACKGROUND_LOCATION');
    expect(withAndroidLocationPermissions(updated)).toBe(updated);
  });
  it('adds a human-readable iOS when-in-use purpose and remains idempotent',()=>{
    const updated=withIosLocationPurpose(plist);
    expect(updated).toContain('<key>NSLocationWhenInUseUsageDescription</key>');
    expect(updated).toContain(LOCATION_PURPOSE);
    expect(updated).not.toContain('UIBackgroundModes');
    expect(withIosLocationPurpose(updated)).toBe(updated);
  });
  it('refuses invalid manifests without changing any files',()=>{
    expect(()=>withAndroidLocationPermissions('<application/>')).toThrow(/Unexpected/);
    expect(()=>withIosLocationPurpose('<dict/>')).toThrow(/Unexpected/);
  });
  it('cannot apply native permissions to the root POS or a missing platform project',()=>{
    const root=path.resolve('apps/customer-web'), paths=nativePermissionPaths(root);
    expect(paths.android).toContain(path.join('apps','customer-web','android'));
    const write=vi.fn();
    expect(()=>applyCustomerLocationPermissions({cwd:path.resolve('.'),projectRoot:root,platform:'android',write})).toThrow(/Only apps/);
    expect(()=>applyCustomerLocationPermissions({cwd:root,projectRoot:root,platform:'android',exists:()=>false,write})).toThrow(/does not exist/);
    expect(write).not.toHaveBeenCalled();
  });
  it('edits only the intended customer native file when explicitly invoked',()=>{
    const root=path.resolve('apps/customer-web'),write=vi.fn();
    const result=applyCustomerLocationPermissions({cwd:root,projectRoot:root,platform:'ios',exists:()=>true,read:()=>plist,write});
    expect(result).toEqual({changed:true,platform:'ios'});
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain(path.join('apps','customer-web','ios'));
  });
});
