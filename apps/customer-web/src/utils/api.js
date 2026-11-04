import { getActiveTenant } from './tenant.js';

export async function apiFetch(endpoint, options = {}) {
  const cleanPath = endpoint.startsWith('/api')
    ? endpoint
    : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const isDevPort = window.location.port === '3001' || window.location.port === '3002';
  const apiOrigin = isDevPort ? `${window.location.protocol}//${window.location.hostname}:5000` : window.location.origin;
  const absoluteUrl = new URL(cleanPath, apiOrigin).href;

  // Attach the active tenant so the backend serves this restaurant's data.
  const activeTenant = getActiveTenant();

  const trackedOrder = cleanPath.match(/^\/api\/public\/orders\/([^/?]+)/)?.[1] || (['/api/public/feedback','/api/payments/payhere/checkout','/api/public/payment/payhere/hash'].includes(cleanPath) && JSON.parse(options.body || '{}').orderId);
  const trackingAccess = trackedOrder && localStorage.getItem(`gastroflow_order_access_${trackedOrder}`);
  let res;
  try {
    res = await fetch(absoluteUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(trackingAccess ? { 'X-Order-Tracking': trackingAccess } : {}),
        ...(trackedOrder && localStorage.getItem('gastroflow_customer_token') ? { Authorization: `Bearer ${localStorage.getItem('gastroflow_customer_token')}` } : {}),
        ...(/\/(?:customer|public)\/support\//.test(cleanPath) && localStorage.getItem('gastroflow_customer_token') ? { Authorization: `Bearer ${localStorage.getItem('gastroflow_customer_token')}` } : {}),
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
        localStorage.removeItem('gastroflow_customer_token');
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
