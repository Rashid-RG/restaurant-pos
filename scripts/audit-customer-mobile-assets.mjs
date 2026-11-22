// Read-only preflight for GastroFood/GastroDriver install identity and PNG assets.
// Usage: node scripts/audit-customer-mobile-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const base=path.resolve('apps/customer-web/public');
const entries=[
  {name:'customer',manifest:'manifest.json',expectedPrefix:'food-'},
  {name:'driver',manifest:'driver-manifest.json',expectedPrefix:'driver-'},
];
const warnings=[],errors=[];
function pngSize(filename){
  const h=Buffer.alloc(24);
  const fd=fs.openSync(filename,'r');
  try{
    if(fs.readSync(fd,h,0,24,0)!==24 || h.toString('hex',0,8)!=='89504e470d0a1a0a')
      throw new Error('invalid PNG header');
    return {width:h.readUInt32BE(16),height:h.readUInt32BE(20)};
  }finally{fs.closeSync(fd);}
}
for(const spec of entries){
  const file=path.join(base,spec.manifest);
  if(!fs.existsSync(file)){errors.push(`${spec.name}: missing manifest`);continue;}
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(file,'utf8'));}catch{errors.push(`${spec.name}: invalid manifest JSON`);continue;}
  if(manifest.display!=='standalone')warnings.push(`${spec.name}: display should be standalone`);
  if(!String(manifest.start_url||'').startsWith('/customer/'))warnings.push(`${spec.name}: unexpected start_url`);
  for(const icon of manifest.icons||[]){
    const clean=String(icon.src||'').split(/[?#]/,1)[0];
    if(!clean.startsWith(spec.expectedPrefix))errors.push(`${spec.name}: icon not branded for this app: ${clean}`);
    if(!clean || clean.includes('/') || clean.includes('..')){errors.push(`${spec.name}: invalid icon path`);continue;}
    const target=path.join(base,clean);
    if(!fs.existsSync(target)){errors.push(`${spec.name}: missing ${clean}`);continue;}
    if(icon.type==='image/png'){
      try{
        const size=pngSize(target);
        const expected=String(icon.sizes||'').match(/^(\d+)x(\d+)$/);
        if(expected && (size.width!==Number(expected[1])||size.height!==Number(expected[2])))
          errors.push(`${spec.name}: ${clean} declared ${icon.sizes}, actual ${size.width}x${size.height}`);
      }catch(e){errors.push(`${spec.name}: ${clean} ${e.message}`);}
    }
  }
  if(!(manifest.icons||[]).length)errors.push(`${spec.name}: no installation icons`);
}
const rootConfig=path.resolve('capacitor.config.json');
if(fs.existsSync(rootConfig)){
  try{
    const config=JSON.parse(fs.readFileSync(rootConfig,'utf8'));
    if(/POS|Suite/i.test(config.appName||''))
      warnings.push('Root Capacitor config belongs to the POS/suite: create isolated customer and driver configs before native release');
    if(config.server?.cleartext===true)
      warnings.push('Root Capacitor config allows Android cleartext: do not copy it into published mobile applications');
  }catch{warnings.push('Root Capacitor config could not be parsed');}
}
for(const issue of warnings)console.warn('WARN:',issue);
for(const issue of errors)console.error('ERROR:',issue);
console.log(`Mobile identity audit: ${errors.length} errors, ${warnings.length} warnings`);
if(errors.length)process.exitCode=1;
