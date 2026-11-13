import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api.js';
import { getActiveTenant } from '../utils/tenant.js';

// A missing, offline or paused storefront must never be presented as open.
// The active restaurant is fixed by the selected tenant, not a fallback brand.
export function useStorefront() {
  const [state, setState] = useState({ status: 'checking', tenantId: getActiveTenant(), name: '', address: '', phone: '' });
  const refresh = useCallback(async () => {
    const requestedTenant = getActiveTenant();
    if (!requestedTenant) {
      setState({ status: 'unselected', tenantId: '', name: '', address: '', phone: '' });
      return false;
    }
    try {
      const details = await apiFetch('/public/store-info', { cache: 'no-store' });
      if (getActiveTenant() !== requestedTenant) return false;
      // Never show the status of a restaurant other than the selected one.
      if (details?.tenantId !== requestedTenant) {
        setState({ status: 'unavailable', tenantId: requestedTenant, name: '', address: '', phone: '' });
        return false;
      }
      const open = details.storeOpen === true;
      setState({ ...details, status: open ? 'open' : 'closed' });
      return open;
    } catch {
      if (getActiveTenant() === requestedTenant) {
        setState(previous => ({ ...previous, tenantId: requestedTenant, status: 'unavailable' }));
      }
      return false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    const interval = window.setInterval(onFocus, 15000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  return { store: state, refreshStore: refresh, canOrder: state.status === 'open' };
}
