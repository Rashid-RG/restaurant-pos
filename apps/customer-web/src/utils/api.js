import { getActiveTenant } from './tenant.js';
import { resolveApiUrl } from './native-api-origin.js';
import { shouldClearCustomerTokenForResponse } from './customer-token-invalidation.js';

export function apiUrl(endpoint, location = window.location) {
  return resolveApiUrl(endpoint,{
    location,
    nativeBuild:import.meta.env.MODE==='native',
    configuredOrigin:import.meta.env.VITE_NATIVE_API_ORIGIN,
  });
}

export async function apiFetch(endpoint, options = {}) {
  const cleanPath = endpoint.startsWith('/api')
    ? endpoint
    : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const absoluteUrl = apiUrl(cleanPath);

  // Attach the active tenant so the backend serves this restaurant's data.
  const activeTenant = getActiveTenant();

  const trackedOrder = cleanPath.match(/^\/api\/public\/orders\/([^/?]+)/)?.[1] || (['/api/public/feedback','/api/payments/payhere/checkout','/api/public/payment/payhere/hash'].includes(cleanPath) && JSON.parse(options.body || '{}').orderId);
  const trackingAccess = trackedOrder && localStorage.getItem(`gastroflow_order_access_${trackedOrder}`);
  const customerTokenKey = 'gastroflow_customer_token:' + encodeURIComponent(activeTenant || 'default_tenant');
  const customerToken = localStorage.getItem(customerTokenKey);
  const isPublicDiscovery=cleanPath==='/api/public/restaurants' && (!options.method || options.method.toUpperCase()==='GET');
  const hasRequestBody=options.body!==undefined && options.body!==null;
  const cachePublicMenu=cleanPath==='/api/public/menu' && (!options.method || options.method==='GET');
  const cacheKey='gastroflow_public_menu_snapshot:'+encodeURIComponent(activeTenant||'default_tenant');
  const offlineMenu=()=>{
    if(!cachePublicMenu)return null;
    try{
      const saved=JSON.parse(localStorage.getItem(cacheKey)||'null');
      if(saved?.data?.tenantId===(activeTenant||'default_tenant') && Date.now()-saved.storedAt<24*3600000)
        return {...saved.data,offlineSnapshot:true};
    }catch{}
    return null;
  };
  // Snapshot the exact outbound headers: a rejected tracking link must never
  // revoke a separate customer's login or a different restaurant's session.
  const requestHeaders = {
        // Anonymous restaurant discovery needs no tenant or JSON request headers.
        // This avoids an unnecessary CORS preflight on cross-origin native GETs.
        ...(!isPublicDiscovery && hasRequestBody ? { 'Content-Type': 'application/json' } : {}),
        ...(trackingAccess ? { 'X-Order-Tracking': trackingAccess } : {}),
        ...(trackedOrder && customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
        ...(/\/(?:customer|public)\/support\//.test(cleanPath) && customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
        ...(!isPublicDiscovery && activeTenant ? { 'X-Tenant-Id': activeTenant } : {}),
        ...(options.headers || {})
  };
  let res;
  try {
    res = await fetch(absoluteUrl, {
      ...options,
      headers: requestHeaders
    });
  } catch (err) {
    const saved=offlineMenu();
    if(saved)return saved;
    throw new Error('Connection timeout or network error. Please check internet connection.');
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Server error (${res.status})`);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const authorizationHeader = new Headers(requestHeaders).get('authorization');
      if (shouldClearCustomerTokenForResponse({
        status:res.status, message:data?.error || data?.message,
        customerToken, authorizationHeader
      })) {
        localStorage.removeItem(customerTokenKey);
      }
    }
    const msg = typeof data?.error === 'string'
      ? data.error
      : (data?.message || `Error ${res.status}`);
    const error = new Error(msg);
    error.status = res.status;
    error.code = data?.code;
    throw error;
  }

  // Cache only a public, tenant-scoped menu snapshot for read-only offline browsing.
  // Never cache customer account, payment, private order or authentication responses.
  if(cachePublicMenu && data?.tenantId===(activeTenant||'default_tenant')){
    try{
      const encoded=JSON.stringify({storedAt:Date.now(),data});
      if(encoded.length<350000)localStorage.setItem(cacheKey,encoded);
    }catch{}
  }
  if (data?.orderId && data?.trackingToken) localStorage.setItem(`gastroflow_order_access_${data.orderId}`, data.trackingToken);
  return data;
}
