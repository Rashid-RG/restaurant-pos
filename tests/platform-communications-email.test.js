import {describe,it,expect,vi} from 'vitest';
import {
 normalizeSandboxAddress,sandboxEmailConfig,sandboxEmailAllowed,
 emailRetryDelayMs,canRetryEmail,enqueueSandboxOwnerEmails,processSandboxOwnerEmailQueue
} from '../lib/communications/platform-email-queue.js';
const active={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'tester@example.test'
};
describe('Sandbox-only platform communication email queue',()=>{
 it('rejects invalid or non-allowlisted destinations',()=>{
   expect(normalizeSandboxAddress(' TESTER@EXAMPLE.TEST ')).toBe('tester@example.test');
   expect(normalizeSandboxAddress('no-email')).toBe(null);
   expect(sandboxEmailAllowed('tester@example.test',active)).toBe(true);
   expect(sandboxEmailAllowed('actual.customer@example.com',active)).toBe(false);
 });
 it('requires both stage gates and an explicit allowlist',()=>{
   expect(sandboxEmailConfig({...active,PLATFORM_COMMUNICATIONS_STAGE:'production'}).enabled).toBe(false);
   expect(sandboxEmailConfig({...active,PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'false'}).enabled).toBe(false);
   expect(sandboxEmailConfig({...active,PLATFORM_COMMUNICATIONS_TEST_EMAILS:''}).enabled).toBe(false);
 });
 it('caps retry attempts',()=>{
   expect(canRetryEmail('retry',4)).toBe(true);
   expect(canRetryEmail('retry',5)).toBe(false);
   expect(canRetryEmail('manual_review',1)).toBe(false);
   expect(emailRetryDelayMs(3)).toBe(240000);
 });
 it('does not access the database when email is disabled',async()=>{
   const dbAll=vi.fn(),dbRun=vi.fn();
   const r=await enqueueSandboxOwnerEmails({dbAll,dbRun,announcementId:'notice',env:{}});
   expect(r.disabled).toBe(true);
   expect(dbAll).not.toHaveBeenCalled();
   expect(dbRun).not.toHaveBeenCalled();
 });
 it('only queues exact allowlisted active-owner recipients',async()=>{
   const dbAll=vi.fn(async()=>[
      {tenantId:'tenant_a',userId:'u_a',email:'tester@example.test',status:'published',tenantStatus:'active',expiresAt:null},
      {tenantId:'tenant_b',userId:'u_b',email:'customer@example.com',status:'published',tenantStatus:'active',expiresAt:null},
      {tenantId:'tenant_c',userId:'u_c',email:'tester@example.test',status:'published',tenantStatus:'suspended',expiresAt:null}
   ]);
   const dbRun=vi.fn(async()=>({changes:1}));
   const result=await enqueueSandboxOwnerEmails({dbAll,dbRun,announcementId:'a1',env:active,now:100});
   expect(result).toEqual({queued:1,blocked:2,disabled:false});
   expect(dbRun).toHaveBeenCalledTimes(1);
   expect(dbRun.mock.calls[0][1].slice(0,4)).toEqual(['a1','tenant_a','u_a','tester@example.test']);
 });
 it('cannot process email without an injected sandbox transport',async()=>{
   const dbAll=vi.fn();
   await expect(processSandboxOwnerEmailQueue({dbAll,dbGet:vi.fn(),dbRun:vi.fn(),env:active}))
     .rejects.toThrow('staging sandbox email transport');
   expect(dbAll).not.toHaveBeenCalled();
 });
 it('never sends when tenant membership has changed',async()=>{
   const dbAll=vi.fn(async()=>[{announcementId:'a1',tenantId:'tenant_a',userId:'u_a',email:'tester@example.test',status:'pending',attemptCount:0}]);
   const dbGet=vi.fn(async()=>({title:'Hello',body:'Notice',status:'published',tenantStatus:'active',role:'manager',email:'tester@example.test',isPlatformAdmin:0}));
   const dbRun=vi.fn(),send=vi.fn();
   expect(await processSandboxOwnerEmailQueue({dbAll,dbGet,dbRun,send,env:active})).toEqual({processed:0,disabled:false});
   expect(send).not.toHaveBeenCalled();
   expect(dbRun).not.toHaveBeenCalled();
 });
 it('marks ambiguous transport failures for manual review',async()=>{
   const dbAll=vi.fn(async()=>[{announcementId:'a1',tenantId:'tenant_a',userId:'u_a',email:'tester@example.test',status:'pending',attemptCount:0}]);
   const dbGet=vi.fn(async()=>({title:'Hello',body:'Notice',status:'published',tenantStatus:'active',role:'owner',email:'tester@example.test',isPlatformAdmin:0}));
   const dbRun=vi.fn(async()=>({changes:1})),send=vi.fn(async()=>{throw new Error('timeout')});
   const result=await processSandboxOwnerEmailQueue({dbAll,dbGet,dbRun,send,env:active});
   expect(result.processed).toBe(1);
   expect(send).toHaveBeenCalledTimes(1);
   expect(dbRun.mock.calls.some(([sql])=>sql.includes("status='manual_review'"))).toBe(true);
 });
});
