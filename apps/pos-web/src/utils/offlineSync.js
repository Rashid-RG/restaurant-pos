// Tenant-bound reconciliation queue. Never discard an unacknowledged sale.
const legacyKey = 'gastroflow_offline_orders';
const inFlight = new Map();
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
  const id = tenant();
  const token = localStorage.getItem('gastroflow_token');
  if (!id || !token) return { syncedCount: 0 };
  if (inFlight.has(id)) return inFlight.get(id);
  const queue = read(id);
  if (!queue.length) return { syncedCount: 0 };
  const result = { syncedCount: 0, syncedIds: [], conflicts: [] };
  async function submit(orders) {
    const response = await fetch(`${apiBaseUrl}/api/orders/offline-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orders })
    });
    const data = await response.json();
    if (response.status === 409 && data.code === 'RECONCILIATION_REQUIRED') {
      if (orders.length === 1) {
        result.conflicts.push({ offlineId: orders[0].offlineId, reason: data.error });
        return;
      }
      // The rejected batch was rolled back. Isolate the disputed sale while
      // preserving order, and keep each acknowledged neighbour on the server.
      const middle = Math.ceil(orders.length / 2);
      await submit(orders.slice(0, middle));
      await submit(orders.slice(middle));
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Offline reconciliation failed.');
    const requested = new Set(orders.map(order => order.offlineId));
    const acknowledged = new Set((data.syncedIds || []).filter(sale => requested.has(sale)));
    localStorage.setItem(key(id), JSON.stringify(read(id).filter(order => !acknowledged.has(order.offlineId))));
    result.syncedIds.push(...acknowledged);
    result.syncedCount += data.syncedCount || 0;
  }
  const task = (async () => {
    try {
      for (let offset = 0; offset < queue.length; offset += 100) {
        await submit(queue.slice(offset, offset + 100));
      }
    } catch (error) { result.error = error.message; }
    return result;
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, task);
  return task;
}
if (typeof window !== 'undefined') window.addEventListener('online', () => flushOfflineQueue());
