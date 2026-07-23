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
  const { dict: tr } = useLang();
  const [trackId, setTrackId] = useState(orderId || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingMins, setRemainingMins] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [storeInfo, setStoreInfo] = useState(null);   // { lat, lng, name, ... }
  const [driverLoc, setDriverLoc] = useState(null);    // live { lat, lng, driverName }

  // Load public store info once (restaurant coordinates for the live map).
  useEffect(() => {
    apiFetch('/public/store-info').then(setStoreInfo).catch(() => {});
  }, []);

  // Star Rating feedback states
  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const fetchOrder = async (id) => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const data = await apiFetch(`/public/orders/${id}`);
      setOrder(data);
      if (data.driver && typeof data.driver.lat === 'number') setDriverLoc(data.driver);
      setFeedbackSubmitted(false); // reset feedback when loading new order
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
                    {remainingMins ? `${remainingMins} mins` : 'Estimated ~20 mins'}
                  </h1>
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
          </div>

          {/* First-Class Contact & Conduct Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
            <a
              href="tel:+94112345678"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none', padding: '10px 8px', fontSize: '0.82rem', fontWeight: 700 }}
            >
              📞 Call Restaurant
            </a>
            <a
              href={`https://wa.me/94112345678?text=${encodeURIComponent(`Hi GastroFlow Support, I need help with my Order #${order?.id}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none', padding: '10px 8px', fontSize: '0.82rem', fontWeight: 700, background: '#25D366', color: '#fff', border: 'none' }}
            >
              💬 WhatsApp Support
            </a>
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
        </>
      )}
    </div>
  );
}
