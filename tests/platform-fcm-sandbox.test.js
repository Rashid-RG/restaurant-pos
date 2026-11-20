import {describe,it,expect,vi} from 'vitest';
import crypto from 'node:crypto';
import {
  fcmSandboxConfig,createFcmServiceJwt,sendOneSandboxOwnerFcm
} from '../lib/communications/platform-fcm-sandbox.js';

const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
});
const env={
  PLATFORM_COMMUNICATIONS_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_STAGE:'staging',
  PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
  PLATFORM_COMMUNICATIONS_FCM_SEND_ENABLED:'true',
  PLATFORM_COMMUNICATIONS_FCM_STOP:'false',
  PLATFORM_COMMUNICATIONS_FCM_ACK:'I_APPROVE_STAGING_FCM_SANDBOX',
  PLATFORM_COMMUNICATIONS_FCM_PROJECT_ID:'gastroflow-staging',
  PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL:'sandbox@gastroflow-staging.iam.gserviceaccount.com',
  PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY:privateKey
};
const now=1795250000000;
const token='fake_Android_FCM_token_987654321';
const input={env,token,announcementId:'notice_1',title:'Restaurant owner update',body:'A new platform notice awaits you.',now};

describe('dormant Firebase Cloud Messaging transport',()=>{
 it('fails closed without staging, attested database and explicit controls',()=>{
  expect(fcmSandboxConfig({}).enabled).toBe(false);
  expect(fcmSandboxConfig(env)).toMatchObject({configured:true,enabled:true,project:'gastroflow-staging'});
  for(const field of [
    {PLATFORM_COMMUNICATIONS_STAGE:'production'},
    {PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'},
    {PLATFORM_COMMUNICATIONS_FCM_SEND_ENABLED:'false'},
    {PLATFORM_COMMUNICATIONS_FCM_STOP:'true'},
    {PLATFORM_COMMUNICATIONS_FCM_STOP:undefined},
    {PLATFORM_COMMUNICATIONS_FCM_ACK:'wrong'},
    {PLATFORM_COMMUNICATIONS_FCM_PROJECT_ID:'../other'},
    {PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY:'not a key'}
  ])expect(fcmSandboxConfig({...env,...field}).enabled).toBe(false);
 });
 it('signs a short-lived OAuth assertion with the supplied RSA key',()=>{
  const assertion=createFcmServiceJwt({clientEmail:env.PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL,
    privateKey,now});
  const [head,payload,signature]=assertion.split('.');
  expect(JSON.parse(Buffer.from(head,'base64url').toString())).toMatchObject({alg:'RS256'});
  expect(JSON.parse(Buffer.from(payload,'base64url').toString())).toMatchObject({
    iss:env.PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL,
    aud:'https://oauth2.googleapis.com/token',
    scope:'https://www.googleapis.com/auth/firebase.messaging',
    iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600
  });
  expect(crypto.verify('RSA-SHA256',Buffer.from(head+'.'+payload),publicKey,
    Buffer.from(signature,'base64url'))).toBe(true);
 });
 it('never contacts Google if disabled or payload malformed',async()=>{
  const fetcher=vi.fn();
  expect(await sendOneSandboxOwnerFcm({...input,env:{...env,PLATFORM_COMMUNICATIONS_FCM_STOP:'true'},fetcher}))
    .toEqual({accepted:false,reason:'DISABLED'});
  expect(await sendOneSandboxOwnerFcm({...input,token:'bad',fetcher}))
    .toEqual({accepted:false,reason:'INVALID_REQUEST'});
  expect(await sendOneSandboxOwnerFcm({...input,announcementId:'../tenant_other',fetcher}))
    .toEqual({accepted:false,reason:'INVALID_REQUEST'});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('sends only to one explicit device token using OAuth and FCM HTTP v1',async()=>{
  const fetcher=vi.fn()
    .mockResolvedValueOnce({ok:true,json:async()=>({access_token:'fake-oauth-access-token'})})
    .mockResolvedValueOnce({ok:true,json:async()=>({name:'projects/gastroflow-staging/messages/fake-123'})});
  const result=await sendOneSandboxOwnerFcm({...input,fetcher});
  expect(result).toEqual({accepted:true,deviceDelivered:false});
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [authUrl,authOptions]=fetcher.mock.calls[0];
  expect(authUrl).toBe('https://oauth2.googleapis.com/token');
  expect(authOptions.body).toContain('grant_type=');
  const [url,request]=fetcher.mock.calls[1];
  expect(url).toBe('https://fcm.googleapis.com/v1/projects/gastroflow-staging/messages:send');
  const payload=JSON.parse(request.body);
  expect(payload.message).toMatchObject({
    token,notification:{title:input.title,body:input.body},
    data:{kind:'platform_owner_announcement',announcementId:'notice_1'}
  });
  expect(payload.message.topic).toBeUndefined();
  expect(payload.message.condition).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain(env.PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY);
 });
 it('returns generic manual review status on network timeout without automatically retrying',async()=>{
  const fetcher=vi.fn()
    .mockResolvedValueOnce({ok:true,json:async()=>({access_token:'fake-oauth-access-token'})})
    .mockRejectedValueOnce(new Error('network timeout: contains secret text'));
  const outcome=await sendOneSandboxOwnerFcm({...input,fetcher});
  expect(outcome).toEqual({accepted:false,reason:'MANUAL_REVIEW_REQUIRED'});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(outcome)).not.toContain('secret text');
 });
 it('does not mistake HTTP acceptance for a displayed or read notification',async()=>{
  const fetcher=vi.fn()
    .mockResolvedValueOnce({ok:true,json:async()=>({access_token:'fake-oauth-access-token'})})
    .mockResolvedValueOnce({ok:false,json:async()=>({error:{message:'unknown device token'}})});
  expect(await sendOneSandboxOwnerFcm({...input,fetcher}))
    .toEqual({accepted:false,reason:'FCM_UNCONFIRMED'});
 });
});
