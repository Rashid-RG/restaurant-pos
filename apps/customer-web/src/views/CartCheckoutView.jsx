import React, { useState, useEffect } from 'react';
import { useCart } from '../context/CartContext.jsx';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';
import LocationPicker from '../components/LocationPicker.jsx';

const ORDER_TYPES = [
  { id: 'dine-in', label: 'Dine In (QR)', icon: '🪑' },
  { id: 'takeaway', label: 'Takeaway', icon: '🥡' },
  { id: 'delivery', label: 'Delivery', icon: '🚚' }
];

const LOCAL_PAYMENTS = [
  { id: 'cash', label: 'Cash on Delivery / Pay at Counter', icon: '💵' },
  { id: 'payhere', label: 'PayHere (Card / eZ Cash / Bank)', icon: '💳' }
];

export default function CartCheckoutView({ onOrderPlaced, onNavigate, toast }) {
  const { items, subtotal, clearCart, setCartOpen } = useCart();
  const { customer, getToken } = useCustomerAuth();
  const { dict: t } = useLang();

  const [orderType, setOrderType] = useState('takeaway');
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [address, setAddress] = useState('');
  // Real geocoded delivery location (lat/lng) chosen on the map picker.
  const [geoLocation, setGeoLocation] = useState(null); // { lat, lng, label }
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');

  // Scheduling states
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledTimeVal, setScheduledTimeVal] = useState(null);

  // Delivery & prep time settings from DB
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [minimumOrder, setMinimumOrder] = useState(0);
  const [storePrepTime, setStorePrepTime] = useState({ dineIn: 15, takeaway: 20, delivery: 35 });
  const [tipPercent, setTipPercent] = useState(0);   // 0 | 5 | 10 | 15 | 'custom'
  const [customTip, setCustomTip] = useState('');
  // Dynamic delivery zone fee breakdown from server
  const [deliveryFeeBreakdown, setDeliveryFeeBreakdown] = useState(null);

  // Promo & Loyalty
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [redeemPoints, setRedeemPoints] = useState(false);

  // Saved profile items
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [savedCards, setSavedCards] = useState([]);

  // States
  const [loading, setLoading] = useState(false);
  const [payhereRedirectData, setPayhereRedirectData] = useState(null);

  // OTP Verification States
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpChannel, setOtpChannel] = useState('email'); // 'email' (FREE!) | 'sms'

  const boundTable = localStorage.getItem('gastroflow_dinein_table');

  // Set order type dynamically if QR table is pre-bound
  useEffect(() => {
    if (boundTable) {
      setOrderType('dine-in');
    }
  }, [boundTable]);

  // Load saved addresses and cards if customer logged in
  useEffect(() => {
    if (customer) {
      apiFetch('/customer/addresses')
        .then(data => {
          setSavedAddresses(data || []);
          const def = data?.find(a => a.isDefault === 1);
          if (def) setAddress(def.addressLine);
        })
        .catch(() => {});

      apiFetch('/customer/cards')
        .then(data => setSavedCards(data || []))
        .catch(() => {});
    }

    // Load store delivery & prep time settings
    apiFetch('/public/menu')
      .then(data => {
        if (data) {
          setDeliveryFee(data.deliveryFee || 0);
          setMinimumOrder(data.minimumOrder || 0);
          if (data.prepTime) setStorePrepTime(data.prepTime);
        }
      })
      .catch(() => {});
  }, [customer]);

  // ── Dynamic delivery fee calculation when location is picked ──
  useEffect(() => {
    if (orderType === 'delivery' && geoLocation?.lat && geoLocation?.lng) {
      apiFetch(`/public/delivery-fee?lat=${geoLocation.lat}&lng=${geoLocation.lng}&subtotal=${subtotal}`)
        .then(data => {
          setDeliveryFeeBreakdown(data);
          if (data.isOutOfRange) {
            setDeliveryFee(0);
            toast && toast(`❌ Your location is ${data.distanceKm} km away — outside our ${data.maxRadiusKm} km delivery zone.`, 'error');
          } else if (data.isFreeDelivery) {
            setDeliveryFee(0);
          } else {
            setDeliveryFee(data.totalFee);
          }
        })
        .catch(() => {});
    } else {
      setDeliveryFeeBreakdown(null);
    }
  }, [orderType, geoLocation?.lat, geoLocation?.lng, subtotal]);

  // Totals calculations
  const loyaltyAvailable = customer?.loyaltyPoints || 0;
  const loyaltyPointsToRedeem = redeemPoints ? Math.min(loyaltyAvailable, Math.floor(subtotal * 100)) : 0;
  const loyaltyDiscount = Math.floor(loyaltyPointsToRedeem / 100);

  // Promo code discount simulation
  let promoDiscount = 0;
  if (appliedPromo) {
    if (appliedPromo.type === 'percent') {
      promoDiscount = (subtotal * appliedPromo.value) / 100;
    } else if (appliedPromo.type === 'flat') {
      promoDiscount = appliedPromo.value;
    }
  }

  const taxRate = 0.10; // 10% tax rate
  const discountTotal = loyaltyDiscount + promoDiscount;
  const serviceCharge = (subtotal - discountTotal) * 0.10; // 10% service charge
  const tax = (subtotal - discountTotal + serviceCharge) * taxRate;
  
  // Dynamic delivery fee addition
  const activeDeliveryFee = orderType === 'delivery' ? deliveryFee : 0;
  // Tip: preset percentage of subtotal, or a custom amount. The server re-prices authoritatively.
  const tipAmount = tipPercent === 'custom'
    ? Math.max(0, Number(customTip) || 0)
    : Math.round((subtotal * tipPercent) / 100 * 100) / 100;
  const rawTotal = subtotal - discountTotal + serviceCharge + tax + activeDeliveryFee + tipAmount;
  const total = Math.round(rawTotal);
  const roundedAmount = total - rawTotal;

  // Generate 15-minute scheduling time slots (Today & Tomorrow)
  const getAvailableTimeSlots = () => {
    const slots = [];
    const now = new Date();
    
    // Dynamic buffer based on selected order type prep time (minimum 30 mins)
    const prepBuffer = Math.max(
      30,
      orderType === 'dine-in' ? (storePrepTime.dineIn || 15) :
      orderType === 'takeaway' ? (storePrepTime.takeaway || 20) :
      (storePrepTime.delivery || 35)
    );

    const startMins = now.getMinutes() + prepBuffer;
    let baseTime = new Date(now);
    baseTime.setMinutes(Math.ceil(startMins / 15) * 15);
    baseTime.setSeconds(0);
    baseTime.setMilliseconds(0);

    // 16 slots (4 hours of upcoming slots)
    for (let i = 0; i < 16; i++) {
      const slotTime = new Date(baseTime.getTime() + i * 15 * 60 * 1000);
      const isToday = slotTime.getDate() === now.getDate();
      const timeStr = slotTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dayStr = isToday ? 'Today' : 'Tomorrow';

      slots.push({
        timestamp: slotTime.getTime(),
        label: `${dayStr}, ${timeStr}`
      });
    }
    return slots;
  };

  // Apply Promo Code
  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    try {
      const code = promoCode.trim().toUpperCase();
      if (code === 'WELCOME10') {
        if (subtotal < 1000) {
          toast('Min spend of Rs. 1000 required for WELCOME10.', 'error');
          return;
        }
        setAppliedPromo({ code, type: 'percent', value: 10 });
        toast('Promo code WELCOME10 applied! 🎉', 'success');
      } else if (code === 'FLAT200') {
        if (subtotal < 1500) {
          toast('Min spend of Rs. 1500 required for FLAT200.', 'error');
          return;
        }
        setAppliedPromo({ code, type: 'flat', value: 200 });
        toast('Promo code FLAT200 applied! 🎉', 'success');
      } else {
        toast('Invalid or expired promo code.', 'error');
      }
    } catch (err) {
      toast('Failed to apply promo code.', 'error');
    }
  };

  // The map picker sets both the human-readable address and the real coordinates.
  const handlePickLocation = (loc) => {
    setGeoLocation(loc);
    if (loc?.label) setAddress(loc.label);
  };

  const executeOrderPlacement = async () => {
    setLoading(true);
    try {
      const token = getToken();
      const data = await apiFetch('/public/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map(i => ({
            menuItemId: i.id,
            quantity: i.qty,
            notes: i.notes || '',
            selectedModifiers: i.selectedModifiers || []
          })),
          diningType: orderType,
          orderType,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerEmail: email.trim() || null,
          deliveryAddress: orderType === 'delivery' ? (geoLocation?.label || address.trim()) : null,
          deliveryLat: orderType === 'delivery' && geoLocation ? geoLocation.lat : null,
          deliveryLng: orderType === 'delivery' && geoLocation ? geoLocation.lng : null,
          customerToken: token || null,
          loyaltyPointsToRedeem,
          promoCode: appliedPromo?.code || null,
          scheduledTime: isScheduled ? scheduledTimeVal : null,
          tip: tipAmount,
          paymentMethod: paymentMethod === 'payhere' ? 'online_pending' : 'cash'
        })
      });

      if (paymentMethod === 'payhere') {
        const payhereRes = await apiFetch('/public/payment/payhere/hash', {
          method: 'POST',
          body: JSON.stringify({
            orderId: data.orderId,
            amount: total,
            currency: 'LKR'
          })
        });

        if (window.payhere) {
          window.payhere.onCompleted = function onPaymentCompleted(orderId) {
            clearCart();
            setCartOpen(false);
            toast('Payment successful via PayHere! 🎉', 'success');
            onOrderPlaced && onOrderPlaced(data.orderId);
          };

          window.payhere.onDismissed = function onPaymentDismissed() {
            toast('PayHere payment window closed.', 'warning');
          };

          window.payhere.onError = function onPaymentError(error) {
            toast('PayHere Payment Error: ' + error, 'error');
          };

          window.payhere.startPayment({
            sandbox: payhereRes.sandbox,
            merchant_id: payhereRes.merchantId,
            return_url: window.location.origin,
            cancel_url: window.location.origin,
            notify_url: window.location.origin + '/api/public/payment/payhere/notify',
            order_id: data.orderId,
            items: 'GastroFlow Order #' + data.orderId.slice(-4).toUpperCase(),
            amount: payhereRes.amount,
            currency: payhereRes.currency,
            hash: payhereRes.hash,
            first_name: name.split(' ')[0] || 'Customer',
            last_name: name.split(' ')[1] || 'Guest',
            email: email || 'customer@gastroflow.lk',
            phone: phone || '0771234567',
            address: address || 'Colombo 03',
            city: 'Colombo',
            country: 'Sri Lanka'
          });
        } else {
          clearCart();
          setCartOpen(false);
          toast(`Order #${data.orderId.slice(-4).toUpperCase()} created! PayHere Sandbox Hash: ${payhereRes.hash.slice(0, 8)}...`, 'success');
          onOrderPlaced && onOrderPlaced(data.orderId);
        }
      } else {
        clearCart();
        setCartOpen(false);
        toast('Order placed successfully! 🎉', 'success');
        onOrderPlaced && onOrderPlaced(data.orderId);
      }
    } catch (err) {
      toast(err.message || 'Failed to place order', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (items.length === 0) { toast('Your cart is empty!', 'error'); return; }
    if (!name.trim()) { toast('Please enter your name.', 'error'); return; }
    if (!phone.trim()) { toast('Please enter your phone number.', 'error'); return; }

    // Validate minimum spend for delivery
    if (orderType === 'delivery' && subtotal < minimumOrder) {
      toast(`Minimum order for delivery is Rs. ${minimumOrder}.`, 'error');
      return;
    }

    // Validate Sri Lankan Phone Format
    const cleanPhone = phone.trim().replace(/[\s-]/g, '');
    if (!/^(?:\+94|0)7\d{8}$/.test(cleanPhone)) {
      toast('Please enter a valid Sri Lankan mobile number (e.g. 0771234567 or +94771234567).', 'error');
      return;
    }

    // Delivery now requires a real pinned location (validated below alongside OTP).
    // The free-text field is optional apartment/landmark detail for the driver.

    if (orderType === 'delivery' && (!geoLocation || typeof geoLocation.lat !== 'number')) {
      toast('Please pin your delivery location on the map.', 'error');
      return;
    }

    // Real OTP verification: user can choose FREE Email OTP or SMS OTP
    const isAlreadyVerified = customer && cleanPhone === customer.phone?.replace(/[\s-]/g, '') && customer.phoneVerified;
    if (!otpVerified && !isAlreadyVerified) {
      const isEmailMode = otpChannel === 'email';
      const targetDest = isEmailMode ? (email.trim() || customer?.email) : cleanPhone;

      if (isEmailMode && !targetDest) {
        toast('Please enter your email address to receive free Email OTP.', 'error');
        return;
      }

      try {
        const r = await apiFetch('/otp/send', {
          method: 'POST',
          body: JSON.stringify({ channel: isEmailMode ? 'email' : 'sms', destination: targetDest, purpose: 'order_verify' })
        });
        setOtpSent(true);
        if (r.otpCode) setEnteredOtp(r.otpCode);
        setShowOtpModal(true);
        toast(r.otpCode
          ? `Verification code sent! (Dev Auto-Fill: ${r.otpCode})`
          : `Verification code sent to ${targetDest} via ${isEmailMode ? 'Email (FREE)' : 'SMS'}.`, 'info', 8000);
      } catch (err) {
        toast(err.message || 'Could not send verification code.', 'error');
      }
      return;
    }

    await executeOrderPlacement();
  };

  // Local/dev only: ask the SERVER to simulate a PayHere settlement. The browser never marks
  // the order paid itself — the server settles using its own stored total, then we confirm by
  // polling the authoritative order status.
  const handlePayHereSuccessSimulation = async () => {
    if (!import.meta.env.DEV) return;
    if (!payhereRedirectData) return;
    const orderId = payhereRedirectData.orderId;
    try {
      await apiFetch('/payments/payhere/dev-simulate', {
        method: 'POST',
        body: JSON.stringify({ orderId })
      });

      const settled = await pollOrderPaid(orderId);
      if (!settled) {
        toast('Payment is still processing. Track your order for updates.', 'info');
      } else {
        toast('Payment settled successfully via PayHere! 💳', 'success');
      }
      clearCart();
      setCartOpen(false);
      setPayhereRedirectData(null);
      onOrderPlaced && onOrderPlaced(orderId);
    } catch (err) {
      toast('Payment settlement failed: ' + err.message, 'error');
    }
  };

  // Poll the authoritative order status until it flips to paid (or a timeout elapses).
  const pollOrderPaid = async (orderId, attempts = 10, intervalMs = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const order = await apiFetch(`/public/orders/${orderId}`);
        if (order && order.status === 'paid') return true;
      } catch { /* keep polling */ }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  };

  // Redirect to real PayHere Sandbox checkout page (standard form submit)
  const handleRealPayHereRedirect = () => {
    if (!payhereRedirectData) return;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = payhereRedirectData.checkoutUrl;

    const params = {
      merchant_id: payhereRedirectData.merchantId,
      return_url: window.location.origin + `/tracking/${payhereRedirectData.orderId}`,
      cancel_url: window.location.origin + '/checkout',
      notify_url: payhereRedirectData.notifyUrl || '',
      first_name: name.split(' ')[0] || 'Customer',
      last_name: name.split(' ')[1] || 'Guest',
      email: email.trim() || customer?.email || 'customer@gastroflow.lk',
      phone: phone,
      address: address || 'No Address Provided',
      city: 'Colombo',
      country: 'Sri Lanka',
      order_id: payhereRedirectData.orderId,
      items: 'GastroFlow Online Food Order',
      currency: 'LKR',
      amount: payhereRedirectData.amount.toFixed(2),
      hash: payhereRedirectData.signature
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

  return (
    <div className="checkout-view fade-in" style={{ padding: '16px 12px', paddingBottom: 'calc(var(--bottom-bar) + var(--sa-bottom) + 96px)' }}>
      
      {/* PayHere Sandbox Redirect Pop-up */}
      {payhereRedirectData && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.65)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="glass" style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)', padding: 24, borderRadius: 16, border: '2px solid var(--brand)', textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>💳 PayHere Sandbox Gateway</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '8px 0 20px' }}>
              Checkout total: <strong>Rs. {payhereRedirectData.amount}</strong> for Order: <code>{payhereRedirectData.orderId}</code>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {import.meta.env.DEV ? (
                <>
                  <button className="btn btn-brand" onClick={handlePayHereSuccessSimulation}>
                    ✅ Complete Payment (Simulate Success)
                  </button>
                  <button className="btn btn-outline" onClick={handleRealPayHereRedirect}>
                    🌐 Go to Real PayHere Sandbox Gateway
                  </button>
                </>
              ) : (
                <button className="btn btn-brand" onClick={handleRealPayHereRedirect}>
                  🌐 Redirect to PayHere Gateway
                </button>
              )}
              <button className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setPayhereRedirectData(null)}>
                ✕ Cancel Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Verification Modal */}
      {showOtpModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 16, maxWidth: 380, width: '100%', border: '1px solid var(--border-color)', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 800 }}>🔐 Verify Order Credentials</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              Verification code sent to <strong>{otpChannel === 'email' ? (email || customer?.email) : phone}</strong>.
            </p>

            {/* OTP Channel Selector Toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className={`btn ${otpChannel === 'email' ? 'btn-brand' : 'btn-outline'}`}
                style={{ flex: 1, padding: '8px 4px', fontSize: '0.75rem', fontWeight: 700 }}
                onClick={async () => {
                  setOtpChannel('email');
                  const dest = email.trim() || customer?.email;
                  if (!dest) {
                    toast('Please enter your email above.', 'error');
                    return;
                  }
                  try {
                    const r = await apiFetch('/otp/send', {
                      method: 'POST',
                      body: JSON.stringify({ channel: 'email', destination: dest, purpose: 'order_verify' })
                    });
                    if (r.otpCode) setEnteredOtp(r.otpCode);
                    toast(`Email OTP sent to ${dest} (FREE)!`, 'info');
                  } catch (e) {
                    toast(e.message || 'Could not send Email OTP', 'error');
                  }
                }}
              >
                ✉️ Email OTP (FREE)
              </button>
              <button
                type="button"
                className={`btn ${otpChannel === 'sms' ? 'btn-brand' : 'btn-outline'}`}
                style={{ flex: 1, padding: '8px 4px', fontSize: '0.75rem', fontWeight: 700 }}
                onClick={async () => {
                  setOtpChannel('sms');
                  const cleanPhone = phone.trim().replace(/[\s-]/g, '');
                  if (!cleanPhone) {
                    toast('Please enter phone number.', 'error');
                    return;
                  }
                  try {
                    const r = await apiFetch('/otp/send', {
                      method: 'POST',
                      body: JSON.stringify({ channel: 'sms', destination: cleanPhone, purpose: 'order_verify' })
                    });
                    if (r.otpCode) setEnteredOtp(r.otpCode);
                    toast(`SMS OTP sent to ${cleanPhone}.`, 'info');
                  } catch (e) {
                    toast(e.message || 'Could not send SMS OTP', 'error');
                  }
                }}
              >
                📱 SMS OTP
              </button>
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <input
                className="form-control"
                type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
                maxLength={6}
                placeholder="Enter 6-digit OTP..."
                value={enteredOtp}
                onChange={e => setEnteredOtp(e.target.value)}
                style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px', fontWeight: 700 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button 
                className="btn btn-brand" 
                style={{ flex: 1 }}
                onClick={async () => {
                  const cleanPhone = phone.trim().replace(/[\s-]/g, '');
                  const dest = otpChannel === 'email' ? (email.trim() || customer?.email) : cleanPhone;
                  try {
                    const r = await apiFetch('/otp/verify', {
                      method: 'POST',
                      body: JSON.stringify({ channel: otpChannel, destination: dest, purpose: 'order_verify', code: enteredOtp.trim() })
                    });
                    if (r.verified) {
                      setOtpVerified(true);
                      setShowOtpModal(false);
                      setEnteredOtp('');
                      toast('Verification successful! ✓', 'success');
                      await executeOrderPlacement();
                    } else {
                      toast('Invalid verification code. Please try again.', 'error');
                    }
                  } catch (err) {
                    toast(err.message || 'Verification failed.', 'error');
                  }
                }}
              >
                Verify & Place Order
              </button>
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowOtpModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 16 }}>Checkout Details</h2>

      <form onSubmit={handlePlaceOrder}>
        
        {/* Order Type Choice */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Order Type</h3>
          
          {boundTable ? (
            <div style={{ background: 'rgba(0,0,0,0.02)', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem', fontWeight: 700, color: 'var(--brand)', marginTop: 8 }}>
              🪑 QR BOUND: Dine-In (Table {boundTable.toUpperCase()})
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {ORDER_TYPES.map(o => (
                <button 
                  key={o.id}
                  type="button" 
                  className={`btn ${orderType === o.id ? 'btn-brand' : 'btn-outline'}`}
                  style={{ flex: 1, padding: '10px 4px', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}
                  onClick={() => setOrderType(o.id)}
                >
                  <span style={{ fontSize: '1.3rem' }}>{o.icon}</span>
                  <strong>{o.label}</strong>
                </button>
              ))}
            </div>
          )}
          
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⏱️</span>
            <span>
              Estimated Prep / Delivery Time: <strong>~{
                orderType === 'dine-in' ? (storePrepTime.dineIn || 15) :
                orderType === 'takeaway' ? (storePrepTime.takeaway || 20) :
                (storePrepTime.delivery || 35)
              } mins</strong>
            </span>
          </div>
        </div>

        {/* Scheduled Delivery/Pickup */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Order Scheduling</h3>
          
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button 
              type="button" 
              className={`btn ${!isScheduled ? 'btn-brand' : 'btn-outline'}`}
              style={{ flex: 1, padding: 10, fontSize: '0.8rem' }}
              onClick={() => {
                setIsScheduled(false);
                setScheduledTimeVal(null);
              }}
            >
              🚀 Order ASAP
            </button>
            <button 
              type="button" 
              className={`btn ${isScheduled ? 'btn-brand' : 'btn-outline'}`}
              style={{ flex: 1, padding: 10, fontSize: '0.8rem' }}
              onClick={() => {
                setIsScheduled(true);
                const slots = getAvailableTimeSlots();
                if (slots.length > 0) setScheduledTimeVal(slots[0].timestamp);
              }}
            >
              📅 Schedule Later
            </button>
          </div>

          {isScheduled && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Choose Delivery / Pickup Time</label>
              <select 
                className="form-control"
                value={scheduledTimeVal || ''}
                onChange={e => setScheduledTimeVal(parseInt(e.target.value, 10))}
                style={{ fontWeight: 600 }}
              >
                {getAvailableTimeSlots().map(slot => (
                  <option key={slot.timestamp} value={slot.timestamp}>{slot.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Smart Upsell & Cross-Sell Suggestions */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🥤</span> Complete Your Meal (Smart Suggestions)
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
            Frequently paired with your current cart items:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {[
              { id: 'itm_upsell_drink', name: 'Fresh King Coconut', price: 250, emoji: '🥥', allergen: 'Gluten-Free, Vegan' },
              { id: 'itm_upsell_side', name: 'Garlic Butter Naan', price: 350, emoji: '🫓', allergen: 'Contains Dairy & Gluten' },
              { id: 'itm_upsell_dessert', name: 'Watalappan Supreme', price: 450, emoji: '🍮', allergen: 'Contains Eggs & Nuts' }
            ].map(up => (
              <div key={up.id} style={{ padding: 10, background: 'rgba(0,0,0,0.02)', borderRadius: 10, border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem' }}>{up.emoji}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-1)', marginTop: 2 }}>{up.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 800 }}>LKR {up.price.toFixed(2)}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>⚠️ {up.allergen}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Contact Info</h3>
          
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Name</label>
            <input className="form-control" placeholder="E.g. Shanika Perera" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Phone Number <span style={{ color: 'var(--brand)', fontWeight: 800 }}>*</span></label>
            <input className="form-control" type="text" inputMode="tel" placeholder="e.g. 0771234567" value={phone} onChange={e => setPhone(e.target.value)} required />
          </div>

          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Email <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for your receipt & confirmation)</span></label>
            <input className="form-control" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          {orderType === 'delivery' && (
            <div className="form-group" style={{ marginTop: 10 }}>
              <label style={{ marginBottom: 6, display: 'block' }}>Delivery Location</label>

              {/* Saved addresses: pick one to pre-fill the map. */}
              {customer && savedAddresses.length > 0 && (
                <select
                  className="form-control"
                  style={{ marginBottom: 8, fontWeight: 600 }}
                  onChange={e => {
                    const sel = savedAddresses.find(a => a.id === e.target.value);
                    if (sel) {
                      setAddress(sel.addressLine);
                      if (typeof sel.lat === 'number' && typeof sel.lng === 'number') {
                        setGeoLocation({ lat: sel.lat, lng: sel.lng, label: sel.addressLine });
                      }
                    }
                  }}
                  defaultValue=""
                >
                  <option value="">-- Select Saved Location --</option>
                  {savedAddresses.map(a => (
                    <option key={a.id} value={a.id}>{a.addressLine}</option>
                  ))}
                </select>
              )}

              <LocationPicker value={geoLocation} onChange={handlePickLocation} toast={toast} />

              <textarea
                className="form-control"
                rows={2}
                style={{ marginTop: 8 }}
                placeholder="Apartment / floor / landmark (optional details for the driver)"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Promo Codes & Loyalty Points */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Offers & Loyalty</h3>
          
          {/* Promo Input */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input 
              className="form-control" 
              placeholder="Enter Promo Code (e.g. WELCOME10)" 
              value={promoCode} 
              onChange={e => setPromoCode(e.target.value)} 
              disabled={!!appliedPromo}
            />
            <button 
              type="button" 
              className="btn btn-brand" 
              style={{ width: 'auto', padding: '0 16px' }}
              onClick={handleApplyPromo}
              disabled={!!appliedPromo}
            >
              Apply
            </button>
          </div>

          {appliedPromo && (
            <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--success)', fontWeight: 700 }}>
              ✓ Code {appliedPromo.code} applied!
            </div>
          )}

          {/* Loyalty Redeem */}
          {customer && customer.loyaltyPoints > 0 && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input 
                type="checkbox" 
                id="redeem-loyalty-checkbox"
                checked={redeemPoints}
                onChange={e => setRedeemPoints(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--brand)' }}
              />
              <label htmlFor="redeem-loyalty-checkbox" style={{ margin: 0, cursor: 'pointer', fontSize: '0.85rem' }}>
                Redeem <strong>{customer.loyaltyPoints}</strong> loyalty points (Save Rs. {Math.floor(customer.loyaltyPoints / 100)})
              </label>
            </div>
          )}
        </div>

        {/* Payment Methods */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Payment Method</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {LOCAL_PAYMENTS.map(p => (
              <label 
                key={p.id} 
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(0,0,0,0.02)', borderRadius: 8, cursor: 'pointer' }}
              >
                <input 
                  type="radio" 
                  name="payment" 
                  checked={paymentMethod === p.id}
                  onChange={() => setPaymentMethod(p.id)}
                  style={{ width: 18, height: 18, accentColor: 'var(--brand)' }}
                />
                <span style={{ fontSize: '1.25rem' }}>{p.icon}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Special Instructions Notes */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>Special Instructions</h3>
          <textarea 
            className="form-control" 
            rows={2} 
            placeholder="E.g., Please make the curry extra spicy, deliver after 6 PM, etc."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ resize: 'none', marginTop: 8 }}
          />
        </div>

        {/* Tip the team */}
        <div className="form-section">
          <h3>💛 {t.addTip}</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: -4, marginBottom: 12 }}>{t.tipNote}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {[0, 5, 10, 15].map(pct => (
              <button
                key={pct}
                type="button"
                className={`btn ${tipPercent === pct ? 'btn-brand' : 'btn-outline'}`}
                style={{ padding: '10px 4px', fontSize: '0.82rem' }}
                onClick={() => { setTipPercent(pct); setCustomTip(''); }}
              >
                {pct === 0 ? t.tipNone : `${pct}%`}
              </button>
            ))}
            <button
              type="button"
              className={`btn ${tipPercent === 'custom' ? 'btn-brand' : 'btn-outline'}`}
              style={{ padding: '10px 4px', fontSize: '0.82rem' }}
              onClick={() => setTipPercent('custom')}
            >
              {t.tipCustom}
            </button>
          </div>
          {tipPercent === 'custom' && (
            <input
              className="form-control"
              type="text" inputMode="decimal"
              placeholder={t.enterTipAmount}
              value={customTip}
              onChange={e => setCustomTip(e.target.value.replace(/[^0-9.]/g, ''))}
              style={{ marginTop: 10 }}
            />
          )}
        </div>

        {/* Bill Summary */}
        <div className="form-section" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, marginBottom: 20, border: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem', fontWeight: 700 }}>{t.billSummary}</h3>
          
          {orderType === 'delivery' && subtotal < minimumOrder && (
            <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 12, fontSize: '0.82rem' }}>
              ⚠️ {t.minSpend?.replace('{min}', minimumOrder.toFixed(2)).replace('{current}', subtotal.toFixed(2))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.subtotal}</span><span>Rs. {subtotal.toFixed(2)}</span>
            </div>
            {discountTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                <span>{t.discountsApplied}</span><span>-Rs. {discountTotal.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.serviceCharge}</span><span>Rs. {serviceCharge.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.taxes}</span><span>Rs. {tax.toFixed(2)}</span>
            </div>
            {orderType === 'delivery' && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.02)' }}>
                {deliveryFeeBreakdown?.isOutOfRange ? (
                  <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '0.82rem', textAlign: 'center', padding: '8px 0' }}>
                    ❌ Sorry, your location is {deliveryFeeBreakdown.distanceKm} km away — outside our {deliveryFeeBreakdown.maxRadiusKm} km delivery zone.
                  </div>
                ) : deliveryFeeBreakdown?.isFreeDelivery ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--success)', alignItems: 'center' }}>
                    <span>🎉 FREE Delivery!</span>
                    <span style={{ fontSize: '0.78rem', opacity: 0.8 }}>Order above Rs. {deliveryFeeBreakdown.freeThreshold}</span>
                  </div>
                ) : deliveryFeeBreakdown ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: 4 }}>
                      <span>📍 Distance: {deliveryFeeBreakdown.distanceKm} km</span>
                      <span>⏱️ ETA: ~{deliveryFeeBreakdown.etaMinutes} min</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span>🛵 Base Fee</span><span>Rs. {deliveryFeeBreakdown.baseFee}</span>
                    </div>
                    {deliveryFeeBreakdown.distanceCharge > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                        <span>📏 Distance Charge ({(deliveryFeeBreakdown.distanceKm - (deliveryFeeBreakdown.freeRadius || 2)).toFixed(1)} km × Rs. {Math.round(deliveryFeeBreakdown.distanceCharge / Math.max(0.1, deliveryFeeBreakdown.distanceKm - (deliveryFeeBreakdown.freeRadius || 2)))})</span>
                        <span>Rs. {deliveryFeeBreakdown.distanceCharge}</span>
                      </div>
                    )}
                    {deliveryFeeBreakdown.peakSurcharge > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#f59e0b' }}>
                        <span>🔥 Peak Hour Surcharge</span><span>Rs. {deliveryFeeBreakdown.peakSurcharge}</span>
                      </div>
                    )}
                    {deliveryFeeBreakdown.rainSurcharge > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#3b82f6' }}>
                        <span>🌧️ Rain Surcharge</span><span>Rs. {deliveryFeeBreakdown.rainSurcharge}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border-color)', paddingTop: 6, marginTop: 4 }}>
                      <span>🚚 {t.deliveryFee}</span><span>Rs. {deliveryFeeBreakdown.totalFee}</span>
                    </div>
                    {deliveryFeeBreakdown.freeThreshold && subtotal < deliveryFeeBreakdown.freeThreshold && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginTop: 4, textAlign: 'center', fontWeight: 600 }}>
                        💡 Add Rs. {Math.ceil(deliveryFeeBreakdown.freeThreshold - subtotal)} more for FREE delivery!
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                    <span>{t.deliveryFee}</span><span>Rs. {deliveryFee.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
            {tipAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--brand)' }}>
                <span>{t.tip}</span><span>Rs. {tipAmount.toFixed(2)}</span>
              </div>
            )}
            {roundedAmount !== 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                <span>{t.rounding}</span><span>{roundedAmount > 0 ? '+' : ''}Rs. {roundedAmount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.05rem', borderTop: '1px solid var(--border-color)', paddingTop: 8, marginTop: 4 }}>
              <span>{t.totalPayable}</span><span style={{ color: 'var(--brand)' }}>Rs. {total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="sticky-bar">
          <button
            type="submit"
            className="btn btn-brand"
            disabled={loading || (orderType === 'delivery' && subtotal < minimumOrder)}
            style={{ fontSize: '1rem', fontWeight: 700 }}
          >
            {loading ? `⏳ ${t.processing}` : `🍽️ ${t.placeOrder} · Rs. ${total.toFixed(0)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
