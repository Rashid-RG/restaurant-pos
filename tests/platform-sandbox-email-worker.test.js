import {describe,it,expect,vi} from 'vitest';
import {sandboxWorkerConfig,runSandboxEmailWorkerTick} from '../lib/communications/platform-sandbox-email-worker.js';

const env={
  PLATFORM_COMMUNICATIONS_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_STAGE:'staging',
  PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
  PLATFORM_COMMUNICATIONS_TEST_EMAILS:'tester@example.test',
  PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT:'brevo_sandbox',
  PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_EMAIL_STOP:'false',
  PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK:'I_APPROVE_STAGING_SANDBOX_WORKER',
  PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'1',
  BREVO_API_KEY:'fake-test-api-key',
  BREVO_FROM_EMAIL:'sender@example.test'
};
const job={
  announcementId:'notice_a',tenantId:'tenant_a',userId:'owner_a',
  email:'tester@example.test',status:'pending',attemptCount:0,nextAttemptAt:90
};
const owner={
  title:'Important platform update',body:'This is a sandbox test notice',
  status:'published',tenantStatus:'active',role:'owner',isPlatformAdmin:0,
  email:'tester@example.test',expiresAt:null
};
const deps=()=>({
  dbAll:vi.fn(async()=>[job]),
  dbGet:vi.fn(async(sql)=>sql.includes('SELECT 1 AS suppressed')?null:owner),
  dbRun:vi.fn(async()=>({changes:1})),
  fetcher:vi.fn(async()=>({ok:true,json:async()=>({messageId:'test-message-id-1'})}))
});
const options=(other={})=>({...deps(),env,announcementId:'notice_a',now:100,...other});

describe('Dormant quota-limited Brevo sandbox worker',()=>{
  it('never starts unless all independent staging guards are enabled',()=>{
    expect(sandboxWorkerConfig({}).enabled).toBe(false);
    expect(sandboxWorkerConfig(env)).toMatchObject({
      enabled:true,dailyCap:1,maxPerTick:1,schedulerConnected:false
    });
    for(const change of [
      {PLATFORM_COMMUNICATIONS_STAGE:'production'},
      {PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'},
      {PLATFORM_COMMUNICATIONS_EMAIL_STOP:'true'},
      {PLATFORM_COMMUNICATIONS_EMAIL_STOP:undefined},
      {PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED:'false'},
      {PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK:''},
      {PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'6'},
      {PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'0'},
      {PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'1.5'}
    ])expect(sandboxWorkerConfig({...env,...change}).enabled).toBe(false);
  });
  it('does no reads or sends when emergency stop is armed',async()=>{
    const input=options({env:{...env,PLATFORM_COMMUNICATIONS_EMAIL_STOP:'true'}});
    expect(await runSandboxEmailWorkerTick(input)).toMatchObject({started:false,reason:'WORKER_DISABLED'});
    expect(input.dbAll).not.toHaveBeenCalled();
    expect(input.dbRun).not.toHaveBeenCalled();
    expect(input.fetcher).not.toHaveBeenCalled();
  });
  it('rejects ambiguous or multiple recipient preview before reserving quota',async()=>{
    const input=options();
    input.dbAll.mockResolvedValue([job,{...job,userId:'owner_b'}]);
    expect(await runSandboxEmailWorkerTick(input)).toMatchObject({
      started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'
    });
    expect(input.dbRun).not.toHaveBeenCalled();
    expect(input.fetcher).not.toHaveBeenCalled();
  });
  it('respects the durable daily quota and never contacts Brevo when exhausted',async()=>{
    const input=options();
    input.dbRun.mockImplementation(async(sql)=>({changes:sql.includes('SET reservedCount=reservedCount+1')?0:1}));
    expect(await runSandboxEmailWorkerTick(input)).toMatchObject({
      started:false,reason:'DAILY_QUOTA_EXHAUSTED'
    });
    expect(input.fetcher).not.toHaveBeenCalled();
    const conditional=input.dbRun.mock.calls.find(([sql])=>sql.includes('SET reservedCount=reservedCount+1'));
    expect(conditional[0]).toContain('reservedCount<?');
    expect(conditional[1]).toEqual([100,'1970-01-01',1]);
  });
  it('reserves one UTC quota unit before an injected mocked provider request',async()=>{
    const input=options();
    const result=await runSandboxEmailWorkerTick(input);
    expect(result).toEqual({started:true,attempted:1,mailboxDelivered:false});
    expect(input.fetcher).toHaveBeenCalledTimes(1);
    expect(input.dbRun.mock.calls.findIndex(([sql])=>sql.includes('sandbox_quota')))
      .toBeLessThan(input.dbRun.mock.calls.findIndex(([sql])=>sql.includes("SET status='sending'")));
    expect(input.dbAll.mock.calls[1][1]).toEqual([100,'notice_a']);
  });
  it('blocks suppressed recipients without quota or provider calls',async()=>{
    const input=options();
    input.dbGet.mockImplementation(async(sql)=>sql.includes('SELECT 1 AS suppressed')?{suppressed:1}:owner);
    expect(await runSandboxEmailWorkerTick(input)).toMatchObject({
      started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'
    });
    expect(input.dbRun).not.toHaveBeenCalled();
    expect(input.fetcher).not.toHaveBeenCalled();
  });
});
