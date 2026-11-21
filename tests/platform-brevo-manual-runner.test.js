import {describe,it,expect,vi} from 'vitest';
import {runOneApprovedSandboxBrevoEmail,SANDBOX_SEND_CONFIRMATION} from '../lib/communications/platform-brevo-manual-runner.js';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'test@example.test',
 PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT:'brevo_sandbox',
 PLATFORM_COMMUNICATIONS_MANUAL_SEND_ENABLED:'true',
 BREVO_API_KEY:'fake-key',BREVO_FROM_EMAIL:'sender@example.test'
};
const job={announcementId:'notice_a',tenantId:'tenant_a',userId:'owner_a',
 email:'test@example.test',status:'pending',attemptCount:0,nextAttemptAt:50};
const owner={status:'published',tenantStatus:'active',role:'owner',isPlatformAdmin:0,
 email:'test@example.test',expiresAt:null,title:'Important notice',body:'A test notice'};
const storage=()=>({
 dbAll:vi.fn(async()=>[job]),dbGet:vi.fn(async()=>owner),
 dbRun:vi.fn(async()=>({changes:1}))
});
describe('explicit one-recipient Brevo sandbox runner',()=>{
 it('does nothing unless provider and separate manual authorization gates are all enabled',async()=>{
   const deps=storage(),fetcher=vi.fn();
   for(const e of [{}, {...env,PLATFORM_COMMUNICATIONS_MANUAL_SEND_ENABLED:'false'}, {...env,PLATFORM_COMMUNICATIONS_STAGE:'production'}]){
     expect(await runOneApprovedSandboxBrevoEmail({...deps,env:e,fetcher,confirmation:SANDBOX_SEND_CONFIRMATION,announcementId:'notice_a'}))
      .toMatchObject({started:false,reason:'NOT_AUTHORIZED'});
   }
   expect(deps.dbAll).not.toHaveBeenCalled();
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('requires an explicit confirmation per invocation',async()=>{
   const deps=storage(),fetcher=vi.fn();
   expect(await runOneApprovedSandboxBrevoEmail({...deps,env,fetcher,announcementId:'notice_a'}))
     .toMatchObject({started:false,reason:'NOT_AUTHORIZED'});
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('blocks when preview reports multiple eligible jobs',async()=>{
   const deps=storage();
   deps.dbAll.mockResolvedValue([job,{...job,tenantId:'tenant_b',userId:'owner_b'}]);
   const fetcher=vi.fn();
   expect(await runOneApprovedSandboxBrevoEmail({...deps,env,fetcher,announcementId:'notice_a',confirmation:SANDBOX_SEND_CONFIRMATION,now:100}))
     .toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(deps.dbRun).not.toHaveBeenCalled();
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('never sends if preview sees a different, non-allowlisted address',async()=>{
   const deps=storage();
   deps.dbAll.mockResolvedValue([{...job,email:'customer@another.example'}]);
   const fetcher=vi.fn();
   expect(await runOneApprovedSandboxBrevoEmail({...deps,env,fetcher,announcementId:'notice_a',confirmation:SANDBOX_SEND_CONFIRMATION,now:100}))
     .toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('runs one injected fake provider acceptance for a matching announced recipient',async()=>{
   const deps=storage(),fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'fake-accepted'})}));
   const result=await runOneApprovedSandboxBrevoEmail({
     ...deps,env,fetcher,announcementId:'notice_a',
     confirmation:SANDBOX_SEND_CONFIRMATION,now:100
   });
   expect(result).toEqual({started:true,attempted:1,mailboxDelivered:false});
   expect(fetcher).toHaveBeenCalledTimes(1);
   expect(deps.dbAll).toHaveBeenCalledTimes(2);
   expect(deps.dbAll.mock.calls[1][1]).toEqual([100,'notice_a']);
   expect(deps.dbRun.mock.calls.some(([sql])=>sql.includes("status='accepted'"))).toBe(true);
 });
});
