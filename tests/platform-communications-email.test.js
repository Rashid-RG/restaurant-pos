import {describe,it,expect,vi} from 'vitest';
import {
 normalizeSandboxAddress,sandboxEmailConfig,sandboxEmailAllowed,
 emailRetryDelayMs,canRetryEmail,enqueueSandboxOwnerEmails,processSandboxOwnerEmailQueue,reconcileStaleSandboxEmailClaims,closeSandboxEmailReview
} from '../lib/communications/platform-email-queue.js';
const active={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'tester@example.test'
};
describe('Sandbox-only platform communication email queue',()=>{
 it('stale in-flight emails require manual review; never resend',async()=>{
   const dbRun=vi.fn(async()=>({changes:2}));
   const send=vi.fn();
   const result=await reconcileStaleSandboxEmailClaims({dbRun,env:active,now:10000000});
   expect(result).toEqual({disabled:false,reviewRequired:2});
   const [sql,args]=dbRun.mock.calls[0];
   expect(sql).toContain("status='manual_review'");
   expect(sql).toContain("status='sending'");
   expect(args).toEqual([10000000,9100000]);
   expect(send).not.toHaveBeenCalled();
 });
 it('reconciliation is disabled outside staging sandbox',async()=>{
   const dbRun=vi.fn();
   expect(await reconcileStaleSandboxEmailClaims({dbRun,env:{}})).toEqual({disabled:true,reviewRequired:0});
   expect(dbRun).not.toHaveBeenCalled();
 });
 it('manual close updates only the selected tenant and job',async()=>{
   const dbRun=vi.fn(async()=>({changes:1}));
   expect(await closeSandboxEmailReview({dbRun,announcementId:'a1',tenantId:'tenant_a',userId:'owner_a',now:500})).toBe(true);
   expect(dbRun.mock.calls[0][1]).toEqual([500,'a1','tenant_a','owner_a']);
   expect(dbRun.mock.calls[0][0]).toContain("status='manual_review'");
 });
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
 it('records Brevo provider acceptance without claiming mailbox delivery',async()=>{
   const dbAll=vi.fn(async()=>[{announcementId:'n1',tenantId:'t1',userId:'u1',email:'tester@example.test',status:'pending',attemptCount:0}]);
   const dbGet=vi.fn(async()=>({title:'Hello',body:'Test message',status:'published',tenantStatus:'active',role:'owner',email:'tester@example.test',isPlatformAdmin:0}));
   const dbRun=vi.fn(async()=>({changes:1}));
   const send=vi.fn(async()=>({success:true,provider:'brevo',providerMessageId:'brevo-msg-1'}));
   const result=await processSandboxOwnerEmailQueue({dbAll,dbGet,dbRun,send,env:active});
   expect(result.processed).toBe(1);
   expect(dbRun.mock.calls.some(([sql,args])=>sql.includes('platform_owner_communication_email_receipts')&&args?.[0]==='brevo-msg-1')).toBe(true);
   const accepted=dbRun.mock.calls.find(([sql])=>sql.includes("SET status='accepted'"));
   expect(accepted[0]).toContain('deliveredAt=NULL');
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
