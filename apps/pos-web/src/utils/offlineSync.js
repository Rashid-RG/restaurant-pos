// Tenant-bound reconciliation queue. Never discard an unacknowledged sale.
const legacyKey = 'gastroflow_offline_orders';
let inFlight = null;
function tenant() {
  try { return JSON.parse(localStorage.getItem('gastroflow_user') || 'null')?.tenant_id || null; }
  catch { return null; }
}
const key = id => `${legacyKey}:${id}`;
function read(id) {
  try { const rows = JSON.parse(localStorage.getItem(key(id)) || '[]'); return Array.isArray(rows) ? rows : []; }
  catch { return []; }
}
export function getOfflineQueue() { const id = tenant(); return id ? read(id) : []; }
export function saveOfflineOrder(orderPayload) {
  const id = tenant();
  if (!id) throw new Error('Sign in to a restaurant before saving an offline sale.');
  const order = { ...orderPayload, tenant_id: id, offlineId: `off_${crypto.randomUUID()}`, createdAt: Date.now() };
  localStorage.setItem(key(id), JSON.stringify([...read(id), order]));
  return order;
}
export function clearOfflineQueue() { const id = tenant(); if (id) localStorage.removeItem(key(id)); }
export async function flushOfflineQueue(apiBaseUrl = '') {
  if (inFlight) return inFlight;
  const id = tenant();
  const token = localStorage.getItem('gastroflow_token');
  if (!id || !token) return { syncedCount: 0 };
  const queue = read(id);
  if (!queue.length) return { syncedCount: 0 };
  inFlight = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/offline-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ orders: queue }) });
      const data = await response.json();
      if (!response.ok) return { syncedCount: 0, error: data.error };
      const acknowledged = new Set(data.syncedIds || []);
      localStorage.setItem(key(id), JSON.stringify(read(id).filter(order => !acknowledged.has(order.offlineId))));
      return data;
    } catch (error) { return { syncedCount: 0, error: error.message }; }
    finally { inFlight = null; }
  })();
  return inFlight;
}
if (typeof window !== 'undefined') window.addEventListener('online', () => flushOfflineQueue());
