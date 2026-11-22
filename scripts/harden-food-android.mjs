// Apply minimal privacy protections only to the generated customer Android manifest.
// Never edit the POS Android project or modify application permissions globally.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function secureCustomerAndroidManifest(xml) {
  if (typeof xml !== 'string' || !/<manifest\b/i.test(xml) ||
      !/<application\b[^>]*>/i.test(xml)) {
    throw new Error('Unknown Android manifest format: refusing to edit');
  }
  // Customer tokens, tracking credentials and cart information must not be
  // restored from automatic Android backups on another device.
  return xml.replace(/<application\b([^>]*?)>/i, (full, attributes) => {
    const withoutBackup = attributes.replace(/\sandroid:allowBackup\s*=\s*["'][^"']*["']/gi,'');
    return '<application'+withoutBackup+' android:allowBackup="false">';
  });
}
export function hardenCustomerAndroid({cwd,customerRoot,exists=fs.existsSync,read=fs.readFileSync,write=fs.writeFileSync}={}) {
  if(!customerRoot||path.resolve(cwd||'.')!==path.resolve(customerRoot))
    throw new Error('Only apps/customer-web may apply Android hardening');
  const file=path.join(customerRoot,'android','app','src','main','AndroidManifest.xml');
  if(!exists(file))throw new Error('Customer native Android manifest is missing');
  const original=read(file,'utf8');
  const updated=secureCustomerAndroidManifest(original);
  if(updated!==original)write(file,updated,'utf8');
  return {changed:original!==updated};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../apps/customer-web');
  try{
    const result=hardenCustomerAndroid({cwd:process.cwd(),customerRoot:root});
    console.log('GastroFlow Food Android data-backup protection '+(result.changed?'applied':'already present'));
  }catch(error){
    console.error('BLOCKED:',error.message);
    process.exitCode=1;
  }
}
