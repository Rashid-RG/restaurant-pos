// Active-tenant (restaurant) selection for the multi-tenant customer app.
// The chosen restaurant id is persisted so every public API call and SSE stream
// resolves the correct tenant on the backend (via X-Tenant-Id / ?tenantId=).
const KEY = 'gastroflow_active_tenant';

export function getActiveTenant() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setActiveTenant(id) {
  try { if (id) localStorage.setItem(KEY, String(id)); } catch { /* ignore */ }
}

export function clearActiveTenant() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Append the active tenant to an SSE/query URL (EventSource can't send headers).
export function withTenant(url) {
  const t = getActiveTenant();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + `tenantId=${encodeURIComponent(t)}`;
}
