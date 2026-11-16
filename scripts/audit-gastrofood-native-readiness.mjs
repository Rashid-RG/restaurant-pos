// Read-only verification of the *customer* Capacitor preparation.
// It deliberately does not claim an Android/iOS build is runnable.
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const errors=[],blockers=[];
const foodPath='apps/customer-web/capacitor.config.json';
const rootPath='capacitor.config.json';
const re=/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/i;
try {
  const food=readJson(foodPath);
  const suite=readJson(rootPath);
  if(!re.test(food.appId||'')) errors.push('Food appId is not a reverse-domain identifier');
  if(!food.appName || /pos|suite/i.test(food.appName)) errors.push('Food appName must be separate from POS');
  if(food.appId===suite.appId) errors.push('Food appId collides with existing POS appId');
  if(food.webDir!=='dist') errors.push('Food webDir must be the customer output directory');
  if(food.server?.cleartext===true) errors.push('Food Android cleartext is enabled');
  if(food.server?.url) errors.push('Food native shell must not depend on a remote WebView URL');
} catch(e) {errors.push('Unable to load isolated customer Capacitor config: '+e.message);}
const pkg=readJson('package.json');
if(!pkg.dependencies?.['@capacitor/core']) blockers.push('Capacitor core/native CLI and platforms are not yet installed or locked');
const api=fs.readFileSync(path.join(root,'apps/customer-web/src/utils/api.js'),'utf8');
if(!api.includes('VITE_') && api.includes('location.origin'))
  blockers.push('Native origin routing is not supported yet: same-origin /api calls cannot reach Render from capacitor://localhost');
const vite=fs.readFileSync(path.join(root,'apps/customer-web/vite.config.js'),'utf8');
if(vite.includes("base: '/customer/'"))
  blockers.push('Customer Vite base is /customer/: produce and test a separate relative-asset native build');
for(const m of ['android','ios']){
  if(!fs.existsSync(path.join(root,'apps/customer-web',m))) blockers.push('Customer '+m+' native project has not been generated or tested');
}
for(const e of errors) console.error('ERROR:',e);
for(const b of blockers) console.warn('PENDING:',b);
console.log(`GastroFood native config preflight: ${errors.length} config errors, ${blockers.length} release blockers`);
if(errors.length) process.exitCode=1;
