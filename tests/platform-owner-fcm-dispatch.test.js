import {describe,it,expect,vi} from 'vitest';
import crypto from 'node:crypto';
import {dispatchOneStagingOwnerNotice} from '../lib/communications/platform-owner-fcm-dispatch.js';
import {encryptBoundFcmToken} from '../lib/communications/platform-fcm-token-registry.js';

const {privateKey}=crypto.generateKeyPairSync('rsa',{
  modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
});
const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'test-device-secret-key-is-at-least-32-characters',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:crypto.randomBytes(32).toString('base64'),
 PLATFORM_COMMUNICATIONS_FCM_PROJECT_ID:'gastroflow-staging',
 PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL:'sender@gastroflow-staging.iam.gserviceaccount.com',
 PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY:privateKey,
 PLATFORM_COMMUNICATIONS_FCM_SEND_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_STOP:'false',
 PLATFORM_COMMUNICATIONS_FCM_ACK:'I_APPROVE_STAGING_FCM_SANDBOX',
 PLATFORM_COMMUNICATIONS_FCM_DISPATCH_ENABLED:'true'
};
const deviceHash='a'.repeat(64),token='fake_FCM_token_for_android_012345678901234';
const options={announcementId:'notice_a',tenantId:'tenant_a',userId:'owner_a',deviceHash,now:1795200000000};
const fixture=(overrides={})=>{
 const record=encryptBoundFcmToken({...options,token,env});
 const dbGet=vi.fn(async sql=>sql.includes('SELECT a.title,a.body')
   ?{title:'Owner policy update',body:'Please review the new notice.'}:record);
 const dbRun=vi.fn(async()=>({changes:1}));
 const fetcher=vi.fn()
  .mockResolvedValueOnce({ok:true,json:async()=>({access_token:'fake-access-token-1234567890'})})
  .mockResolvedValueOnce({ok:true,json:async()=>({name:'projects/gastroflow-staging/messages/fake-1'})});
 return {dbGet,dbRun,fetcher,env,...options,...overrides};
};
describe('dormant tenant-specific owner FCM dispatcher',()=>{
 it('never queries DB or provider when disabled or missing tenant binding',async()=>{
  const input=fixture({env:{...env,PLATFORM_COMMUNICATIONS_FCM_DISPATCH_ENABLED:'false'}});
  expect(await dispatchOneStagingOwnerNotice(input)).toMatchObject({started:false,reason:'DISABLED'});
  expect(input.dbGet).not.toHaveBeenCalled();expect(input.fetcher).not.toHaveBeenCalled();
  const wrong=fixture({deviceHash:'invalid'});
  expect(await dispatchOneStagingOwnerNotice(wrong)).toMatchObject({started:false,reason:'INVALID_INPUT'});
  expect(wrong.dbGet).not.toHaveBeenCalled();
 });
 it('does not send when owner membership, consent or device enrollment cannot be confirmed',async()=>{
  const input=fixture();input.dbGet.mockResolvedValueOnce(null);
  expect(await dispatchOneStagingOwnerNotice(input)).toMatchObject({started:false,reason:'RECIPIENT_INELIGIBLE'});
  expect(input.fetcher).not.toHaveBeenCalled();expect(input.dbRun).not.toHaveBeenCalled();
  const [sql,args]=input.dbGet.mock.calls[0];
  expect(sql).toContain("a.status='published'");
  expect(sql).toContain("t.status='active'");
  expect(sql).toContain("u.role='owner'");
  expect(sql).toContain('pref.optedIn=1');
  expect(sql).toContain('p.userId IS NULL');
  expect(sql).toContain('d.revokedAt IS NULL AND f.revokedAt IS NULL');
  expect(args).toEqual([deviceHash,'notice_a','tenant_a','owner_a',options.now]);
 });
 it('does not send if token is bound to another restaurant or owner',async()=>{
  const input=fixture();
  const record=encryptBoundFcmToken({
   token,tenantId:'tenant_b',userId:'owner_b',deviceHash,env
  });
  input.dbGet.mockResolvedValueOnce({title:'Update',body:'This is a notice.'}).mockResolvedValueOnce(record);
  expect(await dispatchOneStagingOwnerNotice(input)).toMatchObject({started:false,reason:'TOKEN_UNAVAILABLE'});
  expect(input.fetcher).not.toHaveBeenCalled();
 });
 it('sends exactly one token-addressed message after an atomic claim',async()=>{
  const input=fixture();
  const outcome=await dispatchOneStagingOwnerNotice(input);
  expect(outcome).toEqual({started:true,accepted:true,deviceDelivered:false});
  expect(input.fetcher).toHaveBeenCalledTimes(2);
  const claim=input.dbRun.mock.calls[0];
  expect(claim[0]).toContain('INSERT OR IGNORE INTO platform_owner_communication_fcm_dispatch');
  expect(claim[0]).toContain('WHERE EXISTS');
  expect(claim[1].slice(0,4)).toEqual(['notice_a','tenant_a','owner_a',deviceHash]);
  expect(claim[0]).toContain('AND f.tokenHash=?');
  expect(claim[1].at(-1)).toBe(encryptBoundFcmToken({...options,token,env}).tokenHash);
  const sent=JSON.parse(input.fetcher.mock.calls[1][1].body);
  expect(sent.message.token).toBe(token);
  expect(sent.message.topic).toBeUndefined();
  expect(sent.message.condition).toBeUndefined();
  expect(JSON.stringify(outcome)).not.toContain(token);
 });
 it('does not send or retry if another worker already claimed notice and device',async()=>{
  const input=fixture();
  input.dbRun.mockResolvedValueOnce({changes:0});
  expect(await dispatchOneStagingOwnerNotice(input)).toMatchObject({
   started:false,reason:'ALREADY_CLAIMED_OR_INELIGIBLE'
  });
  expect(input.fetcher).not.toHaveBeenCalled();
 });
 it('marks ambiguous provider errors for manual review without a retry',async()=>{
  const input=fixture();
  input.fetcher.mockReset().mockRejectedValue(new Error('network timeout'));
  expect(await dispatchOneStagingOwnerNotice(input)).toEqual({
   started:true,accepted:false,deviceDelivered:false
  });
  expect(input.fetcher).toHaveBeenCalledTimes(1);
  const status=input.dbRun.mock.calls[1];
  expect(status[0]).toContain('status=?');
  expect(status[1][0]).toBe('manual_review');
 });
});
