import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function POSView() {
  const {
    menuItems,
    categories,
    tables,
    customers,
    settings,
    saveCustomer,
    // Cart actions
    cart,
    addToCart,
    updateCartQuantity,
    updateCartNotes,
    removeFromCart,
    clearCart,
    getCartTotals,
    // Selection states
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
    // Operations
    placeOrder,
    completePayment,
    orders,
    verifyManagerPin,
    activeShift,
    openShift,
    closeShift,
    recordCashMovement,
    refundOrder,
    loadAllData,
    showToast,
  } = usePOS();

  // Search/Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  // Modals visibility
  const [showTableModal, setShowTableModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomizerModal, setShowCustomizerModal] = useState(false);

  // Cash In / Cash Out (Paid-Out) Modal state
  const [showCashMoveModal, setShowCashMoveModal] = useState(false);
  const [cashMoveType, setCashMoveType] = useState('cash_out'); // 'cash_in' | 'cash_out'
  const [cashMoveAmount, setCashMoveAmount] = useState('');
  const [cashMoveReason, setCashMoveReason] = useState('');

  // PIN modal state
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccessCallback, setPinSuccessCallback] = useState(null);

  // Advanced Billing states
  const [tipInput, setTipInput] = useState(0);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMode, setSplitMode] = useState('even'); // 'even' | 'itemized'
  const [splitCount, setSplitCount] = useState(2);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [splitPayments, setSplitPayments] = useState([]);
  const [showShiftCloseModal, setShowShiftCloseModal] = useState(false);
  const [shiftReport, setShiftReport] = useState(null);

  const handleProtectedAction = (callback) => {
    setPinValue('');
    setPinError('');
    setPinSuccessCallback(() => callback);
    setShowPinModal(true);
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (!pinValue) return;

    try {
      setPinError('');
      const res = await verifyManagerPin(pinValue);
      if (res.success) {
        setShowPinModal(false);
        if (pinSuccessCallback) {
          pinSuccessCallback();
        }
      }
    } catch (err) {
      setPinError(err.message || 'Invalid or unauthorized PIN.');
    }
  };

  // Customizer state
  const [customizerItem, setCustomizerItem] = useState(null);
  const [customizerQty, setCustomizerQty] = useState(1);
  const [customizerNotes, setCustomizerNotes] = useState('');

  // Customer CRM quick add state
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [printReceiptOrder, setPrintReceiptOrder] = useState(null);
  const [lastPaidOrder, setLastPaidOrder] = useState(null);

  // Auto-scroll receipt printing
  useEffect(() => {
    if (printReceiptOrder) {
      const timer = setTimeout(() => {
        window.print();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [printReceiptOrder]);

  const currencySymbol = settings.currencySymbol || '$';

  // Filter items
  const filteredItems = menuItems.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const totals = getCartTotals(tipInput);

  // Open customizer modal for item
  const handleItemClick = (item) => {
    if (item.stock <= 0) return; // out of stock
    setCustomizerItem(item);
    setCustomizerQty(1);
    setCustomizerNotes('');
    setShowCustomizerModal(true);
  };

  const handleCustomizerSubmit = () => {
    if (customizerItem) {
      addToCart(customizerItem, customizerQty, customizerNotes);
      setShowCustomizerModal(false);
      setCustomizerItem(null);
    }
  };

  const handleQuickAddCustomer = async (e) => {
    e.preventDefault();
    if (!quickCustName || !quickCustPhone) return;

    const newCust = {
      id: `cust_${Date.now()}`,
      name: quickCustName,
      phone: quickCustPhone,
      email: '',
      points: 0,
      orderCount: 0,
      totalSpent: 0,
    };

    await saveCustomer(newCust);
    setSelectedCustomer(newCust);
    setQuickCustName('');
    setQuickCustPhone('');
  };

  const handlePlaceHoldOrder = async () => {
    if (cart.length === 0) return;
    const order = await placeOrder(true, tipInput); // hold status
    if (order) {
      showToast(`Order sent to Kitchen. Hold status for Table ${tables.find(t => t.id === order.tableId)?.number || 'Takeaway'}`, 'info');
    }
  };

  const handlePayClick = () => {
    if (cart.length === 0) return;
    setCashReceived(totals.total.toString());
    setShowPaymentModal(true);
  };

  // Poll the authoritative order status until it flips to paid (or a timeout elapses).
  // Returns the settled order (with its fiscal invoiceNumber) on success, else null.
  const pollOrderPaid = async (orderId, attempts = 10, intervalMs = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`/api/public/orders/${orderId}`);
        if (res.ok) {
          const order = await res.json();
          if (order && order.status === 'paid') return order;
        }
      } catch { /* keep polling */ }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
  };

  // Production: hand the browser off to PayHere via a standard form POST. PayHere then calls the
  // server notify_url server-to-server; this client never marks the order paid itself.
  const submitPayHereRedirect = (checkData) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = checkData.checkoutUrl;
    const params = {
      merchant_id: checkData.merchantId,
      return_url: window.location.origin,
      cancel_url: window.location.origin,
      notify_url: checkData.notifyUrl || '',
      order_id: checkData.orderId,
      items: 'GastroFlow POS Order',
      currency: checkData.currency || 'LKR',
      amount: Number(checkData.amount).toFixed(2),
      hash: checkData.signature
    };
    for (const [key, value] of Object.entries(params)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  };

  const handlePaymentComplete = async () => {
    const receiptItems = [...cart];
    const receiptTotals = { ...totals };

    if (paymentMethod === 'payhere') {
      try {
        const splitDetails = [{ method: 'payhere', amount: receiptTotals.total }];

        // 1. Create the real order first so the server prices it and can settle it authoritatively.
        const order = await placeOrder(false, tipInput, splitDetails);
        if (!order) return;

        // 2. Ask the server for signed checkout params for the REAL order total.
        const checkRes = await fetch('/api/payments/payhere/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}`
          },
          body: JSON.stringify({ orderId: order.id })
        });
        const checkData = await checkRes.json();
        if (!checkRes.ok) throw new Error(checkData.error || 'Checkout failed');

        if (import.meta.env.DEV) {
          // Dev/sandbox: the server simulates the gateway settlement (no external callback locally).
          const simRes = await fetch('/api/payments/payhere/dev-simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id })
          });
          if (!simRes.ok) {
            const simErr = await simRes.json().catch(() => ({}));
            throw new Error(simErr.error || 'Payment simulation failed');
          }
        } else {
          // Production: hand off to PayHere. It calls the server notify_url server-to-server.
          submitPayHereRedirect(checkData);
          return;
        }

        // 3. Confirm against the authoritative order status before printing a receipt.
        const paidOrder = await pollOrderPaid(order.id);
        if (!paidOrder) {
          showToast('Payment is still processing. Check the order status before issuing a receipt.', 'warning');
          setShowPaymentModal(false);
          await loadAllData();
          return;
        }

        setPrintReceiptOrder({
          id: order.id,
          diningType,
          tableId: selectedTable?.id || null,
          timestamp: Date.now(),
          invoiceNumber: paidOrder.invoiceNumber || null,
          items: receiptItems,
          subtotal: receiptTotals.subtotal,
          discount: receiptTotals.discount,
          serviceCharge: receiptTotals.serviceCharge,
          tax: receiptTotals.tax,
          tip: receiptTotals.tip,
          roundedAmount: receiptTotals.roundedAmount,
          total: receiptTotals.total,
          paymentMethod: 'payhere',
          paymentSplit: splitDetails
        });
        setTipInput(0);
        setShowPaymentModal(false);
        await loadAllData();
      } catch (err) {
        showToast('PayHere payment failed: ' + err.message, 'error');
      }
      return;
    }

    try {
      const splitDetails = paymentMethod === 'split' ? splitPayments : [{ method: paymentMethod, amount: receiptTotals.total }];
      const order = await placeOrder(false, tipInput, splitDetails);
      if (order) {
        const settlement = await completePayment(order.id, paymentMethod, tipInput, splitDetails);
        const receiptData = {
          ...order,
          paymentMethod,
          paymentTimestamp: Date.now(),
          invoiceNumber: settlement?.invoiceNumber || null,
          items: receiptItems,
          subtotal: receiptTotals.subtotal,
          discount: receiptTotals.discount,
          serviceCharge: receiptTotals.serviceCharge,
          tax: receiptTotals.tax,
          tip: receiptTotals.tip,
          roundedAmount: receiptTotals.roundedAmount,
          total: receiptTotals.total,
          paymentSplit: splitDetails
        };
        setLastPaidOrder(receiptData);
        setPrintReceiptOrder(receiptData);
        setShowPaymentModal(false);
        clearCart();
        setTipInput(0);
      }
    } catch (err) {
      showToast('Checkout failed: ' + (err.message || err), 'error');
    }
  };

  const getChangeAmount = () => {
    const received = parseFloat(cashReceived) || 0;
    const change = received - totals.total;
    return change > 0 ? change : 0;
  };

  // Enforce Active Shift view
  if (!activeShift) {
    return (
      <div className="login-wrapper" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: 'linear-gradient(135deg, var(--bg-app) 0%, var(--bg-surface) 100%)',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999
      }}>
        <div className="login-card glass" style={{
          width: '100%',
          maxWidth: '400px',
          padding: '40px',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-card)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>💼</div>
            <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, fontSize: '22px', margin: 0 }}>
              Open Cashier Shift
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '6px' }}>
              Please specify the starting float cash in drawer to begin placing orders.
            </p>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault();
            const float = parseFloat(e.target.float.value) || 0;
            const notes = e.target.notes.value || '';
            try {
              await openShift(float, notes);
            } catch (err) {
              showToast(err.message, 'error');
            }
          }}>
            <div className="form-group">
              <label htmlFor="float">Starting Float ({currencySymbol})</label>
              <input
                id="float"
                name="float"
                type="number"
                defaultValue="5000"
                className="form-input"
                style={{ fontSize: '20px', fontWeight: 'bold' }}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label htmlFor="notes">Shift Notes</label>
              <textarea
                id="notes"
                name="notes"
                className="form-input"
                rows="2"
                placeholder="Morning cashier shift"
              ></textarea>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px 16px', fontSize: '15px' }}>
              Open Shift & Start POS
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-layout">
      {/* 1. Left panel: Menu items browser */}
      <div className="menu-panel">
        <div className="menu-filters">
          <div className="search-bar">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search dishes, drinks, or ingredients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="category-tabs">
            <button
              className={`category-tab ${activeCategory === 'all' ? 'active' : ''}`}
              onClick={() => setActiveCategory('all')}
            >
              🍽️ All Items
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <span>{cat.emoji}</span> {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="menu-items-scroll">
          {filteredItems.length === 0 ? (
            <div className="cart-empty">
              <p>No dishes found matching search parameters.</p>
            </div>
          ) : (
            <div className="menu-grid">
              {filteredItems.map((item) => {
                const isLowStock = item.stock <= item.minStock;
                const isOutOfStock = item.stock <= 0;
                
                return (
                  <div
                    key={item.id}
                    className={`menu-item-card ${isOutOfStock ? 'disabled' : ''}`}
                    onClick={() => handleItemClick(item)}
                    style={{ opacity: isOutOfStock ? 0.5 : 1, cursor: isOutOfStock ? 'not-allowed' : 'pointer' }}
                  >
                    <span 
                      className="menu-item-stock" 
                      style={{ 
                        background: isOutOfStock ? 'var(--color-danger-light)' : (isLowStock ? 'var(--color-warning-light)' : 'var(--color-success-light)'),
                        color: isOutOfStock ? 'var(--color-danger)' : (isLowStock ? 'var(--color-warning)' : 'var(--color-success)')
                      }}
                    >
                      {isOutOfStock ? 'Out of Stock' : `${item.stock} left`}
                    </span>
                    <div className="menu-item-emoji">{item.emoji}</div>
                    <div className="menu-item-info">
                      <h4>{item.name}</h4>
                      <p>{item.description || 'No description available.'}</p>
                    </div>
                    <div className="menu-item-footer">
                      <span className="menu-item-price">{currencySymbol}{item.price.toFixed(2)}</span>
                      <button className="btn btn-icon" style={{ width: '32px', height: '32px', borderRadius: '6px' }} disabled={isOutOfStock}>
                        ＋
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. Right panel: Active Cart & Checkout */}
      <div className="cart-panel">
        <div className="cart-header">
          <div className="cart-title">
            <h2>Current Order</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {lastPaidOrder && (
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                  onClick={() => setPrintReceiptOrder(lastPaidOrder)}
                  title="Print Last Order Receipt"
                >
                  🖨️ Last Bill
                </button>
              )}
              <button 
                className="btn btn-secondary" 
                style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                onClick={() => setShowShiftCloseModal(true)}
              >
                💼 Shift Control
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                onClick={() => {
                  setCashMoveAmount('');
                  setCashMoveReason('');
                  setShowCashMoveModal(true);
                }}
              >
                💵 Cash In/Out
              </button>
              {cart.length > 0 && (
                <button className="btn" style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--color-danger-light)', color: 'var(--color-danger)' }} onClick={() => handleProtectedAction(() => clearCart())}>
                  Clear All
                </button>
              )}
            </div>
          </div>

          <div className="order-metadata">
            {/* Dining Mode Toggle */}
            <button 
              className={`meta-chip ${diningType === 'dine-in' ? 'active' : ''}`}
              onClick={() => {
                setDiningType('dine-in');
                setShowTableModal(true);
              }}
            >
              🍽️ {selectedTable ? `Table ${selectedTable.number}` : 'Select Table'}
            </button>
            
            <button 
              className={`meta-chip ${diningType === 'takeaway' ? 'active' : ''}`}
              onClick={() => {
                setDiningType('takeaway');
                setSelectedTable(null);
              }}
            >
              🥡 Takeaway
            </button>

            <button 
              className={`meta-chip ${diningType === 'delivery' ? 'active' : ''}`}
              onClick={() => {
                setDiningType('delivery');
                setSelectedTable(null);
              }}
            >
              🛵 Delivery
            </button>

            {/* Customer Toggle */}
            <button 
              className={`meta-chip ${selectedCustomer ? 'active' : ''}`}
              onClick={() => setShowCustomerModal(true)}
            >
              👤 {selectedCustomer ? selectedCustomer.name : 'Add Customer'}
            </button>
          </div>
        </div>

        <div className="cart-items-scroll">
          {cart.length === 0 ? (
            <div className="cart-empty">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
              <p>Add items from the menu to start order.</p>
            </div>
          ) : (
            cart.map((item, index) => (
              <div className="cart-item" key={index}>
                <div className="cart-item-desc">
                  <h4>{item.name}</h4>
                  <span className="cart-item-price">{currencySymbol}{item.price.toFixed(2)}</span>
                  {item.notes && <div className="cart-item-notes">📝 {item.notes}</div>}
                </div>
                <div className="cart-item-controls">
                  <div className="qty-counter">
                    <button className="qty-btn" onClick={() => updateCartQuantity(index, item.quantity - 1)}>−</button>
                    <div className="qty-val">{item.quantity}</div>
                    <button className="qty-btn" onClick={() => updateCartQuantity(index, item.quantity + 1)}>＋</button>
                  </div>
                  <span className="cart-item-total">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cart-summary">
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{currencySymbol}{totals.subtotal.toFixed(2)}</span>
          </div>

          <div className="summary-row" style={{ cursor: 'pointer', color: discountValue > 0 ? 'var(--color-primary)' : 'var(--text-muted)' }} onClick={() => handleProtectedAction(() => setShowDiscountModal(true))}>
            <span>Discount {discountValue > 0 && `(${discountType === 'percent' ? `${discountValue}%` : `${currencySymbol}${discountValue}`})`}</span>
            <span>-{currencySymbol}{totals.discount.toFixed(2)}</span>
          </div>

          {settings.serviceChargeRate > 0 && (
            <div className="summary-row">
              <span>Service Charge ({settings.serviceChargeRate}%)</span>
              <span>{currencySymbol}{totals.serviceCharge.toFixed(2)}</span>
            </div>
          )}

          <div className="summary-row">
            <span>Tax ({settings.taxRate || 0}%)</span>
            <span>{currencySymbol}{totals.tax.toFixed(2)}</span>
          </div>

          <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Add Tip ({currencySymbol})</span>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: '80px', padding: '4px 8px', fontSize: '13px', textAlign: 'right', margin: 0, height: '30px' }}
              min="0"
              value={tipInput}
              onChange={(e) => setTipInput(parseFloat(e.target.value) || 0)}
            />
          </div>

          {totals.roundedAmount !== 0 && (
            <div className="summary-row" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Rounding Adjustment</span>
              <span>{totals.roundedAmount > 0 ? '+' : ''}{currencySymbol}{totals.roundedAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="summary-row total">
            <span>Payable Amount</span>
            <span>{currencySymbol}{totals.total.toFixed(2)}</span>
          </div>

          <div className="cart-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handlePlaceHoldOrder} disabled={cart.length === 0} style={{ padding: '8px', fontSize: '13px' }}>
              🔥 Kitchen KOT
            </button>
            <button className="btn btn-secondary" onClick={() => setShowRecallModal(true)} style={{ padding: '8px', fontSize: '13px' }}>
              📋 Recall Tab ({orders.filter(o => o.status === 'hold').length})
            </button>
            <button className="btn btn-secondary" onClick={() => setShowSplitModal(true)} disabled={cart.length === 0} style={{ padding: '8px', fontSize: '13px' }}>
              ✂️ Split Bill
            </button>
            <button className="btn btn-primary" onClick={handlePayClick} disabled={cart.length === 0} style={{ padding: '8px', fontSize: '13px' }}>
              💳 Proceed to Pay
            </button>
          </div>
        </div>
      </div>

      {/* 3. MODALS BLOCK */}

      {/* 3a. Customizer Modal (Qty & Notes) */}
      {showCustomizerModal && customizerItem && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Customize Order Item</h2>
              <button className="modal-close" onClick={() => setShowCustomizerModal(false)}>×</button>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '40px', background: 'var(--bg-surface)', padding: '12px', borderRadius: '12px' }}>
                {customizerItem.emoji}
              </div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '700' }}>{customizerItem.name}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{currencySymbol}{customizerItem.price.toFixed(2)} each</p>
              </div>
            </div>

            <div className="form-group">
              <label>Select Quantity</label>
              <div className="qty-counter" style={{ display: 'inline-flex', scale: '1.2', transformOrigin: 'left center', margin: '8px 0' }}>
                <button className="qty-btn" onClick={() => setCustomizerQty(q => Math.max(1, q - 1))} style={{ padding: '6px 12px' }}>−</button>
                <div className="qty-val" style={{ minWidth: '40px' }}>{customizerQty}</div>
                <button className="qty-btn" onClick={() => setCustomizerQty(q => Math.min(customizerItem.stock, q + 1))} style={{ padding: '6px 12px' }}>＋</button>
              </div>
            </div>

            <div className="form-group">
              <label>Special Instructions (e.g., Less spicy, No onions, Sauce on side)</label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Type here..."
                value={customizerNotes}
                onChange={(e) => setCustomizerNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setShowCustomizerModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCustomizerSubmit}>Add to Cart</button>
            </div>
          </div>
        </div>
      )}

      {/* 3b. Table Selection Modal */}
      {showTableModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2>Select Dining Table</h2>
              <button className="modal-close" onClick={() => setShowTableModal(false)}>×</button>
            </div>
            <div className="tables-grid" style={{ padding: 0 }}>
              {tables.map((table) => (
                <div
                  key={table.id}
                  className={`table-card ${table.status} ${selectedTable?.id === table.id ? 'occupied' : ''}`}
                  onClick={() => {
                    setSelectedTable(table);
                    setShowTableModal(false);
                  }}
                >
                  <span className="table-status-dot" style={{ 
                    background: table.status === 'free' ? 'var(--color-success)' : (table.status === 'billing' ? 'var(--color-warning)' : 'var(--color-primary)')
                  }} />
                  <span className="table-number">{table.number}</span>
                  <span className="table-capacity">{table.capacity} Pax</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3c. Customer Selection Modal */}
      {showCustomerModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Assign Customer to Bill</h2>
              <button className="modal-close" onClick={() => setShowCustomerModal(false)}>×</button>
            </div>

            {/* Quick Register Form */}
            <form onSubmit={handleQuickAddCustomer} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>Quick Customer Registration</h3>
              <div className="form-row" style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Customer Name"
                  value={quickCustName}
                  onChange={(e) => setQuickCustName(e.target.value)}
                  required
                />
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Phone Number"
                  value={quickCustPhone}
                  onChange={(e) => setQuickCustPhone(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Register & Select
              </button>
            </form>

            {/* Search list of registered customers */}
            <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>Registered Customers</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {customers.map((cust) => (
                <div
                  key={cust.id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: selectedCustomer?.id === cust.id ? 'var(--color-primary-light)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => {
                    setSelectedCustomer(cust);
                    setShowCustomerModal(false);
                  }}
                >
                  <div>
                    <h4 style={{ fontWeight: '600', fontSize: '14px' }}>{cust.name}</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📞 {cust.phone}</p>
                  </div>
                  <span className="badge badge-primary">{cust.points} Points</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3d. Discount Modal */}
      {showDiscountModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Apply Bill Discount</h2>
              <button className="modal-close" onClick={() => setShowDiscountModal(false)}>×</button>
            </div>
            
            <div className="form-group">
              <label>Discount Type</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className={`btn ${discountType === 'percent' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                  onClick={() => setDiscountType('percent')}
                >
                  Percentage (%)
                </button>
                <button
                  className={`btn ${discountType === 'flat' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                  onClick={() => setDiscountType('flat')}
                >
                  Flat Rate ({currencySymbol})
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Discount Value</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setShowDiscountModal(false)}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* 3e. Payment Settlement Modal */}
      {showPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>Select Payment Mode</h2>
              <button className="modal-close" onClick={() => setShowPaymentModal(false)}>×</button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Final Amount Payable</p>
              <h3 style={{ fontSize: '36px', fontWeight: '800', color: 'var(--color-primary)' }}>
                {currencySymbol}{totals.total.toFixed(2)}
              </h3>
            </div>

            <div className="payment-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div 
                className={`payment-mode-card ${paymentMethod === 'cash' ? 'active' : ''}`}
                style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', cursor: 'pointer' }}
                onClick={() => setPaymentMethod('cash')}
              >
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>💵</div>
                <span>Cash</span>
              </div>
              <div 
                className={`payment-mode-card ${paymentMethod === 'card' ? 'active' : ''}`}
                style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', cursor: 'pointer' }}
                onClick={() => setPaymentMethod('card')}
              >
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>💳</div>
                <span>Card</span>
              </div>
              <div 
                className={`payment-mode-card ${paymentMethod === 'split' ? 'active' : ''}`}
                style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', cursor: 'pointer' }}
                onClick={() => {
                  setPaymentMethod('split');
                  setSplitPayments([
                    { method: 'cash', amount: Math.floor(totals.total / 2) },
                    { method: 'card', amount: totals.total - Math.floor(totals.total / 2) }
                  ]);
                }}
              >
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🔀</div>
                <span>Split Tender</span>
              </div>
              <div 
                className={`payment-mode-card ${paymentMethod === 'payhere' ? 'active' : ''}`}
                style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', cursor: 'pointer' }}
                onClick={() => setPaymentMethod('payhere')}
              >
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🇱🇰</div>
                <span>PayHere Gate</span>
              </div>
            </div>

            {paymentMethod === 'cash' && (
              <div className="form-group">
                <label>Cash Received ({currencySymbol})</label>
                <input
                  type="number"
                  className="form-input"
                  style={{ fontSize: '20px', fontWeight: 'bold' }}
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
                
                {/* Cash helpers */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {[totals.total, 10, 20, 50, 100].map((val) => {
                    const rounded = Math.ceil(val);
                    return (
                      <button 
                        key={val}
                        type="button"
                        className="btn btn-secondary" 
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => setCashReceived(rounded.toString())}
                      >
                        {currencySymbol}{rounded}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', background: 'var(--bg-surface)', padding: '12px', borderRadius: '8px' }}>
                  <span style={{ fontWeight: '600' }}>Change Return:</span>
                  <span style={{ fontWeight: '800', color: 'var(--color-success)', fontSize: '16px' }}>
                    {currencySymbol}{getChangeAmount().toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {paymentMethod === 'split' && (
              <div style={{ background: 'var(--bg-surface)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Specify Tender Amounts</h4>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Cash Amount</label>
                    <input
                      type="number"
                      className="form-input"
                      value={splitPayments.find(p => p.method === 'cash')?.amount || 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setSplitPayments([
                          { method: 'cash', amount: val },
                          { method: 'card', amount: Math.max(0, totals.total - val) }
                        ]);
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Card Amount</label>
                    <input
                      type="number"
                      className="form-input"
                      value={splitPayments.find(p => p.method === 'card')?.amount || 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setSplitPayments([
                          { method: 'cash', amount: Math.max(0, totals.total - val) },
                          { method: 'card', amount: val }
                        ]);
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <span>Tendered Total:</span>
                  <span style={{ color: Math.abs(splitPayments.reduce((acc, p) => acc + p.amount, 0) - totals.total) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {currencySymbol}{splitPayments.reduce((acc, p) => acc + p.amount, 0).toFixed(2)} / {currencySymbol}{totals.total.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
              <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => setShowPaymentModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flexGrow: 2 }} onClick={handlePaymentComplete}>
                Complete Settlement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Completed Success Dialog */}
      {printReceiptOrder && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>✅</div>
            <h2 style={{ margin: '0 0 4px 0', color: 'var(--color-success)' }}>Payment Successful!</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 20px 0' }}>
              Order #{printReceiptOrder.id?.slice(-6)} settled successfully
            </p>

            <div style={{ background: 'var(--bg-surface)', padding: '16px', borderRadius: '8px', marginBottom: '20px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span>Total Billed:</span>
                <strong>{currencySymbol}{printReceiptOrder.total?.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span>Payment Mode:</span>
                <strong style={{ textTransform: 'uppercase' }}>{printReceiptOrder.paymentMethod}</strong>
              </div>
              {getChangeAmount() > 0 && paymentMethod === 'cash' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-success)', fontWeight: 'bold', paddingTop: '8px', borderTop: '1px solid var(--border-color)', fontSize: '14px' }}>
                  <span>Change Return:</span>
                  <span>{currencySymbol}{getChangeAmount().toFixed(2)}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => window.print()}
              >
                🖨️ Print Receipt
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1 }}
                onClick={() => setPrintReceiptOrder(null)}
              >
                New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3f. Manager PIN Verification Modal */}
      {showPinModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '360px' }}>
            <div className="modal-header">
              <h2>Manager Override</h2>
              <button className="modal-close" onClick={() => setShowPinModal(false)}>×</button>
            </div>
            
            <form onSubmit={handlePinSubmit}>
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  Please enter a Manager or Owner PIN to authorize this action.
                </p>
              </div>

              {pinError && (
                <div style={{
                  background: 'var(--color-danger-light)',
                  color: 'var(--color-danger)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                  textAlign: 'center',
                  marginBottom: '16px',
                  fontWeight: 500
                }}>
                  ⚠️ {pinError}
                </div>
              )}

              <div className="form-group" style={{ textAlign: 'center' }}>
                <input
                  type="password"
                  maxLength="4"
                  className="form-input"
                  style={{
                    fontSize: '28px',
                    letterSpacing: '12px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    maxWidth: '180px',
                    margin: '0 auto',
                    padding: '8px'
                  }}
                  placeholder="••••"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => setShowPinModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }}>
                  Authorize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3g. Shift Close Modal (Z-Report) */}
      {showShiftCloseModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Active Shift Control</h2>
              <button className="modal-close" onClick={() => { setShowShiftCloseModal(false); setShiftReport(null); }}>×</button>
            </div>

            {!shiftReport ? (
              <form onSubmit={async (e) => {
                e.preventDefault();
                const actual = parseFloat(e.target.actualCash.value) || 0;
                const notes = e.target.closeNotes.value || '';
                try {
                  const res = await closeShift(actual, notes);
                  const summaryRes = await fetch(`/api/shifts/summary/${res.shiftId}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('gastroflow_token')}` }
                  });
                  const summaryData = await summaryRes.json();
                  setShiftReport(summaryData);
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }}>
                <div style={{ marginBottom: '16px', fontSize: '13px', background: 'var(--bg-surface)', padding: '12px', borderRadius: '8px' }}>
                  <div>Cashier: <strong>{activeShift?.username}</strong></div>
                  <div>Started: <strong>{activeShift ? new Date(activeShift.startTime).toLocaleTimeString() : ''}</strong></div>
                  <div>Starting Float: <strong>{currencySymbol}{activeShift?.startFloat.toFixed(2)}</strong></div>
                </div>

                <div className="form-group">
                  <label htmlFor="actualCash">Counted Cash in Drawer ({currencySymbol})</label>
                  <input
                    id="actualCash"
                    name="actualCash"
                    type="number"
                    className="form-input"
                    style={{ fontSize: '20px', fontWeight: 'bold' }}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label htmlFor="closeNotes">Closing Notes</label>
                  <textarea
                    id="closeNotes"
                    name="closeNotes"
                    className="form-input"
                    rows="2"
                    placeholder="Morning shift closing float"
                  ></textarea>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                  End Shift & Perform Cash-Up
                </button>
              </form>
            ) : (
              <div>
                <div id="z-report-print" className="z-report-print-area" style={{ fontFamily: 'monospace', fontSize: '13px', color: '#000', background: '#fff', padding: '16px', border: '1px solid #ddd', marginBottom: '20px' }}>
                  <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>🍕</div>
                    <h3 style={{ margin: 0 }}>GastroFlow Z-Report</h3>
                    <p style={{ margin: '4px 0', fontSize: '11px' }}>Shift Report Summary</p>
                  </div>
                  <div>Shift ID: #{shiftReport.shift.id.slice(-6)}</div>
                  <div>Cashier: {shiftReport.shift.username}</div>
                  <div>Opened: {new Date(shiftReport.shift.startTime).toLocaleString()}</div>
                  <div>Closed: {new Date(shiftReport.shift.endTime).toLocaleString()}</div>
                  <hr style={{ borderStyle: 'dashed' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Starting Float:</span>
                    <span>{currencySymbol}{shiftReport.shift.startFloat.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Expected Cash Sales:</span>
                    <span>{currencySymbol}{shiftReport.stats.cashSales.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>Expected Cash in Drawer:</span>
                    <span>{currencySymbol}{shiftReport.shift.expectedCash.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>Actual Cash Counted:</span>
                    <span>{currencySymbol}{shiftReport.shift.actualCash.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: shiftReport.shift.actualCash - shiftReport.shift.expectedCash < 0 ? 'red' : 'green', fontWeight: 'bold' }}>
                    <span>Over/Short Cash:</span>
                    <span>{currencySymbol}{(shiftReport.shift.actualCash - shiftReport.shift.expectedCash).toFixed(2)}</span>
                  </div>
                  <hr style={{ borderStyle: 'dashed' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total Cards Sales:</span>
                    <span>{currencySymbol}{shiftReport.stats.cardSales.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total UPI/QR Sales:</span>
                    <span>{currencySymbol}{shiftReport.stats.upiSales.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>Total Sales volume:</span>
                    <span>{currencySymbol}{shiftReport.stats.totalSales.toFixed(2)}</span>
                  </div>
                  <hr style={{ borderStyle: 'dashed' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Orders Settled:</span>
                    <span>{shiftReport.stats.totalOrders}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Voids Tracked:</span>
                    <span>{shiftReport.stats.voidCount} ({currencySymbol}{shiftReport.stats.voidTotal.toFixed(2)})</span>
                  </div>
                  <hr style={{ borderStyle: 'dashed' }} />
                  <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 'bold' }}>
                    System by RS Technologies
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => {
                    window.print();
                  }}>
                    🖨️ Print Z-Report
                  </button>
                  <button className="btn btn-primary" style={{ flexGrow: 1 }} onClick={() => {
                    setShowShiftCloseModal(false);
                    setShiftReport(null);
                  }}>
                    Close Screen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden print receipt window (triggered on complete) */}
      {printReceiptOrder && (
        <div className={`receipt-print-area ${settings.printerPaperWidth === '58mm' ? 'paper-58mm' : 'paper-80mm'}`}>
          <div className="receipt-center">
            {settings.logo ? (
              <img src={settings.logo} alt="Logo" className="receipt-logo" />
            ) : (
              <div style={{ fontSize: '28px', marginBottom: '2px' }}>🍕</div>
            )}
            <h3 style={{ margin: '0 0 2px 0', fontSize: '15px' }}>{settings.businessName || 'GastroFlow Bistro'}</h3>
            <p style={{ margin: '0 0 2px 0' }}>{settings.address || '12 Galle Road, Colombo 03, Sri Lanka'}</p>
            <p style={{ margin: '0 0 2px 0' }}>Tel: {settings.phone || '+94 11 234 5678'}</p>
          </div>
          <div className="receipt-divider"></div>
          <p>Date: {new Date(printReceiptOrder.timestamp || Date.now()).toLocaleString()}</p>
          {printReceiptOrder.invoiceNumber != null && (
            <p><strong style={{ fontSize: '13px' }}>INV-{String(printReceiptOrder.invoiceNumber).padStart(6, '0')}</strong></p>
          )}
          <p>Order ID: #{printReceiptOrder.id?.slice(-6).toUpperCase()}</p>
          <p>Type: {(printReceiptOrder.orderType || printReceiptOrder.diningType || 'POS')?.toUpperCase()}</p>
          {printReceiptOrder.tableId && <p>Table: {tables.find(t => t.id === printReceiptOrder.tableId)?.number}</p>}
          {printReceiptOrder.customerName && <p>Customer: {printReceiptOrder.customerName}</p>}
          {printReceiptOrder.customerPhone && <p>Phone: {printReceiptOrder.customerPhone}</p>}
          {printReceiptOrder.deliveryAddress && <p>Address: {printReceiptOrder.deliveryAddress}</p>}
          <div className="receipt-divider"></div>
          
          {printReceiptOrder.items?.map((item, idx) => (
            <div key={idx} className="receipt-row">
              <span>{item.quantity}x {item.name}</span>
              <span>{currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}

          <div className="receipt-divider"></div>
          <div className="receipt-row">
            <span>Subtotal:</span>
            <span>{currencySymbol}{printReceiptOrder.subtotal?.toFixed(2)}</span>
          </div>
          {printReceiptOrder.discount > 0 && (
            <div className="receipt-row">
              <span>Discount ({printReceiptOrder.discountValue}{printReceiptOrder.discountType === 'percent' ? '%' : ''}):</span>
              <span>-{currencySymbol}{printReceiptOrder.discount?.toFixed(2)}</span>
            </div>
          )}
          {printReceiptOrder.serviceCharge > 0 && (
            <div className="receipt-row">
              <span>Service Charge ({settings.serviceChargeRate || 10}%):</span>
              <span>{currencySymbol}{printReceiptOrder.serviceCharge?.toFixed(2)}</span>
            </div>
          )}
          <div className="receipt-row">
            <span>Tax ({settings.taxRate}%):</span>
            <span>{currencySymbol}{printReceiptOrder.tax?.toFixed(2)}</span>
          </div>
          {printReceiptOrder.tip > 0 && (
            <div className="receipt-row">
              <span>Tip:</span>
              <span>{currencySymbol}{printReceiptOrder.tip?.toFixed(2)}</span>
            </div>
          )}
          {printReceiptOrder.roundedAmount !== 0 && (
            <div className="receipt-row">
              <span>Rounding Adj:</span>
              <span>{currencySymbol}{printReceiptOrder.roundedAmount?.toFixed(2)}</span>
            </div>
          )}
          <div className="receipt-divider"></div>
          <div className="receipt-row receipt-totals" style={{ fontWeight: 'bold', fontSize: '15px' }}>
            <span>TOTAL AMOUNT:</span>
            <span>{currencySymbol}{printReceiptOrder.total?.toFixed(2)}</span>
          </div>
          <div className="receipt-divider"></div>
          <div className="receipt-center">
            <p>Payment Method: {printReceiptOrder.paymentMethod?.toUpperCase()}</p>
            {(() => {
              if (!printReceiptOrder.paymentSplit) return null;
              try {
                const splits = typeof printReceiptOrder.paymentSplit === 'string'
                  ? JSON.parse(printReceiptOrder.paymentSplit)
                  : printReceiptOrder.paymentSplit;
                if (!Array.isArray(splits)) return null;
                return (
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {splits.map((p, i) => (
                      <div key={i}>{p.method?.toUpperCase()}: {currencySymbol}{p.amount?.toFixed(2)}</div>
                    ))}
                  </div>
                );
              } catch (err) {
                return null;
              }
            })()}
            <p style={{ marginTop: '12px', fontWeight: 'bold' }}>Thank You For Dining With Us!</p>
            <p>System by RS Technologies</p>
          </div>
        </div>
      )}

      {/* Cash Movement Modal (Cash In / Paid-Outs) */}
      {showCashMoveModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h2>Cash In / Cash Out (Paid-Out)</h2>
              <button className="modal-close" onClick={() => setShowCashMoveModal(false)}>×</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!cashMoveAmount || parseFloat(cashMoveAmount) <= 0) {
                showToast('Please enter a valid amount.', 'warning');
                return;
              }
              try {
                await recordCashMovement(cashMoveType, parseFloat(cashMoveAmount), cashMoveReason);
                showToast(`${cashMoveType === 'cash_in' ? 'Cash In' : 'Paid-out'} of LKR ${cashMoveAmount} recorded successfully!`, 'success');
                setShowCashMoveModal(false);
                setCashMoveAmount('');
                setCashMoveReason('');
              } catch (err) {
                showToast(err.message, 'error');
              }
            }}>
              <div className="form-group">
                <label>Movement Type</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className={`btn ${cashMoveType === 'cash_in' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1 }}
                    onClick={() => setCashMoveType('cash_in')}
                  >
                    💵 Cash In (Float)
                  </button>
                  <button
                    type="button"
                    className={`btn ${cashMoveType === 'cash_out' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1 }}
                    onClick={() => setCashMoveType('cash_out')}
                  >
                    💸 Paid-Out (Expense)
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>Amount ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input"
                  placeholder="e.g. 500"
                  value={cashMoveAmount}
                  onChange={(e) => setCashMoveAmount(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginTop: '12px' }}>
                <label>Reason / Description</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Vendor petty cash, Change float"
                  value={cashMoveReason}
                  onChange={(e) => setCashMoveReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCashMoveModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3g. Recall Tab / Held Orders Modal */}
      {showRecallModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h2>📋 Recall Held Order (Tabs)</h2>
              <button className="modal-close" onClick={() => setShowRecallModal(false)}>×</button>
            </div>
            
            {orders.filter(o => o.status === 'hold').length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p>No active held tabs found.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto' }}>
                {orders.filter(o => o.status === 'hold').map(order => {
                  const tbl = tables.find(t => t.id === order.tableId);
                  return (
                    <div
                      key={order.id}
                      style={{
                        display: 'flex',
                        justify: 'space-between',
                        alignItems: 'center',
                        background: 'var(--bg-surface)',
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px' }}>
                          Order #{order.id.slice(-4).toUpperCase()} — {tbl ? `Table ${tbl.number}` : order.diningType}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {order.items?.length || 0} items · {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          loadOrderToPOS(order);
                          setShowRecallModal(false);
                        }}
                      >
                        Recall & Edit
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3h. Split Bill Modal */}
      {showSplitModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2>✂️ Split Bill / Divide Check</h2>
              <button className="modal-close" onClick={() => setShowSplitModal(false)}>×</button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                  className={`btn ${splitMode === 'even' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1 }}
                  onClick={() => setSplitMode('even')}
                >
                  🔢 Even Split (by N)
                </button>
              </div>

              <div style={{ background: 'var(--bg-surface)', padding: '16px', borderRadius: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Check Amount</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)' }}>
                  {currencySymbol}{totals.total.toFixed(2)}
                </div>
              </div>

              {splitMode === 'even' && (
                <div>
                  <div className="form-group">
                    <label>Number of Diners / Portions</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {[2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          className={`btn ${splitCount === n ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ flex: 1, padding: '8px' }}
                          onClick={() => setSplitCount(n)}
                        >
                          {n} Diners
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '14px', borderRadius: '8px', color: 'var(--color-primary)', fontWeight: 700, fontSize: '15px', textAlign: 'center', marginTop: '16px' }}>
                    Each Portion: {currencySymbol}{(totals.total / splitCount).toFixed(2)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setShowSplitModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowSplitModal(false);
                  setCashReceived((totals.total / splitCount).toString());
                  setShowPaymentModal(true);
                }}
              >
                Pay Portion 1 of {splitCount} ({currencySymbol}{(totals.total / splitCount).toFixed(2)})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
