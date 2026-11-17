import {describe,it,expect} from 'vitest';
import {evaluateNativeStagingReadiness} from '../scripts/check-food-native-cors-config.mjs';

const valid=Object.freeze({
  RENDER_SERVICE_ID:'srv-dblpvdt9el5s73eebt0g',
  GASTROFLOW_TARGET:'staging',
  CUSTOMER_NATIVE_ORIGINS:'https://localhost,capacitor://localhost',
  CORS_ORIGIN:'https://gastroflow-staging.onrender.com'
});
describe('GastroFlow Food native CORS stage release gate',()=>{
  it('accepts only the approved staging target and exact native origins',()=>{
    expect(evaluateNativeStagingReadiness(valid)).toEqual({
      ready:true,stagingTargetVerified:true,missingNativeOrigins:[],
      invalidNativeOriginCount:0,reservedNativeOriginInBrowserCors:false
    });
  });
  it('refuses wrong, absent or production service IDs even with correct CORS',()=>{
    for(const id of ['',undefined,'srv-another-service','srv-gastroflow-production']){
      expect(evaluateNativeStagingReadiness({...valid,RENDER_SERVICE_ID:id}).ready).toBe(false);
    }
    expect(evaluateNativeStagingReadiness({...valid,GASTROFLOW_TARGET:'production'}).ready).toBe(false);
    expect(evaluateNativeStagingReadiness({...valid,GASTROFLOW_TARGET:undefined}).ready).toBe(false);
  });
  it('refuses incomplete Android/iOS origin lists and untrusted entries',()=>{
    const missing=evaluateNativeStagingReadiness({...valid,CUSTOMER_NATIVE_ORIGINS:'https://localhost'});
    expect(missing.ready).toBe(false);
    expect(missing.missingNativeOrigins).toEqual(['capacitor://localhost']);
    const invalid=evaluateNativeStagingReadiness({...valid,CUSTOMER_NATIVE_ORIGINS:valid.CUSTOMER_NATIVE_ORIGINS+',*'});
    expect(invalid.ready).toBe(false);
    expect(invalid.invalidNativeOriginCount).toBe(1);
  });
  it('rejects mixing native origins into the existing browser CORS list',()=>{
    expect(evaluateNativeStagingReadiness({...valid,CORS_ORIGIN:'https://localhost'}).ready).toBe(false);
    expect(evaluateNativeStagingReadiness({...valid,CORS_ORIGIN:'*'}).ready).toBe(false);
  });
  it('never outputs configured browser CORS domain or credentials in the audit object',()=>{
    const result=evaluateNativeStagingReadiness({...valid,CORS_ORIGIN:'https://secret-private-domain.invalid',TURSO_AUTH_TOKEN:'DO_NOT_LOG_THIS_TOKEN'});
    const json=JSON.stringify(result);
    expect(json).not.toContain('DO_NOT_LOG_THIS_TOKEN');
    expect(json).not.toContain('secret-private-domain');
  });
});
