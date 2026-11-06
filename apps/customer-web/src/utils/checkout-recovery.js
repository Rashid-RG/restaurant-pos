import { getActiveTenant } from './tenant.js';
const storageKey = () => `gastroflow_checkout_recovery:${getActiveTenant() || 'default_tenant'}`;
export function readPendingCheckout() {
  try { const saved=JSON.parse(sessionStorage.getItem(storageKey()) || 'null');return saved?.key && saved?.payload ? saved : null; } catch { return null; }
}
export function checkoutIntent(payload) {
  const previous=readPendingCheckout();
  if(previous){
    if(JSON.stringify(previous.payload)!==JSON.stringify(payload))throw new Error('A previous checkout may already be saved. Recover it before starting another order.');
    return previous;
  }
  const next={key:crypto.randomUUID(),payload};
  // If private session storage is unavailable, stop before sending an unsafe retry.
  sessionStorage.setItem(storageKey(),JSON.stringify(next));return next;
}
export function clearPendingCheckout() { sessionStorage.removeItem(storageKey()); }
