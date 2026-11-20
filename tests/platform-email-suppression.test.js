import {describe,it,expect,vi} from 'vitest';
import {ownerEmailIsSuppressed} from '../lib/communications/platform-email-suppression.js';

describe('verified sandbox provider suppression',()=>{
 it('fails closed on an invalid or missing recipient',async()=>{
  const dbGet=vi.fn();
  expect(await ownerEmailIsSuppressed({dbGet,tenantId:'tenant_a',userId:'owner_a',email:'invalid'})).toBe(true);
  expect(await ownerEmailIsSuppressed({dbGet,tenantId:'',userId:'owner_a',email:'test@example.test'})).toBe(true);
  expect(dbGet).not.toHaveBeenCalled();
 });
 it('matches only a provider-suppressed identity and normalized email',async()=>{
  const dbGet=vi.fn(async()=>({suppressed:1}));
  expect(await ownerEmailIsSuppressed({dbGet,tenantId:'tenant_a',userId:'owner_a',email:' TEST@EXAMPLE.TEST '})).toBe(true);
  const [sql,args]=dbGet.mock.calls[0];
  expect(sql).toContain("receipt.eventStatus IN ('hard_bounce','blocked','invalid','spam','unsubscribed')");
  expect(sql).toContain('receipt.provider');
  expect(sql).toContain('queued.tenant_id=? AND queued.userId=?');
  expect(args).toEqual(['tenant_a','owner_a','test@example.test']);
 });
 it('does not suppress a recipient without verified provider evidence',async()=>{
  const dbGet=vi.fn(async()=>null);
  expect(await ownerEmailIsSuppressed({dbGet,tenantId:'tenant_a',userId:'owner_a',email:'test@example.test'})).toBe(false);
 });
 it('does not confuse an unrelated owner record with suppression evidence',async()=>{
  const dbGet=vi.fn(async()=>({role:'owner',status:'active'}));
  expect(await ownerEmailIsSuppressed({dbGet,tenantId:'tenant_a',userId:'owner_a',email:'test@example.test'})).toBe(false);
 });
});
