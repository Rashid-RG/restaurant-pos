import {describe,it,expect,vi,afterEach} from 'vitest';
import {apiFetch} from '../apps/customer-web/src/utils/api.js';

afterEach(()=>{vi.unstubAllGlobals()});
function setClient(){
  const memory=new Map([['gastroflow_active_tenant','restaurant-123']]);
  const storage={getItem:key=>memory.get(key)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
  const mockFetch=vi.fn(async()=>({ok:true,status:200,json:async()=>({tenantId:'restaurant-123',items:[]})}));
  vi.stubGlobal('localStorage',storage);
  vi.stubGlobal('window',{location:{origin:'https://gastroflow-staging.onrender.com',port:''}});
  vi.stubGlobal('fetch',mockFetch);
  return mockFetch;
}
describe('GastroFlow Food anonymous discovery request headers',()=>{
  it('does not send unnecessary JSON content-type or selected tenant on a public restaurant listing GET',async()=>{
    const mockFetch=setClient();
    await apiFetch('/public/restaurants',{cache:'no-store'});
    const [url,opts]=mockFetch.mock.calls[0];
    expect(url).toBe('https://gastroflow-staging.onrender.com/api/public/restaurants');
    expect(opts.headers).not.toHaveProperty('Content-Type');
    expect(opts.headers).not.toHaveProperty('X-Tenant-Id');
    expect(opts.cache).toBe('no-store');
  });
  it('still retains tenant scoping and JSON on write requests',async()=>{
    const mockFetch=setClient();
    await apiFetch('/public/feedback',{method:'POST',body:JSON.stringify({message:'test'})});
    const opts=mockFetch.mock.calls[0][1];
    expect(opts.headers['X-Tenant-Id']).toBe('restaurant-123');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
  it('does not weaken menu requests scoped to the selected restaurant',async()=>{
    const mockFetch=setClient();
    await apiFetch('/public/menu');
    expect(mockFetch.mock.calls[0][1].headers['X-Tenant-Id']).toBe('restaurant-123');
  });
});
