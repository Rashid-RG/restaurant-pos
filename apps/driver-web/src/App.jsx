import { AnimatedFeatureIcon } from '../../../shared/ui/AnimatedFeatureIcon.jsx';
import { Bike } from 'lucide-react';
import ProofOfDeliveryModal, { DeliveryProofViewer } from './ProofOfDeliveryModal.jsx';
import { ConnectionStatus } from '../../../shared/ui/Resilience.jsx';
import React, { useState, useEffect, useRef } from 'react';
import SystemUpdatePrompt from '../../customer-web/src/components/SystemUpdatePrompt.jsx';
import {shouldSendDriverFix} from './utils/gps-transmission.js';


// ── Auth token storage ──
const TOKEN_KEY = 'gastrodriver_token';
const DRIVER_KEY = 'gastrodriver_profile';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

// API helper — attaches the driver JWT so the server can identify + tenant-scope the rider.
const apiFetch = async (url, opts = {}) => {
  const token = getToken();
  const res = await fetch(`/api${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(new URLSearchParams(location.search).get('tenant') ? { 'X-Tenant-Id': new URLSearchParams(location.search).get('tenant') } : {}),
      ...opts.headers
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

// ── Haversine distance helper (km) ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// ── Sri Lanka store coords default (Colombo) ──
const STORE_LAT = 6.9271;
const STORE_LNG = 79.8612;

function isRushHour(timeZone = 'Asia/Colombo') {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
}

export default function App() {
  const [driver, setDriver] = useState(JSON.parse(localStorage.getItem(DRIVER_KEY) || 'null'));
  const [restaurantTimeZone, setRestaurantTimeZone] = useState('Asia/Colombo');
  const [activeOrders, setActiveOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState({ completedToday: 0, cashToHandover: 0 });
  const [taskTab, setTaskTab] = useState('active');
  const [availableOrders, setAvailableOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);
  const [gpsQuality, setGpsQuality] = useState('not_started');
  const lastBroadcastRef = useRef(null);
  const lastFixRef = useRef(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [selectedDeliveryOrder, setSelectedDeliveryOrder] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);

  // Bug 1 fix: ref always holds current activeOrders so GPS watchPosition
  // callback (registered once) never reads a stale closure value.
  const activeOrdersRef = useRef([]);
  useEffect(() => { activeOrdersRef.current = activeOrders; }, [activeOrders]);

  // Bug 3 fix: ref instead of state so polling interval always reads
  // the latest count without a stale closure.
  const prevUnassignedCountRef = useRef(0);

  // Bug 6 fix: store the toast auto-dismiss timer so it can be cancelled.
  const toastTimerRef = useRef(null);

  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Registration modal
  const [showRegModal, setShowRegModal] = useState(false);
  const [reg, setReg] = useState({ name: '', phone: '', password: '', vehicleType: 'Motorbike', plateNumber: '' });
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Bug 6 fix: cancel pending timer before setting a new one to prevent
  // setState-on-unmounted-component warnings and stale toast flashes.
  const showToast = (text, type = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ text, type });
    toastTimerRef.current = setTimeout(() => { setToastMsg(null); toastTimerRef.current = null; }, 3500);
  };

  // ── Auth ──
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginPhone || !loginPassword) { showToast('Enter your phone and password', 'warning'); return; }
    setLoggingIn(true);
    try {
      const res = await apiFetch('/driver/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: loginPhone, password: loginPassword })
      });
      localStorage.setItem(TOKEN_KEY, res.token);
      // Bug 2 fix: only persist known safe fields — do not store raw server
      // response which may contain sensitive or unexpected keys.
      const { id, name, phone, vehicleType, plateNumber, status } = res.driver;
      const safeProfile = { id, name, phone, vehicleType, plateNumber, status };
      localStorage.setItem(DRIVER_KEY, JSON.stringify(safeProfile));
      setDriver(safeProfile);
      setLoginPassword('');
      showToast(`Welcome, ${res.driver.name}! 🛵`, 'success');
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setIsGpsActive(false);
    setWatchId(null);
    setGpsQuality('not_started');
    lastBroadcastRef.current = null;
    lastFixRef.current = null;
    setDriver(null);
    // Bug 4 fix: clear order state so the next driver to log in on the
    // same device does not briefly see the previous driver's orders.
    setActiveOrders([]);
    setAvailableOrders([]);
    activeOrdersRef.current = [];
    prevUnassignedCountRef.current = 0;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DRIVER_KEY);
  };

  // ── High-Professional Driver Delivery Ringtone Alert ──
  const playDriverAlertRingtone = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [
        { freq: 783.99, time: 0, duration: 0.15 },    // G5
        { freq: 1046.50, time: 0.12, duration: 0.15 }, // C6
        { freq: 1318.51, time: 0.25, duration: 0.35 }  // E6
      ];

      [0, 0.5, 1.0].forEach((offset) => {
        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + offset + time);
          gain.gain.setValueAtTime(0.001, ctx.currentTime + offset + time);
          gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + offset + time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + time + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + offset + time);
          osc.stop(ctx.currentTime + offset + time + duration);
        });
      });
    } catch (_) {}
  };

  const [prevUnassignedCount, setPrevUnassignedCount] = useState(0);

  // ── Orders ──
  const fetchDriverOrders = async () => {
    if (!driver) return;
    setLoading(true);
    try {
      const data = await apiFetch('/public/driver/orders');
      const newUnassigned = data.unassigned || [];
      const newAssigned = data.assigned || [];

      // Bug 3 fix: compare against ref (always current) not a stale state closure.
      // prevUnassignedCountRef.current is updated immediately after comparison
      // so every polling cycle sees the real previous value.
      if (newUnassigned.length > prevUnassignedCountRef.current && prevUnassignedCountRef.current > 0) {
        playDriverAlertRingtone();
        showToast('🔔 New Delivery Ticket Available!', 'info');
      }
      prevUnassignedCountRef.current = newUnassigned.length;

      setActiveOrders(newAssigned);
      setHistory(data.completed || []);
      setSummary(data.summary || { completedToday: 0, cashToHandover: 0 });
      if (data.timeZone) setRestaurantTimeZone(data.timeZone);
      setAvailableOrders(newUnassigned);
    } catch (err) {
      if (/token/i.test(err.message)) { handleLogout(); showToast('Session expired — please sign in again', 'warning'); }
      else showToast('Failed to load delivery tickets', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (driver) {
      fetchDriverOrders();
      const interval = setInterval(fetchDriverOrders, 8000);
      return () => clearInterval(interval);
    }
  }, [driver?.id]);

  // ── GPS ──
  const toggleGps = () => {
    if (isGpsActive) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setIsGpsActive(false);
      setWatchId(null);
      setGpsQuality('off');
      lastBroadcastRef.current = null;
      lastFixRef.current = null;
      showToast('Location sharing stopped.', 'info');
      return;
    }
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      showToast('Use HTTPS and enable device location to share a live position.', 'error');
      return;
    }
    setIsGpsActive(true);
    setGpsQuality('searching');
    showToast('Searching for a reliable device location…', 'info');
    const id = navigator.geolocation.watchPosition((pos) => {
      // The OS normally fuses GPS, mobile signals, Wi-Fi and phone sensors.
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const accuracyMeters = pos.coords.accuracy;
      const recordedAt = pos.timestamp;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          !Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 150 ||
          !Number.isFinite(recordedAt) || Date.now() - recordedAt > 30000 ||
          recordedAt > Date.now() + 10000) {
        setGpsQuality('weak');
        return; // Never advertise a poor or stale fix as live.
      }
      const coords = { lat, lng, accuracyMeters, recordedAt };
      if (lastFixRef.current && recordedAt <= lastFixRef.current.recordedAt) return;
      lastFixRef.current = coords;
      setLastCoords(coords);
      setGpsQuality('good');
      // Adaptive movement-based sends with heartbeat while stationary.
      // Never upload GPS unless an active delivery is assigned.
      const assigned=activeOrdersRef.current.filter(order => order?.id && !['delivered','completed','cancelled','rejected'].includes(String(order.status||'').toLowerCase()));
      if (!assigned.length || !shouldSendDriverFix(coords,lastBroadcastRef.current)) return;
      lastBroadcastRef.current={...coords,sentAt:Date.now()};
      assigned.forEach(order => {
        apiFetch('/public/driver/location', {
          method: 'POST',
          body: JSON.stringify({ orderId: order.id, ...coords })
        }).catch(err => {
          if (/location|accuracy|jump|fix/i.test(err.message || '')) setGpsQuality('weak');
          // A later new fix can be retried; don't replay stale GPS.
        });
      });
    }, err => {
      setGpsQuality(err?.code === 1 ? 'denied' : 'weak');
      showToast(err?.code === 1 ? 'Location permission denied. Enable it in device settings.' :
        'Location signal weak. Keep the app visible and move to a clearer area.', 'warning');
    }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
    setWatchId(id);
  };

  const handleClaim = async (orderId) => {
    try {
      await apiFetch('/public/driver/assign', { method: 'POST', body: JSON.stringify({ orderId }) });
      showToast('Delivery claimed! 🚀', 'success');
      fetchDriverOrders();
    } catch (err) {
      showToast(err.message || 'Failed to claim order', 'error');
    }
  };

  const handleUpdateStatus = async (orderId, newStatus, proof = null) => {
    try {
      const result = await apiFetch('/public/driver/status', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          status: newStatus,
          lat: lastCoords?.lat,
          lng: lastCoords?.lng,
          signature: proof?.signature,
          deliveryPhoto: proof?.photo,
          cashReceived: proof?.cashReceived
        })
      });
      if (newStatus === 'delivered' && !result.proof?.savedAt) throw new Error('No saved proof receipt was returned. Refresh to check this delivery.');
      showToast(newStatus === 'delivered' ? 'Delivery completed. Proof saved.' : 'Delivery status updated.', 'success');
      fetchDriverOrders();
    } catch (err) {
      if (newStatus === 'delivered') throw err;
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!reg.name || !reg.phone || !reg.password) { showToast('Name, phone and password are required.', 'warning'); return; }
    if (reg.password.length < 6) { showToast('Password must be at least 6 characters.', 'warning'); return; }
    try {
      setRegSubmitting(true);
      const res = await apiFetch('/public/drivers/register', { method: 'POST', body: JSON.stringify(reg) });
      showToast(res.message || 'Registration submitted! Awaiting admin approval.', 'success');
      setShowRegModal(false);
      setLoginPhone(reg.phone);
      setReg({ name: '', phone: '', password: '', vehicleType: 'Motorbike', plateNumber: '' });
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setRegSubmitting(false);
    }
  };

  // COD cash the rider still needs to hand over (delivered + cash/COD, not yet collected).
  // Bug 8 fix: only include activeOrders (this driver's assigned orders).
  // availableOrders are unassigned and can never be 'delivered', so including
  // them was a logic error that could produce wrong totals if status semantics change.
  const cashToHandover = Number(summary.cashToHandover || 0);
  const visibleOrders = taskTab === 'history' ? history : activeOrders;

  return (
    <div className="driver-app-shell"><ConnectionStatus/>
      <SystemUpdatePrompt />


      {toastMsg && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 99999,
          background: toastMsg.type === 'error' ? '#ef4444' : toastMsg.type === 'success' ? '#10b981' : toastMsg.type === 'warning' ? '#f59e0b' : '#3b82f6',
          color: '#fff', padding: '10px 20px', borderRadius: 20, fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
        }}>
          {toastMsg.text}
        </div>
      )}

      <header className="driver-header">
        <img src={`${import.meta.env.BASE_URL}driver-logo.svg`} alt="GastroDriver" className="driver-logo-img" />
        <span className="driver-title">GastroDriver</span>
        <ConnectionStatus compact/><span className="driver-badge">DELIVERY PARTNER</span>
      </header>

      <main className="driver-content">
        {!driver ? (
          /* ── Login screen ── */
          <div>
            <div className="driver-login-intro" style={{ textAlign: 'center', margin: '20px 0 24px' }}>
              <div className="driver-welcome-icon"><Bike size={40}/></div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Your next delivery awaits.</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 4 }}>
                Sign in with your registered phone and password
              </p>
            </div>

            <form onSubmit={handleLogin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, margin: 0 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Phone Number</label>
                <input className="input-field" type="tel" inputMode="tel" value={loginPhone}
                  onChange={e => setLoginPhone(e.target.value)} placeholder="e.g. 0771234567" required />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Password</label>
                <input className="input-field" type="password" value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" required />
              </div>
              <button type="submit" className="btn-emerald" disabled={loggingIn} style={{ padding: 14, fontSize: '0.95rem' }}>
                {loggingIn ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <button className="btn-outline" onClick={() => setShowRegModal(true)}
              style={{ width: '100%', padding: 14, marginTop: 16, fontSize: '0.92rem' }}>
              ➕ New rider? Self-register
            </button>
          </div>
        ) : (
          /* ── Rider dashboard ── */
          <div>
            <section className="driver-welcome"><span>YOUR DAY, IN MOTION</span><h1>Let’s make every<br/>delivery a good one.</h1><p>Welcome back, {driver.name?.split(' ')[0]}. Your assigned orders and pickup opportunities are all here.</p><ConnectionStatus compact/></section>
            <div className="driver-metrics"><div><small>Active deliveries</small><strong>{activeOrders.length}</strong></div><div><small>Completed today</small><strong>{summary.completedToday}</strong></div><div><small>Available pickups</small><strong>{availableOrders.length}</strong></div></div>

            <div className="card driver-controls-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#ffffff' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>🛵 {driver.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {driver.vehicleType || 'Motorbike'} ({driver.plateNumber || 'Active'}) · {gpsQuality === 'good' && lastCoords ? `Device location ±${Math.round(lastCoords.accuracyMeters)}m · ${new Date(lastCoords.recordedAt).toLocaleTimeString()}` : gpsQuality === 'weak' ? 'Weak location signal · not sharing' : gpsQuality === 'denied' ? 'Location permission denied' : 'Live location inactive'}
                </div>
              </div>
              <div className="driver-controls-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => { playDriverAlertRingtone(); showToast('🔔 Playing delivery ringer sound test!', 'info'); }}
                  className="btn-outline"
                  style={{ padding: '8px 12px', fontSize: '0.9rem' }}
                  title="Test Delivery Ringer Sound"
                >
                  🔔
                </button>
                <button onClick={toggleGps} className="btn-emerald"
                  style={{ padding: '8px 14px', borderRadius: 20, fontSize: '0.8rem', background: isGpsActive ? '#10b981' : '#64748b' }}>
                  {isGpsActive ? (gpsQuality === 'good' ? '📍 Location active' : '⌛ Finding location') : '📍 Share location'}
                </button>
                <button onClick={handleLogout} className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.9rem' }} title="Sign out">🚪</button>
              </div>
            </div>

            {/* COD cash summary */}
            {cashToHandover > 0 && (
              <div className="card" style={{ marginTop: 16, padding: 14, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 700 }}>💰 Cash to hand over to manager</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#b45309' }}>Rs. {cashToHandover.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', color: '#a16207', marginTop: 2 }}>Settle at the counter — the manager confirms handover.</div>
              </div>
            )}

            <div className="driver-task-nav" role="tablist" aria-label="Delivery view">{[['active', 'My route'], ['available', 'Available'], ['history', 'Completed']].map(([id, label]) => <button key={id} role="tab" aria-selected={taskTab === id} onClick={() => setTaskTab(id)}>{label}</button>)}</div>
            {/* Available to claim */}
            {taskTab === 'available' && availableOrders.length === 0 && <div className="driver-empty"><strong>You’re all caught up.</strong>Available pickups will appear here automatically.</div>}
            {taskTab === 'available' && availableOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '1.0rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
                  🟢 Available to Claim ({availableOrders.length})
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                  {availableOrders.map(ord => {
                    // Calculate driver-to-destination distance
                    const dropKm = (lastCoords && ord.deliveryLat && ord.deliveryLng)
                      ? haversineKm(lastCoords.lat, lastCoords.lng, ord.deliveryLat, ord.deliveryLng)
                      : (ord.deliveryLat && ord.deliveryLng)
                        ? haversineKm(STORE_LAT, STORE_LNG, ord.deliveryLat, ord.deliveryLng)
                        : null;

                    return (
                    <div key={ord.id} className="card" style={{ margin: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1rem' }}>Order #{ord.id.slice(-4).toUpperCase()}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            📍 {ord.deliveryAddress || 'Store Pickup'} · Rs. {ord.total?.toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          {dropKm !== null && (
                            <span style={{ background: dropKm <= 5 ? '#10b98122' : '#f59e0b22', color: dropKm <= 5 ? '#10b981' : '#f59e0b', border: `1px solid ${dropKm <= 5 ? '#10b981' : '#f59e0b'}44`, padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 800 }}>
                              🗺️ {dropKm} km drop
                            </span>
                          )}
                          {isRushHour(restaurantTimeZone) && (
                            <span style={{ background: '#f59e0b22', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700 }}>⏰ Peak</span>
                          )}
                        </div>
                      </div>
                      <button className="btn-emerald" style={{ padding: '10px 14px', fontSize: '0.82rem' }} onClick={() => handleClaim(ord.id)}>Claim Delivery</button>
                    </div>
                    );
                  })}
                </div>
              </>
            )}

            {taskTab !== 'available' && <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
              {taskTab === 'history' ? 'Completed deliveries' : 'My route'} ({visibleOrders.length})
            </h3>

            {visibleOrders.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>{taskTab === 'history' ? 'Completed deliveries will appear here.' : 'No active deliveries. Check Available for your next pickup.'}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {visibleOrders.map(ord => {
                  const itemsStr = Array.isArray(ord.items) ? ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Delivery Items';
                  const customerPhone = ord.customerPhone || 'N/A';
                  // Bug 7 fix: convert Sri Lankan local prefix 0771... → +94771...
                  // The previous regex stripped '+' which made +94 numbers work,
                  // but left 07x numbers without a country code — WhatsApp couldn't resolve them.
                  const waPhone = customerPhone.replace(/[\s-]/g, '').replace(/^0/, '+94');
                  const waLink = `https://wa.me/${waPhone}?text=Hi%20${encodeURIComponent(ord.customerName || 'Customer')},%20I%20am%20your%20GastroFlow%20rider%20for%20Order%20%23${ord.id.slice(-4).toUpperCase()}`;
                  const navLink = (ord.deliveryLat && ord.deliveryLng)
                    ? `https://www.google.com/maps/dir/?api=1&destination=${ord.deliveryLat},${ord.deliveryLng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.deliveryAddress || '')}`;

                  return (
                    <div key={ord.id} className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--text-main)' }}>Order #{ord.id.slice(-4).toUpperCase()}</span>
                        <span style={{ background: ord.status === 'delivered' ? '#d1fae5' : ord.status === 'out_for_delivery' ? '#dbeafe' : '#fef3c7', color: ord.status === 'delivered' ? '#065f46' : ord.status === 'out_for_delivery' ? '#1e40af' : '#92400e', padding: '4px 10px', borderRadius: 12, fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {ord.status?.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div>👤 <strong>{ord.customerName || 'Customer'}</strong></div>
                        <div>📞 <strong>{customerPhone}</strong></div>
                        <div>📍 <strong>{ord.deliveryAddress || 'Store Location'}</strong></div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📦 {itemsStr}</div>
                        <div>{ord.paymentStatus === 'paid' ? 'Payment verified' : ['cash', 'cod'].includes(ord.paymentMethod) ? 'Cash to collect' : 'Awaiting payment confirmation'}: <strong style={{ color: 'var(--brand-emerald)', fontSize: '1rem' }}>Rs. {Number(ord.total).toFixed(2)}</strong> ({ord.paymentMethod || 'Unknown method'})</div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a href={navLink} target="_blank" rel="noopener noreferrer"
                          style={{ flex: '1 1 45%', background: '#3b82f6', color: '#fff', padding: 10, borderRadius: 10, textDecoration: 'none', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
                          🧭 Navigate
                        </a>
                        <a href={waLink} target="_blank" rel="noopener noreferrer"
                          style={{ flex: '1 1 45%', background: '#25D366', color: '#fff', padding: 10, borderRadius: 10, textDecoration: 'none', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
                          💬 WhatsApp
                        </a>
                        {['ready', 'picked_up'].includes(ord.status) && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem', background: '#3b82f6' }}
                            onClick={() => handleUpdateStatus(ord.id, 'out_for_delivery')}>
                            <AnimatedFeatureIcon kind="delivery" size={28} active={false}/> Start Delivery (Out for Delivery)
                          </button>
                        )}
                        {['out_for_delivery', 'arrived'].includes(ord.status) && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem' }}
                            onClick={() => setSelectedDeliveryOrder(ord)}>
                            ✓ Mark Delivered (Signature & Proof)
                          </button>
                        )}
                        {ord.status === 'delivered' && (ord.proofSavedAt ? <button className="btn-outline" onClick={async () => {
                          try { setProofPreview(await apiFetch(`/public/driver/orders/${encodeURIComponent(ord.id)}/proof`)); }
                          catch (error) { showToast(error.message, 'error'); }
                        }}>View saved proof</button> : <span>Legacy delivery: no proof recorded</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </>}
          </div>
        )}

        {/* Proof of Delivery Signature & Photo Modal */}
        {selectedDeliveryOrder && (
          <ProofOfDeliveryModal
            order={selectedDeliveryOrder}
            onClose={() => setSelectedDeliveryOrder(null)}
            onConfirm={(ordId, proofData) => handleUpdateStatus(ordId, 'delivered', proofData)}
          />
        )}

        {proofPreview && <DeliveryProofViewer proof={proofPreview} onClose={() => setProofPreview(null)} />}

        {/* Self-registration modal */}
        {showRegModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="card device-dialog" role="dialog" aria-modal="true" aria-label="Driver application" style={{ maxWidth: 440, width: '100%', margin: 0, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>🛵 Rider Self-Registration</h3>
                <button aria-label="Close driver application" onClick={() => setShowRegModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input className="input-field" type="text" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} placeholder="Full name" required />
                <input className="input-field" type="tel" inputMode="tel" value={reg.phone} onChange={e => setReg({ ...reg, phone: e.target.value })} placeholder="Phone (e.g. 0771234567)" required />
                <input className="input-field" type="password" value={reg.password} onChange={e => setReg({ ...reg, password: e.target.value })} placeholder="Create a password (min 6 chars)" required />
                <select className="input-field" value={reg.vehicleType} onChange={e => setReg({ ...reg, vehicleType: e.target.value })}>
                  <option value="Motorbike">🛵 Motorbike / Scooter</option>
                  <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                  <option value="Car">🚗 Car / Van</option>
                </select>
                <input className="input-field" type="text" value={reg.plateNumber} onChange={e => setReg({ ...reg, plateNumber: e.target.value })} placeholder="Plate number (e.g. WP BZ-9988)" />
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button type="button" className="btn-outline" onClick={() => setShowRegModal(false)} style={{ flex: 1 }}>Cancel</button>
                  <button type="submit" className="btn-emerald" disabled={regSubmitting} style={{ flex: 2 }}>
                    {regSubmitting ? 'Submitting…' : 'Submit Application'}
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Your account needs admin approval before you can sign in.</p>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
