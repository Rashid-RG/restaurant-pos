import { useEffect, useState } from 'react';

// One browser-workstation preference per tenant; no server billing data is changed.
const EVENT = 'gastroflow:billing-mode-changed';
export function billingModeKey(currentUser) {
  return `gastroflow:express-billing:${currentUser?.tenant_id || currentUser?.tenantId || 'unknown'}`;
}
export function readExpressBilling(key) {
  try { return localStorage.getItem(key) !== 'standard'; }
  catch { return true; }
}
export function useExpressBilling(currentUser) {
  const key = billingModeKey(currentUser);
  const [enabled, setEnabled] = useState(() => readExpressBilling(key));
  useEffect(() => {
    const sync = () => setEnabled(readExpressBilling(key));
    sync();
    const onChange = event => { if (!event.detail?.key || event.detail.key === key) sync(); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', sync);
    };
  }, [key]);
  const choose = next => {
    try { localStorage.setItem(key, next ? 'express' : 'standard'); }
    catch { /* private browsing may block preferences */ }
    setEnabled(next);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }));
  };
  return [enabled, choose];
}
