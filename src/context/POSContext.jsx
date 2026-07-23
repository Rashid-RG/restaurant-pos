import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, seedDatabase } from '../database/db';

const POSContext = createContext(null);

export const POSProvider = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('gastroflow_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeShift, setActiveShift] = useState(null);

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

  // Toast system
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Initialize and load data
  const loadAllData = async (isInitial = false) => {
    if (!localStorage.getItem('gastroflow_token')) {
      setLoading(false);
      return;
    }
    try {
      if (isInitial) setLoading(true);
      await seedDatabase();

      const [loadedSettings, loadedCats, loadedItems, loadedTables, loadedOrders, loadedCustomers] = await Promise.all([
        db.getAll('settings'),
        db.getAll('categories'),
        db.getAll('menu_items'),
        db.getAll('tables'),
        db.getAll('orders'),
        db.getAll('customers'),
      ]);

      // Convert settings array to object
      const settingsObj = {};
      loadedSettings.forEach((item) => {
        settingsObj[item.key] = item.value;
      });

      setSettings(settingsObj);
      setCategories(loadedCats);
      setMenuItems(loadedItems);
      setTables(loadedTables);
      setOrders(loadedOrders);
      setCustomers(loadedCustomers);
    } catch (error) {
      console.error('Failed to load database contents:', error);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  const getActiveShift = async () => {
    if (!localStorage.getItem('gastroflow_token')) return;
    try {
      const response = await fetch('/api/shifts/active', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setActiveShift(data || null);
      }
    } catch (err) {
      console.error('Failed to get active shift:', err);
    }
  };

  const playNewOrderChime = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  };

  useEffect(() => {
    loadAllData(true);
    getActiveShift();

    if (!currentUser) return;

    // 8-second auto refresh fallback for POS
    const interval = setInterval(() => {
      loadAllData(false);
    }, 8000);

    // Live EventSource Stream for instant online order alerts
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
            loadAllData(false);
          } else if (data.type === 'order_updated') {
            loadAllData(false);
          }
        } catch (e) {}
      };
    } catch (e) {}

    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, [currentUser]);

  const acceptOnlineOrder = async (orderId, etaMinutes = 20) => {
    const res = await fetch(`/api/orders/${orderId}/accept`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ etaMinutes })
    });
    if (!res.ok) throw new Error('Failed to accept order');
    await loadAllData(false);
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
    if (!res.ok) throw new Error('Failed to reject order');
    await loadAllData(false);
  };

  // Auth Operations
  const login = async (username, password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Login failed');
    }
    const data = await response.json();
    localStorage.setItem('gastroflow_token', data.token);
    localStorage.setItem('gastroflow_user', JSON.stringify(data.user));
    setCurrentUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('gastroflow_token');
    localStorage.removeItem('gastroflow_user');
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
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to record cash movement');
    }
    return await response.json();
  };

  const refundOrder = async (orderId, refundAmount, reason, managerPin) => {
    const response = await fetch(`/api/orders/${orderId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
      },
      body: JSON.stringify({ refundAmount, reason, managerPin })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to refund order');
    }
    await loadAllData();
  };

  // Theme Toggler
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Settings Actions
  const updateSetting = async (key, value) => {
    await db.put('settings', { key, value });
    setSettings((prev) => ({ ...prev, [key]: value }));
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
    await db.put('menu_items', item);
    setMenuItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  };

  const deleteMenuItem = async (itemId) => {
    await db.delete('menu_items', itemId);
    setMenuItems((prev) => prev.filter((i) => i.id !== itemId));
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
          JSON.stringify(c.modifiers) === JSON.stringify(modifiers)
      );

      if (existingIndex > -1) {
        const nextCart = [...prevCart];
        nextCart[existingIndex].quantity += quantity;
        return nextCart;
      }

      return [...prevCart, { ...item, quantity, notes, modifiers }];
    });
  };

  const updateCartQuantity = (cartItemIndex, newQuantity) => {
    if (newQuantity <= 0) {
      setCart((prev) => prev.filter((_, idx) => idx !== cartItemIndex));
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      next[cartItemIndex].quantity = newQuantity;
      return next;
    });
  };

  const updateCartNotes = (cartItemIndex, notes) => {
    setCart((prev) => {
      const next = [...prev];
      next[cartItemIndex].notes = notes;
      return next;
    });
  };

  const removeFromCart = (cartItemIndex) => {
    setCart((prev) => prev.filter((_, idx) => idx !== cartItemIndex));
  };

  const clearCart = () => {
    setCart([]);
    setSelectedCustomer(null);
    setDiscountValue(0);
  };

  // Reset POS view states when shifting tables
  const loadOrderToPOS = (order) => {
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
  const getCartTotals = (tipVal = 0) => {
    const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
    
    let discount = 0;
    if (discountType === 'percent') {
      discount = (subtotal * discountValue) / 100;
    } else {
      discount = discountValue;
    }
    discount = Math.min(discount, subtotal);

    const serviceChargeRate = parseFloat(settings.serviceChargeRate || 0);
    const serviceCharge = ((subtotal - discount) * serviceChargeRate) / 100;

    const taxRate = parseFloat(settings.taxRate || 0);
    const tax = ((subtotal - discount + serviceCharge) * taxRate) / 100;

    const rawTotal = subtotal - discount + serviceCharge + tax + parseFloat(tipVal || 0);
    const total = Math.round(rawTotal);
    const roundedAmount = total - rawTotal;

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      discount: parseFloat(discount.toFixed(2)),
      serviceCharge: parseFloat(serviceCharge.toFixed(2)),
      tax: parseFloat(tax.toFixed(2)),
      tip: parseFloat((tipVal || 0).toFixed(2)),
      roundedAmount: parseFloat(roundedAmount.toFixed(2)),
      total: total,
    };
  };

  // Place Order / Create Ticket (KOT)
  const placeOrder = async (isHold = false, tipVal = 0, splitDetails = null) => {
    if (cart.length === 0) return null;

    const orderId = `ord_${Date.now()}`;
    
    const newOrder = {
      id: orderId,
      tableId: diningType === 'dine-in' && selectedTable ? selectedTable.id : null,
      diningType,
      customerId: selectedCustomer ? selectedCustomer.id : null,
      items: cart.map(item => ({ id: item.id, quantity: item.quantity, notes: item.notes || '' })),
      discountType,
      discountValue,
      status: isHold ? 'hold' : 'pending',
      timestamp: Date.now(),
      paymentMethod: null,
      tip: tipVal,
      paymentSplit: splitDetails
    };

    // Save order
    await db.put('orders', newOrder);
    
    // Reload database state to reflect stock and table status updates in the UI
    await loadAllData();

    clearCart();
    setSelectedTable(null);
    return newOrder;
  };

  // Update order status (KDS view or checkout)
  const updateOrderStatus = async (orderId, status) => {
    // Send status update to server
    await db.put('orders', { id: orderId, status });
    
    // Reload state (this will sync stock returns, table status, etc. in UI)
    await loadAllData();
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

    // Reload state (this will sync customer loyalty points, table statuses, etc.)
    await loadAllData();
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

      // Clear current stores
      await Promise.all([
        db.clear('settings'),
        db.clear('categories'),
        db.clear('menu_items'),
        db.clear('tables'),
        db.clear('orders'),
        db.clear('customers'),
      ]);

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

  const resetAllDatabase = async () => {
    setLoading(true);
    await Promise.all([
      db.clear('settings'),
      db.clear('categories'),
      db.clear('menu_items'),
      db.clear('tables'),
      db.clear('orders'),
      db.clear('customers'),
    ]);
    await loadAllData();
  };

  return (
    <POSContext.Provider
      value={{
        loading,
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
        saveMenuItem,
        deleteMenuItem,
        saveTable,
        deleteTable,
        saveCustomer,

        // Auth
        currentUser,
        login,
        logout,
        verifyManagerPin,
        activeShift,
        openShift,
        closeShift,
        recordCashMovement,
        refundOrder,
        loadAllData,

        // Cart Actions
        cart,
        addToCart,
        updateCartQuantity,
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

        // Backup
        exportDatabase,
        importDatabase,
        resetAllDatabase,

        // Toast
        showToast,
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
