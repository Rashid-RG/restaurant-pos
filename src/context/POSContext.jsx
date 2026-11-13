import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db, seedDatabase } from '../database/db';
import { isExpiredStaffSession, restoreStaffSession } from '../utils/staff-session';

const DB_VERSION = 1;

const POSContext = createContext(null);

export const POSProvider = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTabState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'dashboard';
  });

  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState({}, '', url.toString());
    } catch (_) {}
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setActiveTabState(params.get('tab') || 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('gastroflow_theme') === 'dark');
  const [currentUser, setCurrentUser] = useState(() => restoreStaffSession(localStorage));
  const [sessionChecking, setSessionChecking] = useState(() => Boolean(localStorage.getItem('gastroflow_token')));
  // Do not erase a valid session merely because a bookmarked tenant URL is stale:
  // use the server-authenticated user as the authority and update the URL after validation.
  const [activeShift, setActiveShift] = useState(null);
  const [tenantLock, setTenantLock] = useState(null); // null | { status: 'suspended' | 'deleted', storeId?: string, storeName?: string, message?: string }

  // Listen for auth/tenant errors dispatched by API calls
  useEffect(() => {
    const handleGlobalAuthError = (e) => {
      const { status, data } = e.detail || {};
      if (status === 403 && data) {
        if (data.code === 'TENANT_SUSPENDED' || (data.error && data.error.toLowerCase().includes('suspended'))) {
          setTenantLock({
            status: 'suspended',
            storeId: currentUser?.tenant_id,
            message: data.error || 'This restaurant store has been suspended.'
          });
        } else if (data.code === 'TENANT_DELETED' || (data.error && (data.error.toLowerCase().includes('deleted') || data.error.toLowerCase().includes('no longer exists')))) {
          setTenantLock({
            status: 'deleted',
            storeId: currentUser?.tenant_id,
            message: data.error || 'This restaurant store has been deleted.'
          });
        }
      }
    };
    window.addEventListener('gastroflow_auth_error', handleGlobalAuthError);
    return () => window.removeEventListener('gastroflow_auth_error', handleGlobalAuthError);
  }, [currentUser]);

  // Restore a saved login before starting shift/status fetches. A network outage or
  // a 403 permission/billing response cannot delete the local employee session.
  useEffect(() => {
    const token = localStorage.getItem('gastroflow_token');
    if (!token) { setSessionChecking(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const urlParams = new URLSearchParams(window.location.search);
    const selectedTenant = urlParams.get('tenant') || urlParams.get('tenantId');
    fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(selectedTenant ? { 'X-Expected-Tenant-Id': selectedTenant } : {})
      },
      signal: controller.signal
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (cancelled || localStorage.getItem('gastroflow_token') !== token) return;
        if (response.ok && data.user) {
          setCurrentUser(data.user);
          localStorage.setItem('gastroflow_user', JSON.stringify(data.user));
          // Only canonicalize an unscoped POS URL. Never overwrite the
          // requested restaurant link to silently admit another store's user.
          if (!selectedTenant && data.user.tenant_id) {
            try {
              const url = new URL(window.location.href);
              url.searchParams.set('tenant', data.user.tenant_id);
              window.history.replaceState({}, '', url.toString());
            } catch (_) {}
          }
        } else if (data.code === 'TENANT_URL_MISMATCH' || isExpiredStaffSession(response.status, data)) {
          // A cached token for Restaurant B must not unlock Restaurant A's URL.
          localStorage.removeItem('gastroflow_token');
          localStorage.removeItem('gastroflow_user');
          setCurrentUser(null);
        }
      })
      .catch(() => { /* Offline/timeout: keep cached session; retry on next request. */ })
      .finally(() => { clearTimeout(timeout); if (!cancelled) setSessionChecking(false); });
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, []);

  // Database lists
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [settings, setSettings] = useState({});

  // Active POS state
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [cart, setCart] = useState([]);
  const [diningType, setDiningType] = useState('dine-in');
  const [discountType, setDiscountType] = useState('percent'); // 'percent' or 'flat'
  const [discountValue, setDiscountValue] = useState(0);
  const orderAttempt = useRef(null);
  const recalledOrder = useRef(null);
  const refundAttempt = useRef(null);

  // Toast system
  const [toasts, setToasts] = useState([]);
  const [platformBroadcast, setPlatformBroadcast] = useState(null);

  // Load any active platform announcement on boot
  useEffect(() => {
    fetch('/api/public/platform/broadcast')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.message) setPlatformBroadcast(data);
      })
      .catch(() => {});
  }, []);

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Initialize and load data
  const loadAllData = async (isInitial = false) => {
    // Check tenant existence and status upfront - URL parameter takes precedence over saved session
    const params = new URLSearchParams(window.location.search);
    const urlTenant = params.get('tenant') || params.get('tenantId');
    const targetTenant = urlTenant || currentUser?.tenant_id || 'default_tenant';

    // Verify tenant on initial load if an explicit store is in the URL or user belongs to a specific tenant
    if (isInitial && (urlTenant || (currentUser && currentUser.tenant_id !== 'default_tenant'))) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const statusRes = await fetch(`/api/public/tenant/status?tenant=${encodeURIComponent(targetTenant)}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const contentType = statusRes.headers.get('content-type') || '';
        const statusData = contentType.includes('application/json') ? await statusRes.json().catch(() => ({})) : {};
        if (statusRes.status === 404 || statusData.exists === false) {
          setTenantLock({
            status: 'deleted',
            storeId: targetTenant,
            message: `The restaurant store "${targetTenant}" was not found or does not exist on this platform.`
          });
          setLoading(false);
          return;
        } else if (statusData.status === 'suspended') {
          setTenantLock({
            status: 'suspended',
            storeId: targetTenant,
            storeName: statusData.name,
            message: `The restaurant store "${statusData.name || targetTenant}" is currently suspended by the platform administrator.`
          });
          setLoading(false);
          return;
        } else if (statusData.status === 'active') {
          setTenantLock(null);
        }
      } catch (_) {}
    }

    if (!localStorage.getItem('gastroflow_token')) {
      setLoading(false);
      return;
    }
    try {
      if (isInitial) setLoading(true);

      const [loadedSettings, loadedCats, loadedItems, loadedTables, loadedOrders, loadedCustomers] = await Promise.all([
        db.getAll('settings'),
        db.getAll('categories'),
        db.getAll('menu_items'),
        db.getAll('tables'),
        db.getAll('orders'),
        db.getAll('customers'),
      ]);

      // Convert settings array or object to object
      if (loadedSettings) {
        const settingsObj = {};
        if (Array.isArray(loadedSettings)) {
          loadedSettings.forEach((item) => {
            if (item && item.key !== undefined) settingsObj[item.key] = item.value;
          });
        } else if (typeof loadedSettings === 'object') {
          Object.assign(settingsObj, loadedSettings);
        }
        setSettings(prev => {
          const prevKeys = Object.keys(prev || {});
          const newKeys = Object.keys(settingsObj || {});
          if (prevKeys.length === newKeys.length && prevKeys.every(k => prev[k] === settingsObj[k])) {
            return prev;
          }
          return settingsObj;
        });
      }

      // Safe state updates: NEVER overwrite existing loaded data with empty arrays if a fetch returned null/error
      if (Array.isArray(loadedCats)) setCategories(loadedCats);
      if (Array.isArray(loadedItems)) setMenuItems(loadedItems);
      if (Array.isArray(loadedTables)) setTables(loadedTables);
      if (Array.isArray(loadedOrders)) setOrders(loadedOrders);
      if (Array.isArray(loadedCustomers)) setCustomers(loadedCustomers);
    } catch (error) {
      console.error('Failed to load database contents:', error);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  // Fast targeted refresh helpers to avoid firing 6 parallel requests
  const refreshOrders = async () => {
    try {
      const freshOrders = await db.getAll('orders');
      if (Array.isArray(freshOrders)) setOrders(freshOrders);
    } catch (_) {}
  };

  const refreshTables = async () => {
    try {
      const freshTables = await db.getAll('tables');
      if (Array.isArray(freshTables)) setTables(freshTables);
    } catch (_) {}
  };

  // Helper to handle API authentication errors gracefully
  const handleAuthResponse = async (response) => {
    if (response.status === 401 || response.status === 403) {
      let errMessage = '';
      let errCode = '';
      try {
        const errJson = await response.clone().json();
        errMessage = errJson.error || errJson.message || '';
        errCode = errJson.code || '';
      } catch (_) {}

      if (errCode === 'TENANT_SUSPENDED' || errMessage.toLowerCase().includes('suspended')) {
        setTenantLock({
          status: 'suspended',
          storeId: currentUser?.tenant_id,
          message: errMessage || 'This restaurant store has been suspended.'
        });
        throw new Error(errMessage || 'Store suspended.');
      }

      if (errCode === 'TENANT_DELETED' || errMessage.toLowerCase().includes('deleted') || errMessage.toLowerCase().includes('no longer exists')) {
        setTenantLock({
          status: 'deleted',
          storeId: currentUser?.tenant_id,
          message: errMessage || 'This restaurant store has been deleted.'
        });
        throw new Error(errMessage || 'Store deleted.');
      }
      
      if (isExpiredStaffSession(response.status, { error: errMessage, code: errCode })) {
        logout();
        showToast('Your session expired — please sign in again.', 'error');
      }
      throw new Error(errMessage || 'This action is not available for your account.');
    }
    return response;
  };

  const getActiveShift = async () => {
    const token = localStorage.getItem('gastroflow_token');
    if (!token) return;
    try {
      const response = await fetch('/api/shifts/active', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401 || response.status === 403) {
        const error = await response.json().catch(() => ({}));
        if (isExpiredStaffSession(response.status, error) && localStorage.getItem('gastroflow_token') === token) {
          logout();
          showToast('Your session expired — please sign in again.', 'error');
        }
        return;
      }
      if (response.ok) {
        const data = await response.json();
        setActiveShift(data || null);
      }
    } catch (err) {
      console.error('Failed to get active shift:', err);
    }
  };

  // High-Professional Multi-Tone Commercial POS Order Ringtone (UberEats/Toast Style)
  const playNewOrderChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // Professional 4-Note Acoustic Harmonic Bell Pattern (E5 -> G#5 -> B5 -> E6)
      const notes = [
        { freq: 659.25, time: 0, duration: 0.18 },   // E5
        { freq: 830.61, time: 0.15, duration: 0.18 },  // G#5
        { freq: 987.77, time: 0.30, duration: 0.22 },  // B5
        { freq: 1318.51, time: 0.48, duration: 0.40 }  // E6
      ];

      // Play 2 cycles for high visibility in loud environment
      [0, 0.9].forEach((cycleOffset) => {
        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle'; // Warm commercial bell timbre
          osc.frequency.setValueAtTime(freq, ctx.currentTime + cycleOffset + time);

          // Acoustic bell envelope
          gain.gain.setValueAtTime(0.001, ctx.currentTime + cycleOffset + time);
          gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + cycleOffset + time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cycleOffset + time + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + cycleOffset + time);
          osc.stop(ctx.currentTime + cycleOffset + time + duration);
        });
      });
    } catch (e) {
      console.warn('Ringtone audio chime error:', e);
    }
  };

  useEffect(() => {
    if (sessionChecking || !currentUser) return;
    loadAllData(true);
    getActiveShift();

    if (!currentUser) return;

    // 45-second passive background heartbeat: only poll orders if SSE misses anything, avoiding heavy 6-table storms
    const interval = setInterval(() => {
      refreshOrders().catch(() => {});
    }, 45000);

    // Live EventSource Stream for instant online order & tenant status alerts
    let es;
    try {
      const posStreamUrl = new URL('/api/stream/pos', window.location.origin);
      // EventSource can't set an Authorization header, so pass the JWT as a query
      // param. The server verifies it and tenant-partitions the stream.
      const posToken = localStorage.getItem('gastroflow_token');
      if (posToken) posStreamUrl.searchParams.set('token', posToken);
      es = new EventSource(posStreamUrl.href);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'new_online_order') {
            playNewOrderChime();
            if (data.order && data.order.id) {
              setOrders(prev => [data.order, ...prev.filter(o => o.id !== data.order.id)]);
              if (data.order.tableId) refreshTables().catch(() => {});
            } else {
              refreshOrders().catch(() => {});
            }
          } else if (data.type === 'order_updated') {
            if (data.order && data.order.id) {
              setOrders(prev => {
                const idx = prev.findIndex(o => o.id === data.order.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...data.order };
                  return copy;
                }
                return [data.order, ...prev];
              });
              if (data.order.tableId) refreshTables().catch(() => {});
            } else {
              refreshOrders().catch(() => {});
            }
          } else if (data.type === 'customer_registered') {
            db.getAll('customers').then(c => Array.isArray(c) && setCustomers(c)).catch(() => {});
          } else if (data.type === 'tenant_status_changed') {
            const currentTid = currentUser?.tenant_id || new URLSearchParams(window.location.search).get('tenant') || 'default_tenant';
            if (data.tenantId === currentTid || (currentTid === 'kb2c' && data.tenantId === 'tenant_kb2c')) {
              if (data.status === 'suspended' && currentUser?.isPlatformAdmin !== true) {
                setTenantLock({
                  status: 'suspended',
                  storeId: data.tenantId,
                  storeName: data.storeName,
                  message: 'This restaurant store has just been suspended by the platform administrator.'
                });
              } else if (data.status === 'active') {
                setTenantLock(null);
                loadAllData(false);
              }
            }
          } else if (data.type === 'tenant_deleted') {
            const currentTid = currentUser?.tenant_id || new URLSearchParams(window.location.search).get('tenant') || 'default_tenant';
            if (data.tenantId === currentTid || (currentTid === 'kb2c' && data.tenantId === 'tenant_kb2c')) {
              setTenantLock({
                status: 'deleted',
                storeId: data.tenantId,
                storeName: data.storeName,
                message: 'This restaurant store has been permanently removed by the platform administrator.'
              });
            }
          } else if (data.type === 'platform_broadcast') {
            setPlatformBroadcast({
              message: data.message,
              type: data.broadcastType || 'info',
              expiresAt: data.expiresAt
            });
          }
        } catch (e) {}
      };
    } catch (e) {}

    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, [currentUser, sessionChecking]);

  const acceptOnlineOrder = async (orderId, etaMinutes = 20) => {
    const res = await fetch(`/api/orders/${orderId}/accept`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ etaMinutes })
    });
    await handleAuthResponse(res);
    if (!res.ok) throw new Error('Failed to accept order');
    await loadAllData(false);
  };

  const updateOrderEta = async (orderId, etaMinutes) => {
    try {
      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
      const res = await fetch(`/api/orders/${orderId}/eta`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ etaMinutes: parseInt(etaMinutes, 10) || 20 })
      });
      await handleAuthResponse(res);
      if (!res.ok) throw new Error('Failed to update order ETA');
      showToast(`⏱️ Order #${orderId.slice(-4).toUpperCase()} ETA updated to ~${etaMinutes} mins`, 'success');
      await loadAllData(false);
    } catch (err) {
      showToast('ETA update error: ' + err.message, 'error');
    }
  };

  const rejectOnlineOrder = async (orderId, reason = 'Kitchen unavailable at this time') => {
    const res = await fetch(`/api/orders/${orderId}/reject`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ reason })
    });
    await handleAuthResponse(res);
    if (!res.ok) throw new Error('Failed to reject order');
    await loadAllData(false);
  };

  // Auth Operations
  const login = async (username, password) => {
    const url = new URL(window.location.href);
    const expectedTenantId = url.searchParams.get('tenant') || url.searchParams.get('tenantId');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, ...(expectedTenantId ? { expectedTenantId } : {}) })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (err.code === 'TENANT_SUSPENDED' || (err.error && err.error.toLowerCase().includes('suspended'))) {
        setTenantLock({
          status: 'suspended',
          message: err.error
        });
      } else if (err.code === 'TENANT_DELETED' || (err.error && (err.error.toLowerCase().includes('deleted') || err.error.toLowerCase().includes('no longer exists')))) {
        setTenantLock({
          status: 'deleted',
          message: err.error
        });
      }
      throw new Error(err.error || 'Login failed');
    }
    const data = await response.json();
    localStorage.setItem('gastroflow_token', data.token);
    localStorage.setItem('gastroflow_user', JSON.stringify(data.user));

    // A tenant-specific POS URL is authoritative. The server already
    // verified it matches the staff account; redirect only on generic URLs.
    if (!expectedTenantId && data.user?.tenant_id) {
      url.searchParams.set('tenant', data.user.tenant_id);
      window.history.replaceState({}, '', url.toString());
    }

    setTenantLock(null);
    setSessionChecking(false);
    setCurrentUser(data.user);
    // Open the dedicated platform workspace for the single designated owner only.
    if (data.user?.isPlatformAdmin === true) setActiveTab('platform');
  };

  const logout = () => {
    localStorage.removeItem('gastroflow_token');
    localStorage.removeItem('gastroflow_user');
    setSessionChecking(false);
    setCurrentUser(null);
  };

  // Verify PIN for overrides
  const verifyManagerPin = async (pin) => {
    const response = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ pin })
    });
    await handleAuthResponse(response);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Invalid PIN');
    }
    return await response.json();
  };

  const openShift = async (startFloat, notes) => {
    const response = await fetch('/api/shifts/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ startFloat, notes })
    });
    await handleAuthResponse(response);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to open shift');
    }
    await getActiveShift();
  };

  const closeShift = async (actualCash, notes) => {
    const response = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ actualCash, notes })
    });
    await handleAuthResponse(response);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to close shift');
    }
    const data = await response.json();
    setActiveShift(null);
    return data;
  };

  const recordCashMovement = async (type, amount, reason) => {
    const response = await fetch('/api/cash-movements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ type, amount, reason })
    });
    await handleAuthResponse(response);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to record cash movement');
    }
    return await response.json();
  };

  const refundOrder = async (orderId, refundAmount, reason, managerPin) => {
    const key = JSON.stringify({ orderId, refundAmount, reason });
    if (refundAttempt.current?.key !== key) refundAttempt.current = { key, id: crypto.randomUUID() };
    const refundId = refundAttempt.current.id;
    const response = await fetch(`/api/orders/${orderId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ refundAmount, reason, managerPin, refundId })
    });
    await handleAuthResponse(response);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to refund order');
    }
    if (refundAttempt.current?.id === refundId) refundAttempt.current = null;
    await loadAllData();
  };

  // Theme Toggler
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('gastroflow_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Settings Actions
  const updateSetting = async (key, value) => {
    const expectedTenantId = currentUser?.tenant_id;
    if (!expectedTenantId) throw new Error('Restaurant session unavailable. Please sign in again.');
    // The server checks expectedTenantId against the authenticated token. Never
    // allow an owner action to silently edit the wrong restaurant.
    const saved = await db.put('settings', { key, value, expectedTenantId });
    if (saved?.tenantId !== expectedTenantId) {
      throw new Error('Restaurant mismatch: setting not confirmed. Refresh your account.');
    }
    setSettings(prev => ({ ...prev, [key]: value }));
    return saved;
  };

  // Category CRUD
  const saveCategory = async (cat) => {
    await db.put('categories', cat);
    setCategories((prev) => {
      const idx = prev.findIndex((c) => c.id === cat.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = cat;
        return next;
      }
      return [...prev, cat];
    });
  };

  const deleteCategory = async (catId) => {
    await db.delete('categories', catId);
    setCategories((prev) => prev.filter((c) => c.id !== catId));
  };

  // Menu Items CRUD
  const saveMenuItem = async (item) => {
    const saved = await db.put('menu_items', item);
    const resolved = { ...item, ...(saved && typeof saved === 'object' ? saved : {}) };
    setMenuItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = resolved;
        return next;
      }
      return [...prev, resolved];
    });
    loadAllData(false);
  };

  const deleteMenuItem = async (itemId) => {
    await db.delete('menu_items', itemId);
    setMenuItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const clearAllMenuItems = async () => {
    const token = localStorage.getItem('gastroflow_token');
    const res = await fetch('/api/menu_items/clear-all', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to clear menu items from database');
    }
    setMenuItems([]);
  };

  const clearAllCategories = async () => {
    const token = localStorage.getItem('gastroflow_token');
    const res = await fetch('/api/categories/clear-all', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to clear categories from database');
    }
    setCategories([]);
  };

  // Tables CRUD
  const saveTable = async (table) => {
    await db.put('tables', table);
    setTables((prev) => {
      const idx = prev.findIndex((t) => t.id === table.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = table;
        return next;
      }
      return [...prev, table];
    });
  };

  const deleteTable = async (tableId) => {
    await db.delete('tables', tableId);
    setTables((prev) => prev.filter((t) => t.id !== tableId));
  };

  // Customers CRUD
  const saveCustomer = async (cust) => {
    await db.put('customers', cust);
    setCustomers((prev) => {
      const idx = prev.findIndex((c) => c.id === cust.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = cust;
        return next;
      }
      return [...prev, cust];
    });
  };

  // Cart Management
  const addToCart = (item, quantity = 1, notes = '', modifiers = []) => {
    setCart((prevCart) => {
      // Find item with same ID and notes/modifiers
      const existingIndex = prevCart.findIndex(
        (c) =>
          c.id === item.id &&
          c.notes === notes &&
          JSON.stringify(c.modifiers) === JSON.stringify(modifiers) &&
          c.customUnitPrice == null
      );

      if (existingIndex > -1) {
        // Immutably update quantity — avoid mutating the original object via shallow copy
        return prevCart.map((cartItem, idx) =>
          idx === existingIndex
            ? { ...cartItem, quantity: cartItem.quantity + quantity }
            : cartItem
        );
      }

      return [...prevCart, { ...item, quantity, notes, modifiers }];
    });
  };

  const updateCartQuantity = (cartItemIndex, newQuantity) => {
    if (newQuantity <= 0) {
      setCart((prev) => prev.filter((_, idx) => idx !== cartItemIndex));
      return;
    }
    // Immutably update — shallow array copy still shared the object reference
    setCart((prev) =>
      prev.map((item, idx) =>
        idx === cartItemIndex ? { ...item, quantity: newQuantity } : item
      )
    );
  };

  const updateCartUnitPrice = (cartItemIndex, price) => {
    if (!['owner', 'manager'].includes(currentUser?.role)) throw new Error('Only an owner or manager can set a custom price.');
    // Null restores the original catalog price for this line without editing the menu.
    if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
      price > 10000000 || Math.abs(Math.round(price * 100) - price * 100) > 1e-6)) {
      throw new Error('Enter a positive price with no more than two decimal places.');
    }
    setCart(previous => previous.map((line, index) => {
      if (index !== cartItemIndex) return line;
      const baseItem = menuItems.find(item => item.id === line.id);
      const basePrice = Number(baseItem?.price ?? line.menuPrice ?? line.price);
      const modifiersTotal = (line.modifiers || line.selectedModifiers || []).reduce((sum, mod) => sum + Number(mod.priceDelta || 0), 0);
      const normalUnitPrice = Math.round((basePrice + modifiersTotal) * 100) / 100;
      const custom = price === null ? null : price;
      return { ...line, menuPrice: basePrice, unitPrice: custom ?? normalUnitPrice,
        ...(custom === null ? { customUnitPrice: null } : { customUnitPrice: custom }) };
    }));
  };

  const updateCartNotes = (cartItemIndex, notes) => {
    // Immutably update notes — avoid direct object mutation on shallow copy
    setCart((prev) =>
      prev.map((item, idx) =>
        idx === cartItemIndex ? { ...item, notes } : item
      )
    );
  };

  const removeFromCart = (cartItemIndex) => {
    setCart((prev) => prev.filter((_, idx) => idx !== cartItemIndex));
  };

  const clearCart = () => {
    orderAttempt.current = null;
    recalledOrder.current = null;
    setCart([]);
    setDiscountValue(0);
    // selectedCustomer is intentionally preserved so consecutive orders for the same
    // customer (loyalty workflows, repeat table service) don't require re-selection.
    // Call setSelectedCustomer(null) explicitly when you need a hard reset.
  };

  // Reset POS view states when shifting tables
  const loadOrderToPOS = (order) => {
    recalledOrder.current = order.id;
    setCart(order.items || []);
    setDiningType(order.diningType || 'dine-in');
    setDiscountType(order.discountType || 'percent');
    setDiscountValue(order.discountValue || 0);
    const tbl = tables.find((t) => t.id === order.tableId);
    setSelectedTable(tbl || null);
    const cust = customers.find((c) => c.id === order.customerId);
    setSelectedCustomer(cust || null);
  };

  // Calculate Subtotal, Tax, Discount, and Total
  const getCartTotals = (tipVal = 0, deliveryFeeVal = 0) => {
    const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const subtotal = cart.reduce((acc, item) => acc + (item.unitPrice ?? (Number(item.price) + (item.modifiers || item.selectedModifiers || []).reduce((sum, mod) => sum + Number(mod.priceDelta || 0), 0))) * item.quantity, 0);
    
    let discount = 0;
    if (discountType === 'percent') {
      discount = (subtotal * discountValue) / 100;
    } else {
      discount = discountValue;
    }
    discount = money(Math.max(0, Math.min(discount, subtotal)));

    const serviceChargeRate = parseFloat(settings.serviceChargeRate || 0);
    const serviceCharge = money(((subtotal - discount) * serviceChargeRate) / 100);

    const taxRate = parseFloat(settings.taxRate || 0);
    const tax = money(((subtotal - discount + serviceCharge) * taxRate) / 100);

    const deliveryFee = diningType === 'delivery' ? parseFloat(deliveryFeeVal || 0) : 0;

    const rawTotal = money(subtotal - discount + serviceCharge + tax + money(Number(tipVal || 0)) + money(deliveryFee));
    const total = Math.round(rawTotal);
    const roundedAmount = total - rawTotal;

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      discount: parseFloat(discount.toFixed(2)),
      serviceCharge: parseFloat(serviceCharge.toFixed(2)),
      tax: parseFloat(tax.toFixed(2)),
      deliveryFee: parseFloat(deliveryFee.toFixed(2)),
      tip: money(Number(tipVal || 0)),
      roundedAmount: parseFloat(roundedAmount.toFixed(2)),
      total: total,
    };
  };

  // Place Order / Create Ticket (KOT)
  const placeOrder = async (isHold = false, tipVal = 0, splitDetails = null, extraOrderData = {}, skipReload = false) => {
    if (cart.length === 0) return null;

    const orderId = `ord_${Date.now()}`;
    
    const newOrder = {
      id: orderId,
      tableId: diningType === 'dine-in' && selectedTable ? selectedTable.id : null,
      diningType,
      customerId: selectedCustomer ? selectedCustomer.id : null,
      customerName: selectedCustomer ? selectedCustomer.name : (extraOrderData.customerName || null),
      customerPhone: selectedCustomer ? selectedCustomer.phone : (extraOrderData.customerPhone || null),
      deliveryAddress: extraOrderData.deliveryAddress || (selectedCustomer ? selectedCustomer.address : null),
      deliveryFee: extraOrderData.deliveryFee || 0,
      items: cart.map(item => ({
        id: item.id, quantity: item.quantity, notes: item.notes || '',
        selectedModifiers: item.modifiers || item.selectedModifiers || [],
        ...(item.customUnitPrice != null ? { customUnitPrice: item.customUnitPrice } : {})
      })),
      discountType,
      discountValue,
      status: isHold ? 'hold' : 'pending',
      timestamp: Date.now(),
      paymentMethod: null,
      tip: tipVal,
      paymentSplit: splitDetails,
      ...extraOrderData
    };

    // Reuse an intent identifier after an interrupted create/settle request.
    const intentKey = JSON.stringify({ ...newOrder, id: null, timestamp: null });
    if (orderAttempt.current?.key === intentKey) newOrder.id = orderAttempt.current.id;
    else { newOrder.id = `ord_${crypto.randomUUID()}`; orderAttempt.current = { key: intentKey, id: newOrder.id }; }
    let savedOrder;
    if (recalledOrder.current) {
      const id = recalledOrder.current;
      const response = await fetch(`/api/orders/${id}/modify`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + localStorage.getItem('gastroflow_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newOrder)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Cannot modify saved bill.');
      savedOrder = result.order || result;
    } else {
      savedOrder = await db.put('orders', newOrder);
    }
    
    // Immediately reflect new/modified order in state with zero delay
    const finalOrder = { ...newOrder, ...savedOrder };
    if (finalOrder && finalOrder.id) {
      setOrders(prev => {
        const idx = prev.findIndex(o => o.id === finalOrder.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = finalOrder;
          return updated;
        }
        return [finalOrder, ...prev];
      });
    }

    // Targeted table sync if dine-in, without firing a full 6-table database reload
    if (!skipReload && diningType === 'dine-in') {
      refreshTables().catch(() => {});
    }

    if (isHold) {
      clearCart();
      setSelectedTable(null);
    }
    return finalOrder;
  };

  // Update order status (KDS view or checkout)
  const updateOrderStatus = async (orderId, status) => {
    // Optimistic UI update so KDS and POS respond with zero delay
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    const existingOrder = orders.find((o) => o.id === orderId) || {};
    await db.put('orders', { ...existingOrder, id: orderId, status });
  };

  // Complete Payment
  const completePayment = async (orderId, paymentMethod, tipVal = 0, splitDetails = null) => {
    // Send paid status and payment details to server; the response carries the
    // server-assigned fiscal invoice number allocated at settlement.
    const result = await db.put('orders', {
      id: orderId,
      status: 'paid',
      paymentMethod,
      paymentTimestamp: Date.now(),
      paymentSplit: splitDetails,
      tip: tipVal
    });

    // Update order in state immediately so the settlement reflects with zero delay
    if (result && result.id) {
      setOrders(prev => {
        const idx = prev.findIndex(o => o.id === result.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...result, status: 'paid', paymentStatus: 'paid' };
          return updated;
        }
        return [result, ...prev];
      });
    }

    // Refresh tables in background if dine-in table was freed, without triggering a full 6-table database reload
    refreshTables().catch(() => {});
    return result;
  };

  // Backup and Restore Database
  const exportDatabase = async () => {
    const [dbSettings, dbCategories, dbMenuItems, dbTables, dbOrders, dbCustomers] = await Promise.all([
      db.getAll('settings'),
      db.getAll('categories'),
      db.getAll('menu_items'),
      db.getAll('tables'),
      db.getAll('orders'),
      db.getAll('customers'),
    ]);

    const backupData = {
      version: DB_VERSION,
      exportTime: Date.now(),
      settings: dbSettings,
      categories: dbCategories,
      menu_items: dbMenuItems,
      tables: dbTables,
      orders: dbOrders,
      customers: dbCustomers,
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GastroFlow_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importDatabase = async (jsonString) => {
    try {
      const backupData = JSON.parse(jsonString);
      
      // Basic validation
      if (!backupData.categories || !backupData.menu_items || !backupData.settings) {
        throw new Error('Invalid backup file structure.');
      }

      setLoading(true);

      // Reset the database with a single server call.
      // Previously this called db.clear() 6 times which each triggered a full
      // /api/database/reset — 6 wipes instead of 1. Now done exactly once.
      const resetToken = localStorage.getItem('gastroflow_token');
      await fetch('/api/database/reset', {
        method: 'POST',
        headers: resetToken ? { Authorization: `Bearer ${resetToken}` } : {}
      }).catch(() => {});

      // Bulk write from backup
      if (backupData.settings) await db.bulkPut('settings', backupData.settings);
      if (backupData.categories) await db.bulkPut('categories', backupData.categories);
      if (backupData.menu_items) await db.bulkPut('menu_items', backupData.menu_items);
      if (backupData.tables) await db.bulkPut('tables', backupData.tables);
      if (backupData.orders) await db.bulkPut('orders', backupData.orders);
      if (backupData.customers) await db.bulkPut('customers', backupData.customers);

      // Reload
      await loadAllData();
      return { success: true };
    } catch (error) {
      console.error('Failed to import backup:', error);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const resetStoreTestData = async (options = { wipeOrders: true, wipeExpenses: true, wipeMenu: false, wipeCategories: false }) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/tenant/reset-test-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(options)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to reset store test data');
      await loadAllData();
      return data;
    } finally {
      setLoading(false);
    }
  };

  const resetAllDatabase = async () => {
    return resetStoreTestData({ wipeOrders: true, wipeExpenses: true, wipeMenu: true, wipeCategories: false });
  };

  return (
    <POSContext.Provider
      value={{
        loading,
        sessionChecking,
        activeTab,
        setActiveTab,
        darkMode,
        setDarkMode,
        
        // Data states
        menuItems,
        categories,
        tables,
        orders,
        customers,
        settings,

        // Settings Actions
        updateSetting,

        // CRUD utilities
        saveCategory,
        deleteCategory,
        clearAllCategories,
        saveMenuItem,
        deleteMenuItem,
        clearAllMenuItems,
        saveTable,
        deleteTable,
        saveCustomer,

        // Auth & Tenant State
        currentUser,
        tenantLock,
        setTenantLock,
        login,
        logout,
        verifyManagerPin,
        activeShift,
        openShift,
        closeShift,
        recordCashMovement,
        refundOrder,
        loadAllData,
        refreshOrders,
        refreshTables,

        // Cart Actions
        cart,
        addToCart,
        updateCartQuantity,
        updateCartUnitPrice,
        updateCartNotes,
        removeFromCart,
        clearCart,
        getCartTotals,
        loadOrderToPOS,

        // POS selection states
        selectedTable,
        setSelectedTable,
        selectedCustomer,
        setSelectedCustomer,
        diningType,
        setDiningType,
        discountType,
        setDiscountType,
        discountValue,
        setDiscountValue,

        // Transactions & Order Actions
        placeOrder,
        updateOrderStatus,
        completePayment,
        acceptOnlineOrder,
        rejectOnlineOrder,
        updateOrderEta,

        // Backup & Reset
        exportDatabase,
        importDatabase,
        resetAllDatabase,
        resetStoreTestData,

        // Toast & Audio Ringer
        showToast,
        playNewOrderChime,
        platformBroadcast,
        setPlatformBroadcast,
      }}
    >
      {children}
      {/* Toast Overlay */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: t.type === 'error' ? 'var(--color-danger, #ef4444)' : t.type === 'success' ? 'var(--color-success, #22c55e)' : 'var(--accent, #2d3250)',
              color: '#fff',
              padding: '12px 18px',
              borderRadius: '10px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              fontSize: '13px',
              fontWeight: '600',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </POSContext.Provider>
  );
};

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error('usePOS must be used within a POSProvider');
  }
  return context;
};
