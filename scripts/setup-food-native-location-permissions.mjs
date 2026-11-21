// Location permission setup for the isolated GastroFlow Food native shell.
// Only modifies project files created by Capacitor under apps/customer-web.
// Run after cap add, not before. Explicit opt-in; no background tracking.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const LOCATION_PURPOSE = 'GastroFlow Food uses your location when you choose to find nearby restaurants and set a delivery pin. You can also select a location manually.';

export function withAndroidLocationPermissions(xml) {
  if (!/<manifest\b[^>]*>/i.test(xml) || !/<application\b/i.test(xml))
    throw new Error('Unexpected AndroidManifest.xml; refusing to modify');
  const permissions = ['ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION'];
  let result=xml;
  const added=permissions.filter(permission=>!new RegExp('android:name=["\\\']android\\.permission\\.'+permission+'["\\\']').test(result));
  if(added.length) {
    const block=added.map(p=>'    <uses-permission android:name="android.permission.'+p+'" />').join('\n')+'\n';
    result=result.replace(/(<application\b)/i,block+'    $1');
  }
  // GPS must remain optional: approximate location and manual pins still work.
  if (!/<uses-feature\s+android:name=["']android\.hardware\.location\.gps["']/i.test(result))
    result=result.replace(/(<application\b)/i,'    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n    $1');
  return result;
}

export function withIosLocationPurpose(plist) {
  if(!/<plist\b[^>]*>/i.test(plist) || !/<dict>/i.test(plist) || !/<\/plist>/i.test(plist))
    throw new Error('Unexpected Info.plist; refusing to modify');
  const keys=['NSLocationWhenInUseUsageDescription'];
  let result=plist;
  for(const key of keys){
    if(new RegExp('<key>\\s*'+key+'\\s*<\\/key>').test(result))continue;
    // The last </dict> is the top-level dictionary closing tag in generated Capacitor apps.
    const index=result.lastIndexOf('</dict>');
    if(index<0)throw new Error('Info.plist root dictionary not found');
    const insert='\t<key>'+key+'</key>\n\t<string>'+LOCATION_PURPOSE+'</string>\n';
    result=result.slice(0,index)+insert+result.slice(index);
  }
  return result;
}

export function nativePermissionPaths(projectRoot) {
  return {
    android:path.join(projectRoot,'android','app','src','main','AndroidManifest.xml'),
    ios:path.join(projectRoot,'ios','App','App','Info.plist')
  };
}
export function applyCustomerLocationPermissions({cwd,projectRoot,platform,exists=fs.existsSync,read=fs.readFileSync,write=fs.writeFileSync}={}) {
  if(!projectRoot || path.resolve(cwd||'.')!==path.resolve(projectRoot))
    throw new Error('Only apps/customer-web may update its generated native permission files');
  if(!['android','ios'].includes(platform))
    throw new Error('Specify android or ios explicitly');
  const target=nativePermissionPaths(projectRoot)[platform];
  if(!exists(target))throw new Error(platform+' native project does not exist; run the customer-only cap add command first');
  const original=read(target,'utf8');
  const updated=platform==='android'?withAndroidLocationPermissions(original):withIosLocationPurpose(original);
  if(updated!==original)write(target,updated,'utf8');
  return {changed:updated!==original,platform};
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../apps/customer-web');
  try{
    const status=applyCustomerLocationPermissions({cwd:process.cwd(),projectRoot,platform:process.argv[2]});
    console.log('Customer '+status.platform+' location permissions '+(status.changed?'configured':'already present'));
  }catch(error){
    console.error('BLOCKED:',error.message);
    process.exitCode=1;
  }
}
