import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {customerSessionKey} from '../apps/customer-web/src/utils/customer-auth-scope.js';
import {readCustomerSessionToken,saveCustomerSessionToken,clearCustomerSessionToken,clearCustomerSessionTokenIfMatch} from '../apps/customer-web/src/utils/customer-session-store.js';

function memoryStore(){
 const map=new Map();
 return {
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>map.set(key,String(value)),
  removeItem:key=>map.delete(key)
 };
}
describe('GastroFlow Food customer session store compatibility',()=>{
 it('keeps existing tenant-scoped persisted keys and restores stored sessions',()=>{
   const storage=memoryStore();
   saveCustomerSessionToken('restaurant-A','token-A',storage);
   saveCustomerSessionToken('restaurant-B','token-B',storage);
   expect(storage.getItem(customerSessionKey('restaurant-A'))).toBe('token-A');
   expect(readCustomerSessionToken('restaurant-B',storage)).toBe('token-B');
   clearCustomerSessionToken('restaurant-A',storage);
   expect(readCustomerSessionToken('restaurant-A',storage)).toBeNull();
   expect(readCustomerSessionToken('restaurant-B',storage)).toBe('token-B');
 });
 it('does not allow a stale 401 to clear a newer login',()=>{
   const storage=memoryStore();
   saveCustomerSessionToken('restaurant-A','old',storage);
   saveCustomerSessionToken('restaurant-A','new',storage);
   expect(clearCustomerSessionTokenIfMatch('restaurant-A','old',storage)).toBe(false);
   expect(readCustomerSessionToken('restaurant-A',storage)).toBe('new');
   expect(clearCustomerSessionTokenIfMatch('restaurant-A','new',storage)).toBe(true);
   expect(readCustomerSessionToken('restaurant-A',storage)).toBeNull();
 });
 it('rejects empty tokens and treats unavailable storage as logged out',()=>{
   const storage=memoryStore();
   expect(()=>saveCustomerSessionToken('restaurant-A','',storage)).toThrow();
   expect(readCustomerSessionToken('restaurant-A',{getItem(){throw Error('storage unavailable')}})).toBeNull();
   expect(clearCustomerSessionTokenIfMatch('restaurant-A','',storage)).toBe(false);
 });
 it('centralizes both customer API and auth-provider persistence',()=>{
   const context=readFileSync('apps/customer-web/src/context/CustomerAuthContext.jsx','utf8');
   const api=readFileSync('apps/customer-web/src/utils/api.js','utf8');
   for(const src of [context,api])expect(src).toContain("from './customer-session-store.js'".replace('./customer-session-store.js',src===context?'../utils/customer-session-store.js':'./customer-session-store.js'));
   expect(context).toContain('saveCustomerSessionToken(sessionTenant, data.token)');
   expect(api).toContain('clearCustomerSessionTokenIfMatch(activeTenant,customerToken)');
 });
});
