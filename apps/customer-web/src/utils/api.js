import { getActiveTenant } from './tenant.js';

export function apiUrl(endpoint, location = window.location) {
  const dev = location.port === '3001' || location.port === '3002';
  const origin = dev ? `${location.protocol}//${location.hostname}:5000` : location.origin;
  return new URL(endpoint, origin).href;
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
  let res;
  try {
    res = await fetch(absoluteUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(trackingAccess ? { 'X-Order-Tracking': trackingAccess } : {}),
        ...(trackedOrder && customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
        ...(/\/(?:customer|public)\/support\//.test(cleanPath) && customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
        ...(activeTenant ? { 'X-Tenant-Id': activeTenant } : {}),
        ...(options.headers || {})
      }
    });
  } catch (err) {
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
      if (/token|expired|invalid/i.test(data?.error || data?.message || '')) {
        localStorage.removeItem(customerTokenKey);
      }
    }
    const msg = typeof data?.error === 'string'
      ? data.error
      : (data?.message || `Error ${res.status}`);
    throw new Error(msg);
  }

  if (data?.orderId && data?.trackingToken) localStorage.setItem(`gastroflow_order_access_${data.orderId}`, data.trackingToken);
  return data;
}
