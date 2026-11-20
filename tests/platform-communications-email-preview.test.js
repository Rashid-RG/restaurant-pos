import {describe,it,expect,vi} from 'vitest';
import {previewSandboxOwnerEmailDispatch} from '../lib/communications/platform-email-preview.js';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'safe@example.test'
};
const valid=(overrides={})=>({
 announcementId:'notice',tenantId:'tenant_a',userId:'owner_a',email:'safe@example.test',
 status:'pending',attemptCount:0,nextAttemptAt:100,...overrides
});
const identity=(overrides={})=>({
 status:'published',expiresAt:null,tenantStatus:'active',role:'owner',
 email:'safe@example.test',isPlatformAdmin:0,...overrides
});
describe('Platform sandbox email dispatch preview',()=>{
 it('does not query storage when sandbox is disabled',async()=>{
  const dbAll=vi.fn(),dbGet=vi.fn();
  const outcome=await previewSandboxOwnerEmailDispatch({dbAll,dbGet,announcementId:'notice',env:{}});
  expect(outcome.enabled).toBe(false);
  expect(dbAll).not.toHaveBeenCalled();expect(dbGet).not.toHaveBeenCalled();
 });
 it('checks current ownership and allowlist without sending or writing',async()=>{
  const dbAll=vi.fn(async()=>[
    valid(),valid({tenantId:'tenant_b',userId:'owner_b',email:'real@example.com'}),
    valid({tenantId:'tenant_c',userId:'owner_c',status:'manual_review'})
  ]);
  const dbGet=vi.fn(async()=>identity()),dbRun=vi.fn(),send=vi.fn();
  const outcome=await previewSandboxOwnerEmailDispatch({
    dbAll,dbGet,dbRun,send,announcementId:'notice',env,now:200
  });
  expect(outcome).toMatchObject({enabled:true,eligible:1,blocked:2,pending:2,truncated:false});
  expect(outcome.reasons).toContainEqual({code:'outside_allowlist',count:1});
  expect(outcome.reasons).toContainEqual({code:'not_pending',count:1});
  expect(JSON.stringify(outcome)).not.toContain('safe@example.test');
  expect(dbRun).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  expect(dbGet).toHaveBeenCalledTimes(1);
 });
 it('rejects suspended owners or changed recipient emails',async()=>{
  const dbAll=vi.fn(async()=>[valid()]);
  let dbGet=vi.fn(async()=>identity({tenantStatus:'suspended'}));
  let result=await previewSandboxOwnerEmailDispatch({dbAll,dbGet,announcementId:'notice',env,now:200});
  expect(result.reasons).toContainEqual({code:'owner_ineligible',count:1});
  dbGet=vi.fn(async()=>identity({email:'changed@example.com'}));
  result=await previewSandboxOwnerEmailDispatch({dbAll,dbGet,announcementId:'notice',env,now:200});
  expect(result.reasons).toContainEqual({code:'email_changed',count:1});
 });
 it('bounds output size and signals pagination',async()=>{
  const dbAll=vi.fn(async()=>[valid({status:'manual_review'}),valid({status:'manual_review'})]);
  const result=await previewSandboxOwnerEmailDispatch({
    dbAll,dbGet:vi.fn(),announcementId:'notice',env,limit:1
  });
  expect(result).toMatchObject({truncated:true,blocked:1});
  expect(dbAll.mock.calls[0][0]).toContain('LIMIT 2');
 });
});
