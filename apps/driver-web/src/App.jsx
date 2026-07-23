import React, { useState, useEffect } from 'react';

// API Helper
const apiFetch = async (url, opts = {}) => {
  const res = await fetch(`/api${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Request Failed');
  return data;
};

export default function App() {
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(
    JSON.parse(localStorage.getItem('gastrodriver_active_rider') || 'null')
  );
  const [activeOrders, setActiveOrders] = useState([]);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  // Self Registration Modal State
  const [showRegModal, setShowRegModal] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regVehicle, setRegVehicle] = useState('Motorbike');
  const [regPlate, setRegPlate] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);

  const showToast = (text, type = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Load drivers list
  const fetchDrivers = async () => {
    try {
      const data = await apiFetch('/public/drivers');
      setDrivers(data || []);
    } catch (err) {
      console.error('Failed to load drivers:', err);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

  // Fetch orders for active rider
  const fetchDriverOrders = async () => {
    if (!selectedDriver) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/public/driver/orders?driverId=${selectedDriver.id}`);
      setActiveOrders(data.assigned || []);
      setAvailableOrders(data.unassigned || []);
    } catch (err) {
      showToast('Failed to load delivery tickets', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDriver) {
      fetchDriverOrders();
      const interval = setInterval(fetchDriverOrders, 8000);
      return () => clearInterval(interval);
    }
  }, [selectedDriver?.id]);

  // GPS Tracking Toggle
  const toggleGps = () => {
    if (isGpsActive) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setIsGpsActive(false);
      setWatchId(null);
      showToast('GPS tracking disabled 🛑', 'info');
    } else {
      if (!('geolocation' in navigator)) {
        showToast('Geolocation is not supported by your browser', 'error');
        return;
      }
      showToast('Starting live GPS broadcast... 📡', 'success');
      setIsGpsActive(true);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLastCoords(coords);
          if (selectedDriver && activeOrders.length > 0) {
            activeOrders.forEach(ord => {
              apiFetch('/public/driver/location', {
                method: 'POST',
                body: JSON.stringify({
                  driverId: selectedDriver.id,
                  driverName: selectedDriver.name,
                  orderId: ord.id,
                  lat: coords.lat,
                  lng: coords.lng
                })
              }).catch(() => {});
            });
          }
        },
        (err) => {
          showToast('Location permission denied or signal lost', 'warning');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
      setWatchId(id);
    }
  };

  const handleSelectDriver = (driver) => {
    setSelectedDriver(driver);
    localStorage.setItem('gastrodriver_active_rider', JSON.stringify(driver));
    showToast(`Welcome back, ${driver.name}! 🛵`, 'success');
  };

  const handleLogoutDriver = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setIsGpsActive(false);
    setSelectedDriver(null);
    localStorage.removeItem('gastrodriver_active_rider');
  };

  const handleAcceptOrder = async (orderId) => {
    try {
      await apiFetch('/public/driver/assign', {
        method: 'POST',
        body: JSON.stringify({ orderId, driverId: selectedDriver.id })
      });
      showToast('Delivery ticket claimed! 🚀', 'success');
      fetchDriverOrders();
    } catch (err) {
      showToast(err.message || 'Failed to claim order', 'error');
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      await apiFetch('/public/driver/status', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          driverId: selectedDriver.id,
          status: newStatus,
          lat: lastCoords?.lat,
          lng: lastCoords?.lng
        })
      });
      showToast(`Status updated: ${newStatus === 'delivered' ? 'Delivered 🎉' : 'Out for Delivery 🛵'}`, 'success');
      fetchDriverOrders();
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regName || !regPhone) {
      showToast('Please enter full name and phone number.', 'warning');
      return;
    }
    try {
      setRegSubmitting(true);
      const res = await apiFetch('/public/drivers/register', {
        method: 'POST',
        body: JSON.stringify({ name: regName, phone: regPhone, vehicleType: regVehicle, plateNumber: regPlate })
      });
      showToast(res.message || 'Registration submitted! Awaiting admin approval.', 'success');
      setShowRegModal(false);
      setRegName('');
      setRegPhone('');
      setRegPlate('');
      fetchDrivers();
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setRegSubmitting(false);
    }
  };

  const activeApprovedDrivers = drivers.filter(d => d.status !== 'pending_approval' && d.status !== 'rejected');

  return (
    <div className="driver-app-shell">
      {/* Toast Notification */}
      {toastMsg && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 99999,
          background: toastMsg.type === 'error' ? '#ef4444' : toastMsg.type === 'success' ? '#10b981' : '#3b82f6',
          color: '#fff', padding: '10px 20px', borderRadius: 20, fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
        }}>
          {toastMsg.text}
        </div>
      )}

      {/* Header */}
      <header className="driver-header">
        <img src="/driver-logo.png" alt="GastroDriver Logo" className="driver-logo-img" />
        <span className="driver-title">GastroDriver</span>
        <span className="driver-badge">Fleet Partner</span>
      </header>

      <main className="driver-content">
        {!selectedDriver ? (
          /* Rider Select / Login Screen */
          <div>
            <div style={{ textAlign: 'center', margin: '20px 0 28px' }}>
              <div style={{ fontSize: '3.2rem', marginBottom: 6 }}>🛵</div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Rider Dispatch Portal</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 4 }}>
                Select your rider profile or self-register to join the delivery fleet
              </p>
            </div>

            {/* Self Register Button */}
            <button
              className="btn-emerald"
              onClick={() => setShowRegModal(true)}
              style={{ width: '100%', padding: '14px', marginBottom: 24, fontSize: '0.95rem' }}
            >
              <span>➕ Self-Register as New Delivery Rider</span>
            </button>

            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Active Approved Fleet Riders ({activeApprovedDrivers.length})
            </h3>

            {activeApprovedDrivers.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                No active approved riders online right now. Click above to self-register!
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {activeApprovedDrivers.map(drv => (
                  <div
                    key={drv.id}
                    onClick={() => handleSelectDriver(drv)}
                    className="card"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: 16, cursor: 'pointer', margin: 0,
                      transition: 'transform 0.15s ease'
                    }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#d1fae5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>
                      🛵
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-main)' }}>{drv.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>📞 {drv.phone} · {drv.vehicleType || drv.vehicle || 'Motorbike'} ({drv.plateNumber || 'N/A'})</div>
                    </div>
                    <span style={{ fontSize: '1.2rem', color: 'var(--brand-emerald)', fontWeight: 800 }}>➔</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Rider Logged-In Dashboard */
          <div>
            {/* Rider Status Card */}
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#ffffff' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>
                  🛵 {selectedDriver.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {selectedDriver.vehicleType || selectedDriver.vehicle || 'Motorbike'} ({selectedDriver.plateNumber || 'Active'}) · {lastCoords ? `GPS (${lastCoords.lat.toFixed(3)}, ${lastCoords.lng.toFixed(3)})` : 'GPS Idle'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={toggleGps}
                  className="btn-emerald"
                  style={{
                    padding: '8px 14px', borderRadius: 20, fontSize: '0.8rem',
                    background: isGpsActive ? '#10b981' : '#64748b'
                  }}
                >
                  {isGpsActive ? '📡 GPS Live' : '📡 Enable GPS'}
                </button>
                <button
                  onClick={handleLogoutDriver}
                  className="btn-outline"
                  style={{ padding: '8px 12px', fontSize: '0.9rem' }}
                  title="Switch Rider"
                >
                  🚪
                </button>
              </div>
            </div>

            {/* My Active Deliveries */}
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
              📦 My Assigned Deliveries ({activeOrders.length})
            </h3>

            {activeOrders.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>No active deliveries assigned to you right now.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {activeOrders.map(ord => {
                  const itemsStr = Array.isArray(ord.items) ? ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Delivery Items';
                  const customerPhone = ord.customerPhone || 'N/A';
                  const waLink = `https://wa.me/${customerPhone.replace(/[\s+-]/g, '')}?text=Hi%20${encodeURIComponent(ord.customerName || 'Customer')},%20I%20am%20your%20GastroFlow%20Delivery%20Rider%20with%20Order%20%23${ord.id.slice(-4).toUpperCase()}`;

                  return (
                    <div key={ord.id} className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--text-main)' }}>Order #{ord.id.slice(-4).toUpperCase()}</span>
                        <span style={{ background: ord.status === 'delivered' ? '#d1fae5' : '#fef3c7', color: ord.status === 'delivered' ? '#065f46' : '#92400e', padding: '4px 10px', borderRadius: 12, fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {ord.status}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div>👤 <strong>{ord.customerName || 'Customer'}</strong></div>
                        <div>📞 <strong>{customerPhone}</strong></div>
                        <div>📍 <strong>{ord.deliveryAddress || 'Store Location'}</strong></div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📦 {itemsStr}</div>
                        <div>💰 Total to Collect: <strong style={{ color: 'var(--brand-emerald)', fontSize: '1rem' }}>Rs. {ord.total?.toFixed(2)}</strong> ({ord.paymentMethod || 'COD'})</div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ flex: 1, background: '#25D366', color: '#fff', padding: '10px', borderRadius: 10, textDecoration: 'none', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem' }}
                        >
                          💬 WhatsApp Customer
                        </a>
                        {ord.status !== 'delivered' && (
                          <button
                            className="btn-emerald"
                            style={{ flex: 1, padding: '10px', fontSize: '0.82rem' }}
                            onClick={() => handleUpdateStatus(ord.id, 'delivered')}
                          >
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

        {/* Driver Self-Registration Modal */}
        {showRegModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="card" style={{ maxWidth: 440, width: '100%', margin: 0, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>🛵 Rider Self-Registration</h3>
                <button onClick={() => setShowRegModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Full Name</label>
                  <input
                    className="input-field"
                    type="text"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="e.g. Saman Kumara"
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Phone Number (WhatsApp)</label>
                  <input
                    className="input-field"
                    type="text"
                    value={regPhone}
                    onChange={e => setRegPhone(e.target.value)}
                    placeholder="e.g. 0771234567"
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Vehicle Type</label>
                  <select
                    className="input-field"
                    value={regVehicle}
                    onChange={e => setRegVehicle(e.target.value)}
                  >
                    <option value="Motorbike">🛵 Motorbike / Scooter</option>
                    <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                    <option value="Car">🚗 Car / Van</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Plate Number</label>
                  <input
                    className="input-field"
                    type="text"
                    value={regPlate}
                    onChange={e => setRegPlate(e.target.value)}
                    placeholder="e.g. WP BZ-9988"
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setShowRegModal(false)}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-emerald"
                    disabled={regSubmitting}
                    style={{ flex: 2 }}
                  >
                    Submit Application
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
