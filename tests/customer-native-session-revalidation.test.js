import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  NATIVE_SESSION_REVALIDATE_INTERVAL_MS,
  shouldRevalidateNativeCustomerSession,
  isCurrentNativeSessionCheck
} from '../apps/customer-web/src/utils/native-session-revalidation.js';

const ready={nativeBuild:true,token:'restaurant-a-customer-token',visible:true,online:true,
  now:200000,lastCheckedAt:200000-NATIVE_SESSION_REVALIDATE_INTERVAL_MS,inFlight:false};
describe('GastroFlow Food Android/iPhone customer session recovery',()=>{
  it('only rechecks an existing native login after throttle interval',()=>{
    expect(shouldRevalidateNativeCustomerSession(ready)).toBe(true);
    expect(shouldRevalidateNativeCustomerSession({...ready,lastCheckedAt:ready.now-1000})).toBe(false);
    expect(shouldRevalidateNativeCustomerSession({...ready,inFlight:true})).toBe(false);
    expect(shouldRevalidateNativeCustomerSession({...ready,token:''})).toBe(false);
    expect(shouldRevalidateNativeCustomerSession({...ready,nativeBuild:false})).toBe(false);
  });
  it('never revalidates while offline or backgrounded',()=>{
    expect(shouldRevalidateNativeCustomerSession({...ready,online:false})).toBe(false);
    expect(shouldRevalidateNativeCustomerSession({...ready,visible:false})).toBe(false);
    expect(shouldRevalidateNativeCustomerSession({...ready,now:NaN})).toBe(false);
  });
  it('rejects old tenant, token or auth attempt after switching accounts',()=>{
    const current={tenant:'restaurant-a',activeTenant:'restaurant-a',token:'token-a',
      savedToken:'token-a',epoch:3,currentEpoch:3,mounted:true};
    expect(isCurrentNativeSessionCheck(current)).toBe(true);
    expect(isCurrentNativeSessionCheck({...current,activeTenant:'restaurant-b'})).toBe(false);
    expect(isCurrentNativeSessionCheck({...current,savedToken:'token-b'})).toBe(false);
    expect(isCurrentNativeSessionCheck({...current,currentEpoch:4})).toBe(false);
    expect(isCurrentNativeSessionCheck({...current,mounted:false})).toBe(false);
  });
  it('wires foreground/network listeners and cleans them on unmount',()=>{
    const src=readFileSync('apps/customer-web/src/context/CustomerAuthContext.jsx','utf8');
    expect(src).toContain('shouldRevalidateNativeCustomerSession({');
    expect(src).toContain('isCurrentNativeSessionCheck({');
    expect(src).toContain('shouldForgetCustomerSession(error)');
    for(const event of ['visibilitychange','focus','pageshow','online']){
      expect(src).toContain(`addEventListener('${event}',check)`);
      expect(src).toContain(`removeEventListener('${event}',check)`);
    }
  });
});
