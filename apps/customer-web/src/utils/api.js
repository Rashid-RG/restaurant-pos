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

  const res = await fetch(absoluteUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(activeTenant ? { 'X-Tenant-Id': activeTenant } : {}),
      ...(options.headers || {})
    }
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Server error (${res.status})`);
  }

  if (!res.ok) {
    const msg = typeof data?.error === 'string'
      ? data.error
      : (data?.message || `Error ${res.status}`);
    throw new Error(msg);
  }

  return data;
}
