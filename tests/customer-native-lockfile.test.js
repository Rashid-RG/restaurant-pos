import { describe, expect, it } from 'vitest';
import { customerNativeLockErrors } from '../scripts/verify-food-native-lock.mjs';

const names=['@capacitor/core','@capacitor/android','@capacitor/ios','@capacitor/cli'];
const manifest={
  name:'gastroflow-customer-web',
  dependencies:{'@capacitor/core':'8.6.2','@capacitor/android':'8.6.2','@capacitor/ios':'8.6.2'},
  devDependencies:{'@capacitor/cli':'8.6.2'}
};
const good=()=>({name:'gastroflow-customer-web',lockfileVersion:3,packages:{
  '':{name:'gastroflow-customer-web',dependencies:{...manifest.dependencies},devDependencies:{...manifest.devDependencies}},
  ...Object.fromEntries(names.map(x=>['node_modules/'+x,{version:'8.6.2'}]))
}});
describe('GastroFlow Food customer-only native lockfile verification',()=>{
  it('accepts a complete exact native dependency lock',()=>{
    expect(customerNativeLockErrors(manifest,good())).toEqual([]);
  });
  it('rejects an old lock with no Capacitor packages',()=>{
    const old=good();for(const n of names)delete old.packages['node_modules/'+n];
    expect(customerNativeLockErrors(manifest,old)).toHaveLength(4);
  });
  it('rejects accidental root POS lockfile or manifest drift',()=>{
    const old=good();old.name='restaurant-pos';
    expect(customerNativeLockErrors(manifest,old)).toEqual(expect.arrayContaining([expect.stringMatching(/different application/)]));
    const skew=good();skew.packages['node_modules/@capacitor/android'].version='8.6.1';
    expect(customerNativeLockErrors(manifest,skew)).toEqual(expect.arrayContaining([expect.stringMatching(/@capacitor\/android/)]));
  });
  it('rejects floating version constraints',()=>{
    const altered={...manifest,dependencies:{...manifest.dependencies,'@capacitor/core':'^8.6.2'}};
    expect(customerNativeLockErrors(altered,good())).not.toEqual([]);
  });
});
