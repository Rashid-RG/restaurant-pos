// Compatibility module: keep existing POS imports and the same module-scoped offline sale queue.
export { getOfflineQueue, saveOfflineOrder, clearOfflineQueue, flushOfflineQueue } from '../../apps/pos-web/src/utils/offlineSync.js';
