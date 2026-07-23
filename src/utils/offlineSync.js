/**
 * src/utils/offlineSync.js — POS Offline Order Queue & Sync Engine
 *
 * Persists Cash sales to localStorage/IndexedDB when offline and automatically
 * flushes the queue to /api/orders/offline-sync when network connectivity returns.
 */

const STORAGE_KEY = 'gastroflow_offline_orders';

export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error reading offline queue:', err);
    return [];
  }
}

export function saveOfflineOrder(orderPayload) {
  try {
    const queue = getOfflineQueue();
    const offlineOrder = {
      ...orderPayload,
      offlineId: `off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now()
    };
    queue.push(offlineOrder);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    console.log(`[Offline Sync] Order ${offlineOrder.offlineId} queued locally.`);
    return offlineOrder;
  } catch (err) {
    console.error('Failed to save offline order:', err);
    throw err;
  }
}

export function clearOfflineQueue() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function flushOfflineQueue(apiBaseUrl = '') {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { syncedCount: 0 };

  console.log(`[Offline Sync] Attempting to flush ${queue.length} queued orders...`);

  try {
    const response = await fetch(`${apiBaseUrl}/api/orders/offline-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ orders: queue })
    });

    if (response.ok) {
      const data = await response.json();
      clearOfflineQueue();
      console.log(`[Offline Sync] Successfully synced ${data.syncedCount} orders.`);
      return data;
    } else {
      console.warn('[Offline Sync] Server rejected queue sync:', await response.text());
      return { syncedCount: 0 };
    }
  } catch (err) {
    console.warn('[Offline Sync] Network offline or server unreachable:', err.message);
    return { syncedCount: 0 };
  }
}

// Auto-sync listener on window online event
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Network] System came back online. Flushing offline queue...');
    flushOfflineQueue();
  });
}
