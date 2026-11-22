import {describe,it,expect,vi} from 'vitest';
import crypto from 'node:crypto';
import {
 fcmTokenEnrollmentEnabled,encryptBoundFcmToken,decryptBoundFcmToken,
 registerOwnerFcmToken,revokeOwnerFcmToken
} from '../lib/communications/platform-fcm-token-registry.js';
import {digestOwnerInstallation} from '../lib/communications/platform-push-enrollment.js';

const installationId='1530ac0b-02f0-4ae5-a132-2056ab4bd660';
const token='fake_Android_token_9876543212345';
const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'staging-strong-device-binding-key-1234567890',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:crypto.randomBytes(32).toString('base64')
};
const tenantId='tenant_a',userId='owner_a';
const input={installationId,token};

describe('staging encrypted, tenant-bound FCM token enrollment',()=>{
 it('is disabled by default, in production, without verified isolation, or with weak keys',()=>{
  expect(fcmTokenEnrollmentEnabled({})).toBe(false);
  expect(fcmTokenEnrollmentEnabled(env)).toBe(true);
  for(const field of [
   {PLATFORM_COMMUNICATIONS_STAGE:'production'},
   {PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'},
   {PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'false'},
   {PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:'abc'},
   {PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'short'}
  ])expect(fcmTokenEnrollmentEnabled({...env,...field})).toBe(false);
 });
 it('encrypts with unique IV and authenticated owner/tenant/device binding',()=>{
  const deviceHash=digestOwnerInstallation(installationId,env);
  const x=encryptBoundFcmToken({token,tenantId,userId,deviceHash,env});
  const y=encryptBoundFcmToken({token,tenantId,userId,deviceHash,env});
  expect(x.tokenHash).toBe(y.tokenHash);
  expect(x.cipherText).not.toBe(y.cipherText);
  expect(JSON.stringify(x)).not.toContain(token);
  expect(decryptBoundFcmToken({record:x,tenantId,userId,deviceHash,env})).toBe(token);
  expect(decryptBoundFcmToken({record:x,tenantId:'tenant_b',userId,deviceHash,env})).toBeNull();
  expect(decryptBoundFcmToken({record:x,tenantId,userId:'another_owner',deviceHash,env})).toBeNull();
  expect(decryptBoundFcmToken({record:{...x,cipherTag:'bad'},tenantId,userId,deviceHash,env})).toBeNull();
 });
 it('rejects unenrolled devices and never trusts caller tenant/user identity',async()=>{
  const dbGet=vi.fn(async()=>null),dbRun=vi.fn();
  expect(await registerOwnerFcmToken({dbGet,dbRun,tenantId,userId,input,env}))
    .toEqual({status:'device_not_enrolled'});
  expect(dbRun).not.toHaveBeenCalled();
  const [sql,args]=dbGet.mock.calls[0];
  expect(sql).toContain('revokedAt IS NULL');
  expect(args[0]).toBe(tenantId);
  expect(args[1]).toBe(userId);
  expect(args[2]).toBe(digestOwnerInstallation(installationId,env));
 });
 it('rejects extra client-provided account fields, invalid token, and non-v4 IDs',async()=>{
  const dbGet=vi.fn(),dbRun=vi.fn();
  for(const invalid of [{...input,tenantId:'tenant_b'},{...input,token:'short'},
    {...input,installationId:'bad'}]){
    expect(await registerOwnerFcmToken({dbGet,dbRun,tenantId,userId,input:invalid,env}))
      .toEqual({status:'invalid'});
  }
  expect(dbGet).not.toHaveBeenCalled();
  expect(dbRun).not.toHaveBeenCalled();
 });
 it('requires same-tenant installation and rejects tokens belonging to other tenants',async()=>{
  const dbGet=vi.fn()
    .mockResolvedValueOnce({platform:'android'})
    .mockResolvedValueOnce({tenant_id:'tenant_b',userId:'owner_b',deviceHash:'other'});
  const dbRun=vi.fn();
  expect(await registerOwnerFcmToken({dbGet,dbRun,tenantId,userId,input,env}))
    .toEqual({status:'token_already_bound'});
  expect(dbRun).not.toHaveBeenCalled();
 });
 it('registers only ciphertext, hash and authenticated owner identity',async()=>{
  const dbGet=vi.fn().mockResolvedValueOnce({platform:'ios'}).mockResolvedValueOnce(null);
  const dbRun=vi.fn(async()=>({changes:1}));
  expect(await registerOwnerFcmToken({dbGet,dbRun,tenantId,userId,input,env,now:12345}))
    .toEqual({status:'registered',platform:'ios',pushOperational:false});
  const [sql,args]=dbRun.mock.calls[0];
  expect(sql).toContain('platform_owner_communication_fcm_tokens');
  expect(args.slice(0,2)).toEqual([tenantId,userId]);
  expect(args).not.toContain(token);
  expect(JSON.stringify(args)).not.toContain(token);
 });
 it('revokes only the token for the authenticated owner installation',async()=>{
  const dbRun=vi.fn(async()=>({changes:1}));
  expect(await revokeOwnerFcmToken({dbRun,tenantId,userId,installationId,env,now:100}))
    .toEqual({status:'revoked',pushOperational:false});
  expect(dbRun.mock.calls[0][1].slice(2,4)).toEqual([tenantId,userId]);
  expect(dbRun.mock.calls[0][0]).toContain('revokedAt IS NULL');
 });
});
