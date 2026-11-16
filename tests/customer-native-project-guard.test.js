import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {foodNativeProjectErrors} from '../scripts/check-food-native-project.mjs';

const root=path.resolve('apps/customer-web');
const pkg={dependencies:{'@capacitor/core':'8.6.2','@capacitor/android':'8.6.2','@capacitor/ios':'8.6.2'},devDependencies:{'@capacitor/cli':'8.6.2'}};
const config={appId:'com.rstechnologies.gastrofood',webDir:'dist'};
const lock={packages:Object.fromEntries(['core','android','ios','cli'].map(part=>['node_modules/@capacitor/'+part,{version:'8.6.2'}]))};
function fixture({hasLock=true,hasDist=true,packageJson=pkg,lockJson=lock,capacitorConfig=config}={}){
 return {
   cwd:root,expectedRoot:root,
   exists:f=>hasLock||!f.endsWith('package-lock.json') ? (hasDist||!f.endsWith(path.join('dist','index.html'))) : false,
   read:f=>JSON.stringify(f.endsWith('package-lock.json')?lockJson:f.endsWith('capacitor.config.json')?capacitorConfig:packageJson)
 };
}
describe('GastroFlow Food isolated Capacitor project guard',()=>{
 it('blocks any command from repository root, protecting the POS',()=>{
   expect(foodNativeProjectErrors({...fixture(),cwd:process.cwd()})).toEqual([expect.stringMatching(/root POS project is protected/)]);
 });
 it('requires a committed native lockfile and generated customer web assets',()=>{
   expect(foodNativeProjectErrors(fixture({hasLock:false,hasDist:false}))).toEqual(expect.arrayContaining([
     expect.stringMatching(/package-lock.json missing/),
     expect.stringMatching(/web build missing/)
   ]));
 });
 it('rejects version skew and unexpected POS-like native identity',()=>{
   const altered={...pkg,dependencies:{...pkg.dependencies,'@capacitor/core':'^8.6.2'}};
   const errors=foodNativeProjectErrors(fixture({packageJson:altered,capacitorConfig:{appId:'com.gastroflow.app',webDir:'dist'}}));
   expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/must be pinned/),expect.stringMatching(/Unexpected customer app identity/)]));
 });
 it('accepts a locked isolated customer shell fixture',()=>{
   expect(foodNativeProjectErrors(fixture())).toEqual([]);
 });
});
