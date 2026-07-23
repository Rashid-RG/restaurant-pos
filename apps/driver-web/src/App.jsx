import React, { useState, useEffect } from 'react';

// ── Auth token storage ──
const TOKEN_KEY = 'gastrodriver_token';
const DRIVER_KEY = 'gastrodriver_profile';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

// API helper — attaches the driver JWT so the server can identify + tenant-scope the rider.
const apiFetch = async (url, opts = {}) => {
  const token = getToken();
  const res = await fetch(`/api${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers
    },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

export default function App() {
  const [driver, setDriver] = useState(JSON.parse(localStorage.getItem(DRIVER_KEY) || 'null'));
  const [activeOrders, setActiveOrders] = useState([]);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Registration modal
  const [showRegModal, setShowRegModal] = useState(false);
  const [reg, setReg] = useState({ name: '', phone: '', password: '', vehicleType: 'Motorbike', plateNumber: '' });
  const [regSubmitting, setRegSubmitting] = useState(false);

  const showToast = (text, type = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
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
      localStorage.setItem(DRIVER_KEY, JSON.stringify(res.driver));
      setDriver(res.driver);
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
    setIsGpsActive(false);
    setDriver(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DRIVER_KEY);
  };

  // ── Orders ──
  const fetchDriverOrders = async () => {
    if (!driver) return;
    setLoading(true);
    try {
      const data = await apiFetch('/public/driver/orders');
      setActiveOrders(data.assigned || []);
      setAvailableOrders(data.unassigned || []);
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
      showToast('GPS tracking disabled 🛑', 'info');
    } else {
      if (!('geolocation' in navigator)) { showToast('Geolocation not supported', 'error'); return; }
      showToast('Starting live GPS broadcast… 📡', 'success');
      setIsGpsActive(true);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLastCoords(coords);
          activeOrders.forEach(ord => {
            apiFetch('/public/driver/location', {
              method: 'POST',
              body: JSON.stringify({ orderId: ord.id, lat: coords.lat, lng: coords.lng })
            }).catch(() => {});
          });
        },
        () => showToast('Location permission denied or signal lost', 'warning'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
      setWatchId(id);
    }
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

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      await apiFetch('/public/driver/status', {
        method: 'POST',
        body: JSON.stringify({ orderId, status: newStatus, lat: lastCoords?.lat, lng: lastCoords?.lng })
      });
      showToast(newStatus === 'delivered' ? 'Delivered 🎉' : 'Out for delivery 🛵', 'success');
      fetchDriverOrders();
    } catch (err) {
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
  const cashToHandover = activeOrders
    .concat(availableOrders)
    .filter(o => o.status === 'delivered' && ['cod', 'cash'].includes((o.paymentMethod || '').toLowerCase()) && !o.cashCollected)
    .reduce((sum, o) => sum + (o.total || 0), 0);

  return (
    <div className="driver-app-shell">
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
        <img src="/driver-logo.png" alt="GastroDriver" className="driver-logo-img" />
        <span className="driver-title">GastroDriver</span>
        <span className="driver-badge">Fleet Partner</span>
      </header>

      <main className="driver-content">
        {!driver ? (
          /* ── Login screen ── */
          <div>
            <div style={{ textAlign: 'center', margin: '20px 0 24px' }}>
              <div style={{ fontSize: '3.2rem', marginBottom: 6 }}>🛵</div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Rider Sign In</h2>
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
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#ffffff' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>🛵 {driver.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {driver.vehicleType || 'Motorbike'} ({driver.plateNumber || 'Active'}) · {lastCoords ? `GPS (${lastCoords.lat.toFixed(3)}, ${lastCoords.lng.toFixed(3)})` : 'GPS Idle'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={toggleGps} className="btn-emerald"
                  style={{ padding: '8px 14px', borderRadius: 20, fontSize: '0.8rem', background: isGpsActive ? '#10b981' : '#64748b' }}>
                  {isGpsActive ? '📡 GPS Live' : '📡 Enable GPS'}
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

            {/* Available to claim */}
            {availableOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '1.0rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
                  🟢 Available to Claim ({availableOrders.length})
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                  {availableOrders.map(ord => (
                    <div key={ord.id} className="card" style={{ margin: 0, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>Order #{ord.id.slice(-4).toUpperCase()}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📍 {ord.deliveryAddress || 'Store'} · Rs. {ord.total?.toFixed(2)}</div>
                      </div>
                      <button className="btn-emerald" style={{ padding: '10px 14px', fontSize: '0.82rem', flexShrink: 0 }} onClick={() => handleClaim(ord.id)}>Claim</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
              📦 My Deliveries ({activeOrders.length})
            </h3>

            {activeOrders.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>No active deliveries right now.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {activeOrders.map(ord => {
                  const itemsStr = Array.isArray(ord.items) ? ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Delivery Items';
                  const customerPhone = ord.customerPhone || 'N/A';
                  const waLink = `https://wa.me/${customerPhone.replace(/[\s+-]/g, '')}?text=Hi%20${encodeURIComponent(ord.customerName || 'Customer')},%20I%20am%20your%20GastroFlow%20rider%20for%20Order%20%23${ord.id.slice(-4).toUpperCase()}`;
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
                        <div>💰 Collect: <strong style={{ color: 'var(--brand-emerald)', fontSize: '1rem' }}>Rs. {ord.total?.toFixed(2)}</strong> ({ord.paymentMethod || 'COD'})</div>
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
                        {ord.status !== 'out_for_delivery' && ord.status !== 'delivered' && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem', background: '#3b82f6' }}
                            onClick={() => handleUpdateStatus(ord.id, 'out_for_delivery')}>
                            🛵 Start Delivery (Out for Delivery)
                          </button>
                        )}
                        {ord.status !== 'delivered' && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem' }}
                            onClick={() => handleUpdateStatus(ord.id, 'delivered')}>
                            ✓ Mark Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Self-registration modal */}
        {showRegModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="card" style={{ maxWidth: 440, width: '100%', margin: 0, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>🛵 Rider Self-Registration</h3>
                <button onClick={() => setShowRegModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
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
