import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import TrackingMap from '../components/TrackingMap.jsx';

const STATUS_STEPS = [
  { id: 'pending', label: 'Order Received', desc: 'Awaiting restaurant confirmation', icon: '📋' },
  { id: 'preparing', label: 'Kitchen Preparing', desc: 'Chefs are crafting your meal', icon: '👨‍🍳' },
  { id: 'ready', label: 'Ready / On The Way', desc: 'Prepared & heading to destination', icon: '🛵' },
  { id: 'completed', label: 'Delivered / Completed', desc: 'Enjoy your meal!', icon: '🎉' }
];

function statusIndex(status) {
  if (!status) return 0;
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'delivered' || s === 'completed' || s === 'served') return 3;
  if (s === 'ready' || s === 'out_for_delivery') return 2;
  if (s === 'preparing' || s === 'in progress') return 1;
  return 0;
}

function getProgressPercent(statusIndex) {
  switch (statusIndex) {
    case 0: return 15;
    case 1: return 50;
    case 2: return 82;
    case 3: return 100;
    default: return 10;
  }
}

export default function OrderTrackingView({ orderId, onBack, toast = () => {} }) {
  const { t, dict: tr } = useLang();
  const [trackId, setTrackId] = useState(orderId || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingMins, setRemainingMins] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [storeInfo, setStoreInfo] = useState(null);   // { lat, lng, name, ... }
  const [driverLoc, setDriverLoc] = useState(null);    // live { lat, lng, driverName }

  // Uber Eats-grade Dynamic ETA & Live Driver Chat states
  const [dynamicETA, setDynamicETA] = useState(null);
  const [driverChatOpen, setDriverChatOpen] = useState(false);
  const [driverMessages, setDriverMessages] = useState([]);
  const [driverInputMsg, setDriverInputMsg] = useState('');
  const [sendingDriverMsg, setSendingDriverMsg] = useState(false);

  // ── Real-time Driver Dispatch Status ──
  const [dispatchStatus, setDispatchStatus] = useState(null);

  // Load store info once
  useEffect(() => {
    apiFetch('/public/store-info').then(setStoreInfo).catch(() => {});
  }, []);

  // Fetch dynamic ETA
  useEffect(() => {
    if (order && order.id) {
      apiFetch(`/public/orders/${order.id}/eta`)
        .then(setDynamicETA)
        .catch(() => {});
    }
  }, [order?.id, order?.status]);

  // ── Poll Dispatch Status every 8 seconds ──
  useEffect(() => {
    if (!order || !order.id) return;
    const s = (order.status || '').toLowerCase();
    if (s === 'completed' || s === 'delivered' || s === 'paid' || s === 'cancelled') return;

    const fetchDispatch = () => {
      apiFetch(`/public/orders/${order.id}/dispatch-status`)
        .then(setDispatchStatus)
        .catch(() => {});
    };
    fetchDispatch();
    const interval = setInterval(fetchDispatch, 8000);
    return () => clearInterval(interval);
  }, [order?.id, order?.status]);

  // Load & listen to Driver Chat messages
  const fetchDriverMessages = async (id) => {
    if (!id) return;
    try {
      const data = await apiFetch(`/orders/${id}/driver-chat`);
      setDriverMessages(data || []);
    } catch (_) {}
  };

  const handleSendDriverMsg = async (e) => {
    e.preventDefault();
    if (!driverInputMsg.trim() || !order?.id) return;
    setSendingDriverMsg(true);
    try {
      await apiFetch(`/orders/${order.id}/driver-chat`, {
        method: 'POST',
        body: JSON.stringify({
          senderType: 'customer',
          senderName: order.customerName || 'Customer',
          message: driverInputMsg.trim()
        })
      });
      setDriverInputMsg('');
      fetchDriverMessages(order.id);
    } catch (err) {
      toast(err.message || 'Failed to send message to driver', 'error');
    } finally {
      setSendingDriverMsg(false);
    }
  };

  // Star Rating feedback states
  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // ── High-Professional Customer Order Chime ──
  const playCustomerChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [
        { freq: 523.25, time: 0, duration: 0.20 },   // C5
        { freq: 659.25, time: 0.15, duration: 0.20 },  // E5
        { freq: 783.99, time: 0.30, duration: 0.40 }   // G5
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + time);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + time);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + time);
        osc.stop(ctx.currentTime + time + duration);
      });
    } catch (_) {}
  };

  const fetchOrder = async (id) => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const data = await apiFetch(`/public/orders/${id}`);
      if (order && order.status && data.status !== order.status) {
        playCustomerChime();
        toast(`🔔 Order Status Updated: ${data.status.toUpperCase()}`, 'info');
      }
      setOrder(data);
      if (data.driver && typeof data.driver.lat === 'number') setDriverLoc(data.driver);
      setFeedbackSubmitted(false);
    } catch (err) {
      setError(err.message);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      setTrackId(orderId);
      fetchOrder(orderId);
    }
  }, [orderId]);

  // Live SSE Stream Listener for instant updates + 5s polling fallback
  useEffect(() => {
    if (!order || !order.id) return;

    const status = (order.status || '').toLowerCase();
    if (status === 'paid' || status === 'delivered' || status === 'completed' || status === 'cancelled') return;

    // SSE Stream setup
    let es;
    try {
      const streamUrl = new URL(`/api/stream/orders/${order.id}`, window.location.origin).href;
      es = new EventSource(streamUrl);
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg && msg.type === 'driver_location') {
            setDriverLoc({ lat: msg.lat, lng: msg.lng, driverName: msg.driverName });
          } else if (msg && msg.id) {
            setOrder(msg);
          }
        } catch (err) {}
      };
    } catch (err) {}

    // Polling fallback
    const interval = setInterval(() => {
      fetchOrder(order.id);
    }, 5000);

    // Web Push Notification Registration
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted' && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            if (storeInfo?.vapidPublicKey) {
              reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: storeInfo.vapidPublicKey
              }).then(sub => {
                apiFetch('/public/push/subscribe', {
                  method: 'POST',
                  body: JSON.stringify({ orderId: order.id, subscription: sub })
                }).catch(() => {});
              }).catch(() => {});
            }
          });
        }
      });
    }

    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, [order?.id, order?.status]);

  // Calculate dynamic ETA countdown
  useEffect(() => {
    if (!order) return;
    if (order.status === 'cancelled' || order.status === 'paid' || order.status === 'completed') {
      setRemainingMins(null);
      return;
    }

    const eta = order.etaMinutes || 25;
    const startTime = order.acceptedAt || order.timestamp;
    const elapsedMins = Math.floor((Date.now() - startTime) / 60000);
    const left = Math.max(1, eta - elapsedMins);
    setRemainingMins(left);

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 60000);
      setRemainingMins(Math.max(1, eta - elapsed));
    }, 30000);

    return () => clearInterval(timer);
  }, [order?.acceptedAt, order?.etaMinutes, order?.timestamp, order?.status]);

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    if (!order) return;
    setSubmittingFeedback(true);
    try {
      await apiFetch('/public/feedback', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          rating,
          comment: feedbackComment.trim()
        })
      });
      setFeedbackSubmitted(true);
    } catch (err) {
      toast('Failed to send feedback: ' + err.message, 'error');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    if (!window.confirm(tr.cancelConfirm)) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`/public/orders/${order.id}/cancel`, { method: 'POST' });
      if (res && res.status === 'cancelled') {
        setOrder(prev => ({ ...prev, status: 'cancelled', rejectedReason: 'Cancelled by customer' }));
        toast(tr.orderCancelled, 'success');
      }
    } catch (err) {
      toast(err.message || 'Could not cancel the order.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const curStep = order ? statusIndex(order.status) : -1;
  const progressPct = order ? getProgressPercent(curStep) : 0;
  const isCancelled = order?.status === 'cancelled';
  const canCancel = order?.status === 'pending';

  return (
    <div className="tracking-page fade-in" style={{ padding: '20px 16px 80px' }}>
      {!order ? (
        <div className="form-section" style={{ marginTop: 24 }}>
          <h2>📦 Track Your Order</h2>
          <p className="text-muted" style={{ marginBottom: 16 }}>Enter your order reference ID to see live status & ETA</p>
          <div className="form-group">
            <label>Order ID</label>
            <input className="form-control" placeholder="e.g. ord_online_…"
              value={trackId} onChange={e => setTrackId(e.target.value)} />
          </div>
          <button className="btn btn-brand mt-8" onClick={() => fetchOrder(trackId)} disabled={loading || !trackId}>
            {loading ? '⏳ Looking up…' : '🔍 Track Order Live'}
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 12 }}>⚠ {error}</p>}
        </div>
      ) : (
        <>
          {/* UBER EATS HERO LIVE BANNER */}
          <div className="uber-hero-card">
            <div className="uber-hero-header">
              {isCancelled ? (
                <div>
                  <div className="uber-status-badge cancelled">Cancelled</div>
                  <h1 className="uber-hero-title" style={{ color: 'var(--danger)' }}>Order Cancelled</h1>
                  <p className="uber-hero-subtitle">{order.rejectedReason || 'The kitchen was unable to fulfill your order.'}</p>
                </div>
              ) : curStep === 3 ? (
                <div>
                  <div className="uber-status-badge completed">Delivered</div>
                  <h1 className="uber-hero-title">Order Delivered! 🎉</h1>
                  <p className="uber-hero-subtitle">Thank you for dining with GastroFlow.</p>
                </div>
              ) : (
                <div>
                  <div className="uber-status-badge live">🔴 Live Tracking</div>
                  <h1 className="uber-hero-title">
                    {dynamicETA ? `⏱️ ~${dynamicETA.estimatedMinutes} mins` : remainingMins ? `${remainingMins} mins` : 'Estimated ~20 mins'}
                  </h1>
                  {dynamicETA && (
                    <div style={{ fontSize: '0.72rem', color: '#e0e7ff', marginTop: 4 }}>
                      ⚡ Kitchen Prep: {dynamicETA.maxItemPrep}m · Load: +{dynamicETA.kitchenLoadBuffer}m {dynamicETA.rainBuffer ? '· Rain Surge +12m 🌧️' : ''}
                    </div>
                  )}
                  <p className="uber-hero-subtitle">
                    {curStep === 0 && 'Waiting for restaurant confirmation…'}
                    {curStep === 1 && 'Chef is preparing your food fresh in the kitchen 👨‍🍳'}
                    {curStep === 2 && 'Rider is en route to your delivery address 🛵'}
                  </p>
                </div>
              )}
            </div>

            {/* Uber Progress Bar */}
            {!isCancelled && (
              <div className="uber-progress-bar-wrap">
                <div className="uber-progress-bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}

            {/* Real live map — only meaningful for delivery orders with a pinned destination. */}
            {!isCancelled && curStep < 3 && (order.orderType === 'delivery' || order.diningType === 'delivery') && typeof order.deliveryLat === 'number' && (
              <div style={{ position: 'relative', margin: '16px 0' }}>
                <TrackingMap
                  store={storeInfo && typeof storeInfo.lat === 'number' ? { lat: storeInfo.lat, lng: storeInfo.lng } : null}
                  dest={{ lat: order.deliveryLat, lng: order.deliveryLng }}
                  driver={driverLoc}
                />
                <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 500, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  {driverLoc ? '🛵 Driver live' : '📡 Live tracking'}
                </div>
              </div>
            )}
            {/* ── Real-time Driver Dispatch Panel ── */}
            {!isCancelled && curStep < 3 && dispatchStatus && (
              <div style={{
                margin: '12px 0',
                padding: '14px 16px',
                borderRadius: 14,
                background: dispatchStatus.driverId ? 'linear-gradient(135deg,#0f2027,#1a3a2a)' : 'linear-gradient(135deg,#1a1a2e,#2a1a3e)',
                border: `1px solid ${dispatchStatus.driverId ? '#10b981' : '#6366f1'}`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{dispatchStatus.dispatchIcon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>{dispatchStatus.dispatchLabel}</div>
                    {dispatchStatus.driver && dispatchStatus.driver.isRecent && dispatchStatus.driver.distanceToStoreKm !== null && (
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>
                        📍 {dispatchStatus.driver.distanceToStoreKm} km from store · GPS live
                      </div>
                    )}
                    {dispatchStatus.etaMinutes && (
                      <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: 2, fontWeight: 700 }}>
                        ⏱️ Est. delivery: ~{dispatchStatus.etaMinutes} mins
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: dispatchStatus.driverId ? '#10b981' : '#6366f1',
                    boxShadow: `0 0 8px ${dispatchStatus.driverId ? '#10b981' : '#6366f1'}`,
                    animation: 'pulse 1.5s infinite'
                  }} />
                </div>
              </div>
            )}
          </div>

          {/* First-Class Contact & Conduct Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, margin: '12px 0' }}>
            <a
              href="tel:+94760130922"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, textDecoration: 'none', padding: '10px 4px', fontSize: '0.78rem', fontWeight: 700 }}
            >
              📞 Call
            </a>
            <a
              href={`https://wa.me/94760130922?text=${encodeURIComponent(`Hi GastroFlow, inquiry about Order #${order?.id}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, textDecoration: 'none', padding: '10px 4px', fontSize: '0.78rem', fontWeight: 700, background: '#25D366', color: '#fff', border: 'none' }}
            >
              💬 Support
            </a>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 4px', fontSize: '0.78rem', fontWeight: 700, background: '#128C7E', color: '#fff', border: 'none' }}
              onClick={() => {
                const msg = `🧾 *GastroFlow Invoice #${order?.invoiceNumber || order?.id.slice(-4).toUpperCase()}*\nCustomer: ${order?.customerName || 'Customer'}\nTotal: LKR ${(order?.total || 0).toFixed(2)}\nTrack: ${window.location.href}`;
                if (navigator.share) {
                  navigator.share({ title: 'GastroFlow Invoice', text: msg, url: window.location.href }).catch(() => {});
                } else {
                  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                }
              }}
            >
              📲 Share
            </button>
          </div>


          <div style={{ display: 'flex', gap: 10, margin: '8px 0 12px' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack}>
              ⬅ Back to Menu
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setOrder(null); setTrackId(''); }}>
              🔍 Track Another
            </button>
          </div>

          {/* Customer Rating Feedback Popup (when delivered) */}
          {curStep === 3 && (
            <div className="tracking-card" style={{ marginTop: 12, border: '2px solid var(--brand)', background: 'var(--bg-card)' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 800 }}>⭐ Rate Your Experience</h3>
              {feedbackSubmitted ? (
                <p style={{ color: 'var(--success)', fontWeight: 700, margin: 0 }}>
                  Thank you for your feedback! It helps us improve our service. ❤️
                </p>
              ) : (
                <form onSubmit={handleFeedbackSubmit}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
                    How was your meal and delivery today?
                  </p>
                  
                  {/* Stars selectors */}
                  <div style={{ display: 'flex', gap: 8, fontSize: '1.8rem', marginBottom: 12, cursor: 'pointer' }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <span 
                        key={star} 
                        onClick={() => setRating(star)} 
                        style={{ color: star <= rating ? '#ffb300' : '#e0e0e0' }}
                      >
                        ★
                      </span>
                    ))}
                  </div>

                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <textarea 
                      className="form-control" 
                      rows={2} 
                      placeholder="Tell us what you liked or how we can improve..."
                      value={feedbackComment} 
                      onChange={e => setFeedbackComment(e.target.value)}
                      style={{ resize: 'none' }}
                    />
                  </div>

                  <button className="btn btn-brand" style={{ padding: '8px 16px' }} type="submit" disabled={submittingFeedback}>
                    {submittingFeedback ? 'Submitting…' : 'Submit Review'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Detailed Order Card */}
          <div className="tracking-card" style={{ marginTop: 12 }}>
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Order Reference</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--brand)' }}>{order.id}</div>
              </div>
              <span className={`chip chip-${isCancelled ? 'orange' : curStep >= 3 ? 'green' : curStep >= 2 ? 'yellow' : 'orange'}`}>
                {order.status || 'Pending'}
              </span>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              📅 {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {order.orderType || order.diningType || 'Takeaway'}
            </div>

            {order.invoiceNumber != null && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-1)', marginBottom: 8, fontWeight: 700 }}>
                🧾 {tr.invoiceNo}: <span style={{ fontFamily: 'monospace' }}>INV-{String(order.invoiceNumber).padStart(6, '0')}</span>
              </div>
            )}

            {order.deliveryAddress && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-1)', background: 'rgba(0,0,0,0.02)', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>
                📍 <strong>Delivery Address:</strong> {order.deliveryAddress}
              </div>
            )}

            {/* 1-Tap Direct Call & Chat Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setDriverChatOpen(true);
                  fetchDriverMessages(order.id);
                }}
                style={{
                  width: '100%',
                  padding: '10px 4px',
                  borderRadius: 10,
                  background: '#6366f115',
                  border: '1px solid #6366f150',
                  color: '#6366f1',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
                }}
              >
                <span>💬 Chat Rider</span>
              </button>

              <a
                href={`tel:${order?.driver?.phone || order?.driverPhone || '+94760130922'}`}
                style={{ textDecoration: 'none' }}
              >
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px 4px',
                    borderRadius: 10,
                    background: '#10b98115',
                    border: '1px solid #10b98150',
                    color: '#10b981',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4
                  }}
                >
                  <span>🛵 Call Rider</span>
                </button>
              </a>

              <a
                href="tel:+94760130922"
                style={{ textDecoration: 'none' }}
              >
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px 4px',
                    borderRadius: 10,
                    background: '#3b82f615',
                    border: '1px solid #3b82f650',
                    color: '#3b82f6',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4
                  }}
                >
                  <span>🎧 Support</span>
                </button>
              </a>
            </div>

            <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 10 }}>
              {order.items?.map((item, i) => (
                <div key={i} className="flex-between" style={{ fontSize: '0.82rem', padding: '4px 0' }}>
                  <span>{item.name} × {item.quantity}</span>
                  <span style={{ color: 'var(--brand)', fontWeight: 700 }}>Rs. {(item.price * item.quantity).toFixed(0)}</span>
                </div>
              ))}
            </div>

            <div className="flex-between" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-color)', fontWeight: 800, fontSize: '1rem' }}>
              <span>{tr.totalAmount}</span>
              <span style={{ color: 'var(--brand)' }}>Rs. {order.total?.toFixed(0)}</span>
            </div>

            {canCancel && (
              <button
                className="btn btn-outline"
                style={{ marginTop: 14, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={handleCancelOrder}
                disabled={cancelling}
              >
                {cancelling ? tr.cancelling : `✕ ${tr.cancelOrder}`}
              </button>
            )}
            {canCancel && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', textAlign: 'center', marginTop: 6 }}>
                {tr.cancelHint}
              </p>
            )}
          </div>

          {/* Timeline Steps */}
          {!isCancelled && (
            <div className="tracking-card" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 16 }}>Live Progress Timeline</h3>
              <div className="status-steps">
                {STATUS_STEPS.map((step, i) => {
                  const done = i < curStep;
                  const active = i === curStep;
                  return (
                    <div key={step.id} className={`status-step ${done ? 'done' : active ? 'active' : ''}`}>
                      <div className="step-dot">
                        {done ? '✓' : step.icon}
                      </div>
                      <div className="step-info">
                        <h4>{step.label}</h4>
                        <p>{(done || active) ? step.desc : 'Waiting…'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Driver In-App Live Chat Drawer */}
          {driverChatOpen && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', maxWidth: 440, height: '70vh', background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
                <div style={{ background: 'var(--brand)', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>🛵</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Rider Live Direct Chat</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.9 }}>Order #{order.id?.slice(-6).toUpperCase()}</div>
                    </div>
                  </div>
                  <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer' }} onClick={() => setDriverChatOpen(false)}>✕</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {driverMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 40 }}>
                      💬 No messages yet. Send delivery instructions to your rider below!
                    </div>
                  ) : (
                    driverMessages.map(msg => (
                      <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.senderType === 'customer' ? 'flex-end' : 'flex-start' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>{msg.senderName} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ background: msg.senderType === 'customer' ? 'var(--brand)' : 'var(--surface-3)', color: msg.senderType === 'customer' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: '0.85rem', maxWidth: '85%' }}>
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendDriverMsg} style={{ padding: 12, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, background: 'var(--bg-surface)' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Type message to driver..."
                    value={driverInputMsg}
                    onChange={e => setDriverInputMsg(e.target.value)}
                    style={{ flex: 1, borderRadius: 20 }}
                  />
                  <button type="submit" className="btn btn-brand" style={{ borderRadius: 20, padding: '8px 16px' }} disabled={sendingDriverMsg || !driverInputMsg.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
