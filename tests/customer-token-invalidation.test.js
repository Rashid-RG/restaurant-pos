import {describe,it,expect,vi,afterEach} from 'vitest';
import {shouldClearCustomerTokenForResponse} from '../apps/customer-web/src/utils/customer-token-invalidation.js';
import {apiFetch} from '../apps/customer-web/src/utils/api.js';

function testEnvironment(){
  const values=new Map([
    ['gastroflow_active_tenant','tenant-a'],
    ['gastroflow_customer_token:tenant-a','customer-secret-a'],
    ['gastroflow_order_access_order-42','tracking-secret']
  ]);
  const storage={
    getItem:k=>values.get(k)||null,
    setItem:(k,v)=>values.set(k,String(v)),
    removeItem:vi.fn(k=>values.delete(k))
  };
  vi.stubGlobal('window',{location:{origin:'https://gastroflow-staging.onrender.com',port:''}});
  vi.stubGlobal('localStorage',storage);
  return {storage,values};
}
function failedResponse(message,status=401){
  return {ok:false,status,json:async()=>({error:message})};
}
afterEach(()=>vi.unstubAllGlobals());

describe('customer token and public tracking isolation',()=>{
  it('refuses a failure from a public tracking header without customer bearer auth',()=>{
    expect(shouldClearCustomerTokenForResponse({status:401,message:'Invalid tracking token',customerToken:'abc'})).toBe(false);
    expect(shouldClearCustomerTokenForResponse({status:403,message:'Expired token',customerToken:'abc',authorizationHeader:'Bearer another'})).toBe(false);
  });
  it('clears only when the customer bearer token was actually used and explicitly revoked',()=>{
    expect(shouldClearCustomerTokenForResponse({status:401,message:'Authentication token expired',customerToken:'abc',authorizationHeader:'Bearer abc'})).toBe(true);
    expect(shouldClearCustomerTokenForResponse({status:401,message:'Temporary server error',customerToken:'abc',authorizationHeader:'Bearer abc'})).toBe(false);
    expect(shouldClearCustomerTokenForResponse({status:503,message:'Token invalid',customerToken:'abc',authorizationHeader:'Bearer abc'})).toBe(false);
  });
  it('does not log out customer when an order-specific tracking token expires',async()=>{
    const {storage,values}=testEnvironment();
    const fetcher=vi.fn(async()=>failedResponse('Invalid tracking token'));
    vi.stubGlobal('fetch',fetcher);
    await expect(apiFetch('/public/orders/order-42')).rejects.toThrow('Invalid tracking token');
    const headers=fetcher.mock.calls[0][1].headers;
    expect(headers['X-Order-Tracking']).toBe('tracking-secret');
    // The tracking endpoint optionally sends a customer token too, so only the
    // precise customer-auth error should invalidate the customer session.
    expect(values.get('gastroflow_customer_token:tenant-a')).toBe('customer-secret-a');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('still clears the current tenant login on an explicit customer-session rejection',async()=>{
    const {storage,values}=testEnvironment();
    vi.stubGlobal('fetch',vi.fn(async()=>failedResponse('Authentication token expired')));
    await expect(apiFetch('/customer/auth/me',{headers:{Authorization:'Bearer customer-secret-a'}})).rejects.toThrow('Authentication token expired');
    expect(values.has('gastroflow_customer_token:tenant-a')).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith('gastroflow_customer_token:tenant-a');
  });
  it('does not clear a new tenant login when a stale prior-tenant error arrives',async()=>{
    const {storage,values}=testEnvironment();
    let respond;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{respond=r})));
    const pending=apiFetch('/customer/auth/me',{headers:{Authorization:'Bearer customer-secret-a'}}).catch(e=>e);
    values.set('gastroflow_active_tenant','tenant-b');
    values.set('gastroflow_customer_token:tenant-b','customer-secret-b');
    respond(failedResponse('Authentication token invalid'));
    await pending;
    expect(values.get('gastroflow_customer_token:tenant-b')).toBe('customer-secret-b');
    expect(storage.removeItem).not.toHaveBeenCalledWith('gastroflow_customer_token:tenant-b');
  });
});
