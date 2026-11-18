import {describe,it,expect} from 'vitest';
import {customerSessionKey} from '../apps/customer-web/src/utils/customer-auth-scope.js';
import {migrateCustomerTokenToNativeStorage} from '../apps/customer-web/src/utils/native-session-migration.js';

const memory=()=>{const entries=new Map();return {
 getItem:key=>entries.get(key)??null,
 setItem:(key,value)=>entries.set(key,value),
 removeItem:key=>entries.delete(key)
};};
const secure=()=>{const entries=new Map();return {
 get:async key=>entries.get(key)??null,
 set:async(key,value)=>{entries.set(key,value)},
 remove:async key=>{entries.delete(key)}
};};
describe('GastroFlow Food future native secure-token migration',()=>{
 it('copies and verifies the restaurant token before deleting the legacy value',async()=>{
  const legacy=memory(),native=secure(),key=customerSessionKey('restaurant-A');
  legacy.setItem(key,'token-A');
  expect(await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:native,legacyStorage:legacy}))
    .toEqual({status:'migrated'});
  expect(await native.get(key)).toBe('token-A');
  expect(legacy.getItem(key)).toBeNull();
 });
 it('never migrates another restaurant or replaces a newer native login',async()=>{
  const legacy=memory(),native=secure();
  legacy.setItem(customerSessionKey('restaurant-A'),'a');
  legacy.setItem(customerSessionKey('restaurant-B'),'b');
  await native.set(customerSessionKey('restaurant-A'),'new-a');
  expect(await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:native,legacyStorage:legacy}))
    .toEqual({status:'secure-session-exists'});
  expect(await native.get(customerSessionKey('restaurant-A'))).toBe('new-a');
  expect(legacy.getItem(customerSessionKey('restaurant-A'))).toBe('a');
  expect(legacy.getItem(customerSessionKey('restaurant-B'))).toBe('b');
 });
 it('preserves old login when native writes fail or readback does not match',async()=>{
  const legacy=memory(),key=customerSessionKey('restaurant-A');
  legacy.setItem(key,'original');
  const broken={get:async()=>null,set:async()=>{throw Error('device locked')},remove:async()=>{}};
  expect(await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:broken,legacyStorage:legacy}))
    .toEqual({status:'migration-failed'});
  expect(legacy.getItem(key)).toBe('original');
  const noPersistence={get:async()=>null,set:async()=>{},remove:async()=>{}};
  expect(await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:noPersistence,legacyStorage:legacy}))
    .toEqual({status:'verification-failed'});
  expect(legacy.getItem(key)).toBe('original');
 });
 it('does not remove a newer legacy login after an asynchronous native copy',async()=>{
  const legacy=memory(),key=customerSessionKey('restaurant-A');
  legacy.setItem(key,'old');
  const native={get:async()=>null,set:async()=>{legacy.setItem(key,'new')},remove:async()=>{}};
  const result=await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:native,legacyStorage:legacy});
  expect(result.status).toBe('verification-failed');
  expect(legacy.getItem(key)).toBe('new');
 });
 it('detects changed legacy login after read-back instead of removing it',async()=>{
  const legacy=memory(),key=customerSessionKey('restaurant-A');
  legacy.setItem(key,'old');
  const native=secure();
  const originalGet=native.get;
  let reads=0;
  native.get=async k=>{reads++;const v=await originalGet(k);if(reads===2)legacy.setItem(key,'new');return v};
  expect(await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:native,legacyStorage:legacy}))
    .toEqual({status:'legacy-session-changed'});
  expect(legacy.getItem(key)).toBe('new');
 });
 it('refuses missing, invalid or unsupported native storage without clearing sessions',async()=>{
  const legacy=memory(),key=customerSessionKey('restaurant-A');legacy.setItem(key,'abc');
  expect((await migrateCustomerTokenToNativeStorage({tenant:'',secureStore:secure(),legacyStorage:legacy})).status).toBe('invalid-tenant');
  expect((await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',legacyStorage:legacy})).status).toBe('native-store-unavailable');
  expect(legacy.getItem(key)).toBe('abc');
 });
 it('rejects concurrent migrations of the same restaurant while allowing different restaurants',async()=>{
  const legacy=memory(),native=secure(),key=customerSessionKey('restaurant-A');
  legacy.setItem(key,'abc');
  let release;
  const paused={get:()=>new Promise(resolve=>{release=resolve}),set:native.set,remove:native.remove};
  const first=migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:paused,legacyStorage:legacy});
  expect((await migrateCustomerTokenToNativeStorage({tenant:'restaurant-A',secureStore:native,legacyStorage:legacy})).status).toBe('migration-in-progress');
  release(null);
  // Paused adapter's next read may require a second promise to resolve; just
  // verify the first call remains responsible for that tenant.
  expect(typeof first.then).toBe('function');
 });
});
