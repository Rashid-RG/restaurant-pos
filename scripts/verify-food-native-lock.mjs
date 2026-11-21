// Reproducible, read-only consistency check for customer native dependency lock.
// Usage: node scripts/verify-food-native-lock.mjs <package.json> <package-lock.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE_VERSION='8.6.2';
const NATIVE_NAMES=['@capacitor/core','@capacitor/android','@capacitor/ios','@capacitor/cli'];
export function customerNativeLockErrors(manifest,lock) {
  const failures=[];
  if (!manifest || !lock || !lock.packages || lock.lockfileVersion!==3)
    return ['Customer lockfile is missing or not lockfile v3'];
  const root=lock.packages[''];
  if(!root || root.name!==manifest.name || lock.name!==manifest.name)
    failures.push('Lockfile belongs to a different application');
  for(const name of NATIVE_NAMES) {
    const manifestVersion=manifest.dependencies?.[name] || manifest.devDependencies?.[name];
    if(manifestVersion!==NATIVE_VERSION)
      failures.push(name+' must be explicitly pinned at '+NATIVE_VERSION+' in customer manifest');
    if(root?.dependencies?.[name]!==manifest.dependencies?.[name] ||
       root?.devDependencies?.[name]!==manifest.devDependencies?.[name])
      failures.push('Lock root manifest differs from customer package for '+name);
    if(lock.packages['node_modules/'+name]?.version!==NATIVE_VERSION)
      failures.push('Native dependency missing or incorrectly resolved in customer lock: '+name);
  }
  return failures;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try {
    const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const lock=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
    const errors=customerNativeLockErrors(manifest,lock);
    for(const e of errors)console.error('ERROR:',e);
    if(errors.length)process.exitCode=1;
    else console.log('GastroFlow Food customer native lockfile matches pinned Capacitor 8.6.2 packages.');
  }catch(error){
    console.error('ERROR: Could not read native customer dependency lock:',error.message);
    process.exitCode=1;
  }
}
