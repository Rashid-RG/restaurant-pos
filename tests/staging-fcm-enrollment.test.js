import {describe,it,expect,vi} from 'vitest';
import {
  STAGING_ORIGIN,STAGING_DEVICE_OWNER_KEY,eligibleStagingOwner,getStagingInstallationId,
  enrollStagingOwnerPush,revokeStagingOwnerPush,revokeStagingInstallationOnLogout
} from '../src/utils/staging-fcm-enrollment.js';

const user={id:'owner_a',tenant_id:'tenant_a',role:'owner',isPlatformAdmin:false};
const uuid='1530ac0b-02f0-4ae5-a132-2056ab4bd660';
const fcmToken='fake_FCM_registration_token_1234567890123456789';
function fixture(){
  const contents=new Map([['gastroflow_token','signed-in-fake-test-jwt']]);
  const storage={
    getItem:vi.fn(key=>contents.get(key)||null),
    setItem:vi.fn((key,value)=>contents.set(key,value))
  };
  const messaging={
    requestPermissions:vi.fn(async()=>({receive:'granted'})),
    getToken:vi.fn(async()=>({token:fcmToken}))
  };
  const capacitor={
    isNativePlatform:()=>true,isPluginAvailable:x=>x==='FirebaseMessaging',
    getPlatform:()=> 'android',Plugins:{FirebaseMessaging:messaging}
  };
  const calls=[];
  const fetcher=vi.fn(async (url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/push-enrollment-readiness'))return {
      ok:true,json:async()=>({enabled:true,sendingEnabled:false})
    };
    if(url.endsWith('/push-preference'))return {
      ok:true,json:async()=>({optedIn:JSON.parse(options.body).optedIn})
    };
    if(url.endsWith('/devices'))return {
      ok:true,json:async()=>({status:'enrolled',pushOperational:false})
    };
    if(url.endsWith('/fcm-token'))return {
      ok:true,json:async()=>({status:'registered',pushOperational:false})
    };
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  });
  const options={user,origin:STAGING_ORIGIN,capacitor,storage,fetcher,makeUUID:()=>uuid};
  return {storage,capacitor,messaging,fetcher,calls,options};
}

describe('native staging-only owner FCM enrollment',()=>{
  it('does not offer the control to web browsers, staff, admins, or other origins',()=>{
    const f=fixture();
    expect(eligibleStagingOwner(user,f.capacitor,STAGING_ORIGIN)).toBe(true);
    expect(eligibleStagingOwner(user,f.capacitor,'https://another-store.example')).toBe(false);
    expect(eligibleStagingOwner({...user,role:'manager'},f.capacitor,STAGING_ORIGIN)).toBe(false);
    expect(eligibleStagingOwner({...user,isPlatformAdmin:true},f.capacitor,STAGING_ORIGIN)).toBe(false);
    expect(eligibleStagingOwner(user,{...f.capacitor,isNativePlatform:()=>false},STAGING_ORIGIN)).toBe(false);
    expect(eligibleStagingOwner(user,{...f.capacitor,getPlatform:()=> 'web'},STAGING_ORIGIN)).toBe(false);
  });
  it('keeps installation identifiers stable for one owner and isolated across accounts',()=>{
    const f=fixture();
    expect(getStagingInstallationId(f.storage,user,()=>uuid)).toBe(uuid);
    expect(getStagingInstallationId(f.storage,user,()=>{throw Error('should reuse')})).toBe(uuid);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
    expect(f.storage.setItem.mock.calls[0][0]).toContain('tenant_a:owner_a');
  });
  it('performs isolated-server preflight before any consent or token write',async()=>{
    const f=fixture();
    f.fetcher.mockResolvedValue({ok:true,json:async()=>({enabled:false})});
    await expect(enrollStagingOwnerPush(f.options)).rejects.toThrow('database isolation');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][0]).toContain('/push-enrollment-readiness');
    expect(f.fetcher.mock.calls[0][1].method).toBe('GET');
    expect(f.messaging.getToken).not.toHaveBeenCalled();
  });
  it('never calls Firebase when the runtime origin is not the staging URL',async()=>{
    const f=fixture();
    await expect(enrollStagingOwnerPush({...f.options,origin:'http://localhost:3000'}))
      .rejects.toThrow('Owner staging device required');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.messaging.requestPermissions).not.toHaveBeenCalled();
  });
  it('registers after explicit consent, device enrollment and notification permission',async()=>{
    const f=fixture();
    expect(await enrollStagingOwnerPush(f.options))
      .toEqual({status:'registered',registered:true,pushOperational:false});
    expect(f.calls.map(x=>x.url.split('/').at(-1))).toEqual([
      'push-enrollment-readiness','push-preference','devices','fcm-token'
    ]);
    expect(f.messaging.getToken).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.calls[2].options.body)).toEqual({installationId:uuid,platform:'android'});
    expect(JSON.parse(f.calls[3].options.body)).toEqual({installationId:uuid,token:fcmToken});
    expect(f.calls[3].options.headers.Authorization).toBe('Bearer signed-in-fake-test-jwt');
    expect(f.calls.every(x=>!JSON.stringify(x.options.headers).includes(fcmToken))).toBe(true);
    expect(JSON.stringify(await enrollStagingOwnerPush(f.options))).not.toContain(fcmToken);
  });
  it('does not request an FCM token after the user denies permission',async()=>{
    const f=fixture();
    f.messaging.requestPermissions.mockResolvedValueOnce({receive:'denied'});
    expect(await enrollStagingOwnerPush(f.options))
      .toEqual({status:'permission_denied',registered:false});
    expect(f.messaging.getToken).not.toHaveBeenCalled();
    expect(f.calls.map(x=>x.url.split('/').at(-1))).toEqual([
      'push-enrollment-readiness','push-preference','devices'
    ]);
  });
  it('blocks a second restaurant owner after first registration until server revocation',async()=>{
    const f=fixture();
    expect((await enrollStagingOwnerPush(f.options)).registered).toBe(true);
    expect(f.storage.getItem(STAGING_DEVICE_OWNER_KEY))
      .toBe(JSON.stringify(['tenant_a','owner_a']));
    const secondOwner={...user,id:'owner_b',tenant_id:'tenant_b'};
    const calls=f.fetcher.mock.calls.length;
    await expect(enrollStagingOwnerPush({...f.options,user:secondOwner}))
      .rejects.toThrow('previous owner push registration');
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
    // Owner A may explicitly disable; only then can owner B register.
    await revokeStagingOwnerPush(f.options);
    expect(f.storage.getItem(STAGING_DEVICE_OWNER_KEY)).toBe(null);
    expect((await enrollStagingOwnerPush({...f.options,user:secondOwner})).registered)
      .toBe(true);
  });
  it('retains prior-owner binding when offline logout cannot confirm revocation',async()=>{
    const f=fixture();
    await enrollStagingOwnerPush(f.options);
    f.fetcher.mockRejectedValue(new Error('offline'));
    expect(await revokeStagingInstallationOnLogout(f.options))
      .toEqual({status:'unconfirmed'});
    expect(f.storage.getItem(STAGING_DEVICE_OWNER_KEY))
      .toBe(JSON.stringify(['tenant_a','owner_a']));
    await expect(enrollStagingOwnerPush({...f.options,
      user:{...user,id:'owner_b',tenant_id:'tenant_b'}}))
      .rejects.toThrow('previous owner push registration');
  });
  it('allows the signed-in owner to withdraw push consent and revoke devices',async()=>{
    const f=fixture();
    expect(await revokeStagingOwnerPush(f.options)).toEqual({status:'disabled'});
    expect(f.calls).toHaveLength(1);
    expect(JSON.parse(f.calls[0].options.body)).toEqual({optedIn:false});
  });
  it('revokes only this native staging installation during logout',async()=>{
    const f=fixture();
    getStagingInstallationId(f.storage,user,()=>uuid);
    f.fetcher.mockImplementation(async(url)=>{
      expect(url).toBe('/api/owner/communications/devices/revoke');
      return {ok:true,json:async()=>({status:'revoked'})};
    });
    expect(await revokeStagingInstallationOnLogout(f.options)).toEqual({status:'revoked'});
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const [,request]=f.fetcher.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({installationId:uuid});
    expect(request.headers.Authorization).toBe('Bearer signed-in-fake-test-jwt');
  });
  it('does not trigger a logout network call for web or other owners',async()=>{
    const f=fixture();
    getStagingInstallationId(f.storage,user,()=>uuid);
    expect(await revokeStagingInstallationOnLogout({
      ...f.options,origin:'https://unrelated.example'
    })).toEqual({status:'not_applicable'});
    expect(await revokeStagingInstallationOnLogout({
      ...f.options,user:{...user,role:'manager'}
    })).toEqual({status:'not_applicable'});
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('does not block local logout if network revocation fails',async()=>{
    const f=fixture();
    getStagingInstallationId(f.storage,user,()=>uuid);
    f.fetcher.mockRejectedValue(new Error('offline'));
    expect(await revokeStagingInstallationOnLogout(f.options))
      .toEqual({status:'unconfirmed'});
  });
  it('never sends client-selected tenant or owner identifiers in request bodies',async()=>{
    const f=fixture();
    await enrollStagingOwnerPush(f.options);
    for(const x of f.calls.filter(x=>x.options.body)){
      const data=JSON.parse(x.options.body);
      expect(data).not.toHaveProperty('tenantId');
      expect(data).not.toHaveProperty('userId');
    }
  });
});
