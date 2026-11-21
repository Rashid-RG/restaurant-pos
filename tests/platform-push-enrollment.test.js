import {describe,it,expect,vi} from 'vitest';
import {
  pushEnrollmentEnabled,digestOwnerInstallation,checkInstallationInput,
  enrollOwnerInstallation,revokeOwnerInstallation
} from '../lib/communications/platform-push-enrollment.js';
const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'test-key-for-staging-installation-hmac-only-123456'
};
const input={installationId:'1530ac0b-02f0-4ae5-a132-2056ab4bd660',platform:'android'};
describe('staging-only owner push installation registry',()=>{
  it('is disabled by default, in production and without keyed secret',()=>{
    expect(pushEnrollmentEnabled({})).toBe(false);
    expect(pushEnrollmentEnabled({...env,PLATFORM_COMMUNICATIONS_STAGE:'production'})).toBe(false);
    expect(pushEnrollmentEnabled({...env,PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'short'})).toBe(false);
    expect(pushEnrollmentEnabled(env)).toBe(true);
  });
  it('validates UUID v4 identifiers and enumerated platform without extra fields',()=>{
    expect(checkInstallationInput(input)).toBe(true);
    expect(checkInstallationInput({...input,tenantId:'other'})).toBe(false);
    expect(checkInstallationInput({...input,platform:'apns'})).toBe(false);
    expect(checkInstallationInput({...input,installationId:'a raw push token'})).toBe(false);
  });
  it('hashes device identifiers deterministically without exposing source',()=>{
    const digest=digestOwnerInstallation(input.installationId,env);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(input.installationId);
    expect(digestOwnerInstallation(input.installationId,env)).toBe(digest);
    expect(digestOwnerInstallation(input.installationId,{...env,PLATFORM_COMMUNICATIONS_STAGE:'production'})).toBeNull();
  });
  it('requires an enabled staging gate before storage reads or writes',async()=>{
    const dbGet=vi.fn(),dbRun=vi.fn();
    expect(await enrollOwnerInstallation({dbGet,dbRun,tenantId:'a',userId:'b',input,env:{}}))
      .toEqual({status:'disabled'});
    expect(dbGet).not.toHaveBeenCalled();
    expect(dbRun).not.toHaveBeenCalled();
  });
  it('rejects installation already associated with another owner or tenant',async()=>{
    const dbGet=vi.fn(async()=>({tenant_id:'other_tenant',userId:'other_owner'}));
    const dbRun=vi.fn();
    const result=await enrollOwnerInstallation({dbGet,dbRun,tenantId:'tenant_a',userId:'owner_a',input,env});
    expect(result).toEqual({status:'conflict'});
    expect(dbRun).not.toHaveBeenCalled();
  });
  it('does not save raw installation IDs and scopes registration to actor',async()=>{
    const dbGet=vi.fn(async()=>null),dbRun=vi.fn(async()=>({changes:1}));
    const result=await enrollOwnerInstallation({dbGet,dbRun,tenantId:'tenant_a',userId:'owner_a',input,env,now:1234});
    expect(result).toMatchObject({status:'enrolled',platform:'android',pushOperational:false});
    const [sql,args]=dbRun.mock.calls[0];
    expect(sql).toContain('platform_owner_communication_devices');
    expect(args.slice(0,2)).toEqual(['tenant_a','owner_a']);
    expect(args).not.toContain(input.installationId);
    expect(args[2]).toHaveLength(64);
  });
  it('revokes only exact authenticated owner and tenant installation',async()=>{
    const dbRun=vi.fn(async()=>({changes:1}));
    const result=await revokeOwnerInstallation({dbRun,tenantId:'tenant_a',userId:'owner_a',installationId:input.installationId,env,now:500});
    expect(result).toEqual({status:'revoked',pushOperational:false});
    const [sql,args]=dbRun.mock.calls[0];
    expect(sql).toContain('revokedAt IS NULL');
    expect(args.slice(2,4)).toEqual(['tenant_a','owner_a']);
    expect(args).not.toContain(input.installationId);
  });
});
