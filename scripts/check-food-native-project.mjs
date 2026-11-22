// Fail closed before invoking Capacitor CLI: the POS lives at repository root.
// Run only from apps/customer-web. Never create or sync a native POS project.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function foodNativeProjectErrors({cwd,expectedRoot,exists=fs.existsSync,read=fs.readFileSync}={}) {
  const errors=[];
  if(path.resolve(cwd||'.')!==path.resolve(expectedRoot||'.')){
    return ['Capacitor command must run inside apps/customer-web; root POS project is protected.'];
  }
  let pkg,lock,config;
  try {pkg=JSON.parse(read(path.join(expectedRoot,'package.json'),'utf8'));}catch{errors.push('Customer package.json is unreadable.');}
  try {config=JSON.parse(read(path.join(expectedRoot,'capacitor.config.json'),'utf8'));}catch{errors.push('Customer Capacitor config is unreadable.');}
  const lockFile=path.join(expectedRoot,'package-lock.json');
  if(!exists(lockFile)) errors.push('Customer package-lock.json missing: run npm install in apps/customer-web, review, and commit lockfile.');
  else {try{lock=JSON.parse(read(lockFile,'utf8'));}catch{errors.push('Customer package-lock.json is invalid.');}}
  for(const name of ['@capacitor/core','@capacitor/android','@capacitor/ios','@capacitor/cli']){
    const selected=pkg?.dependencies?.[name]||pkg?.devDependencies?.[name];
    if(selected!=='8.6.2') errors.push(name+' must be pinned to 8.6.2');
    const locked=lock?.packages?.['node_modules/'+name]?.version;
    if(lock && locked!=='8.6.2') errors.push(name+' lockfile entry must be 8.6.2');
  }
  if(config?.appId!=='com.rstechnologies.gastrofood'||config?.webDir!=='dist') errors.push('Unexpected customer app identity or webDir.');
  if(!exists(path.join(expectedRoot,'dist','index.html')))
    errors.push('Packaged customer web build missing: run npm run native:build:web first.');
  return errors;
}

const invoked=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const expectedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../apps/customer-web');
  const errors=foodNativeProjectErrors({cwd:process.cwd(),expectedRoot});
  for(const message of errors)console.error('BLOCKED:',message);
  if(errors.length)process.exitCode=1;
  else console.log('Native shell preflight passed for isolated GastroFlow Food project.');
}
