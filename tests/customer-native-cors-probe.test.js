import {describe,it,expect,vi} from 'vitest';
import {evaluatePreflight,probeNativeCors,evaluateNativeDiscoveryGet,probeNativeDiscoveryGet,WEBVIEW_ORIGINS} from '../scripts/probe-food-native-cors.mjs';

const headers=origin=>new Headers({
  'access-control-allow-origin':origin,
  'access-control-allow-credentials':'true',
  'access-control-allow-methods':'GET, HEAD, POST',
  'access-control-allow-headers':'content-type,x-tenant-id'
});
describe('GastroFlow Food native staging CORS diagnostic',()=>{
  it('accepts only an exact matching origin with correct credentials, method and headers',()=>{
    expect(evaluatePreflight({status:204,headers:headers('https://localhost')},'https://localhost')).toEqual({allowed:true,reason:'preflight-accepted'});
    expect(evaluatePreflight({status:204,headers:headers('capacitor://localhost')},'https://localhost').reason).toBe('origin-not-authorized');
    expect(evaluatePreflight({status:204,headers:headers('*')},'https://localhost').allowed).toBe(false);
  });
  it('rejects missing tenant request authorization or credentials',()=>{
    const noTenant=new Headers({'access-control-allow-origin':'https://localhost','access-control-allow-credentials':'true','access-control-allow-methods':'GET','access-control-allow-headers':'content-type'});
    expect(evaluatePreflight({status:204,headers:noTenant}).allowed).toBe(false);
    const noCreds=new Headers({'access-control-allow-origin':'https://localhost','access-control-allow-methods':'GET','access-control-allow-headers':'content-type,x-tenant-id'});
    expect(evaluatePreflight({status:204,headers:noCreds},'https://localhost').allowed).toBe(false);
  });
  it('checks both Android and iOS origins using read-only OPTIONS, never private requests',async()=>{
    const fetcher=vi.fn(async(_url,opts)=>({status:204,headers:headers(opts.headers.Origin)}));
    const reports=await probeNativeCors({fetcher});
    expect(reports.map(r=>r.origin)).toEqual(WEBVIEW_ORIGINS);
    expect(reports.every(r=>r.allowed)).toBe(true);
    for(const [url,opts] of fetcher.mock.calls){
      expect(url).toBe('https://gastroflow-staging.onrender.com/api/public/restaurants');
      expect(opts.method).toBe('OPTIONS');
      expect(opts.headers).not.toHaveProperty('Authorization');
    }
  });
  it('identifies ambiguous 401 preflight versus upstream authentication without pretending login failed',()=>{
    expect(evaluatePreflight({status:401,headers:new Headers()},'https://localhost')).toEqual({allowed:false,reason:'preflight-rejected-or-auth-gate'});
    const gateway=new Headers({'www-authenticate':'Basic realm="staging"'});
    expect(evaluatePreflight({status:401,headers:gateway},'https://localhost')).toEqual({allowed:false,reason:'upstream-auth-challenge'});
  });
  it('reports timeout or blocked CORS without treating it as a success',async()=>{
    const reports=await probeNativeCors({fetcher:async()=>{throw {name:'TimeoutError'}}});
    expect(reports).toHaveLength(2);
    expect(reports.every(r=>!r.allowed&&r.reason==='timeout')).toBe(true);
  });
  it('separates read-only anonymous discovery from private preflight acceptance',async()=>{
    const cancel=vi.fn(async()=>{});
    const fetcher=vi.fn(async(_url,opts)=>({
      status:200,headers:new Headers({'access-control-allow-origin':opts.headers.Origin}),
      body:{cancel}
    }));
    const reports=await probeNativeDiscoveryGet({fetcher});
    expect(reports).toHaveLength(2);
    expect(reports.every(r=>r.allowed&&r.request==='anonymous-GET')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(2);
    for(const [url,opts] of fetcher.mock.calls){
      expect(url).toBe('https://gastroflow-staging.onrender.com/api/public/restaurants');
      expect(opts.method).toBe('GET');
      expect(opts.headers).toEqual({Origin:opts.headers.Origin});
      expect(opts.credentials).toBe('omit');
    }
  });
  it('fails closed for missing or wildcard discovery CORS headers',()=>{
    expect(evaluateNativeDiscoveryGet({status:200,headers:new Headers()},'https://localhost').allowed).toBe(false);
    expect(evaluateNativeDiscoveryGet({status:200,headers:new Headers({'access-control-allow-origin':'*'})},'https://localhost').allowed).toBe(false);
    expect(evaluateNativeDiscoveryGet({status:401,headers:new Headers()},'https://localhost').reason).toBe('discovery-auth-or-upstream-gate');
  });
  it('does not issue discovery GET to an arbitrary or production host',async()=>{
    await expect(probeNativeDiscoveryGet({host:'https://gastroflow.onrender.com',fetcher:vi.fn()})).rejects.toThrow(/staging/);
  });
  it('refuses a production host',async()=>{
    await expect(probeNativeCors({host:'https://gastroflow.onrender.com',fetcher:vi.fn()})).rejects.toThrow(/staging/);
  });
});
