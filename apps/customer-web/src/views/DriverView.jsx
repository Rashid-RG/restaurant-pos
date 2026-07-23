import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';

export default function DriverView({ toast = () => {} }) {
  const { dict: t } = useLang();
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(
    JSON.parse(localStorage.getItem('gastroflow_active_driver') || 'null')
  );
  const [activeOrders, setActiveOrders] = useState([]);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);

  // Load available drivers
  useEffect(() => {
    fetchDrivers();
  }, []);

  const fetchDrivers = async () => {
    try {
      const data = await apiFetch('/public/drivers');
      setDrivers(data || []);
    } catch (err) {
      console.error('Failed to load drivers:', err);
    }
  };

  // Load orders for selected driver
  const fetchDriverOrders = async () => {
    if (!selectedDriver) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/public/driver/orders?driverId=${selectedDriver.id}`);
      setActiveOrders(data.assigned || []);
      setAvailableOrders(data.unassigned || []);
    } catch (err) {
      toast('Failed to load delivery tickets', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDriver) {
      fetchDriverOrders();
      const interval = setInterval(fetchDriverOrders, 10000);
      return () => clearInterval(interval);
    }
  }, [selectedDriver?.id]);

  // GPS Tracking Toggle
  const toggleGps = () => {
    if (isGpsActive) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setIsGpsActive(false);
      setWatchId(null);
      toast('GPS tracking disabled 🛑', 'info');
    } else {
      if (!('geolocation' in navigator)) {
        toast('Geolocation is not supported by your browser', 'error');
        return;
      }
      toast('Starting live GPS broadcast... 📡', 'success');
      setIsGpsActive(true);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLastCoords(coords);
          // Broadcast GPS to server for active delivery orders
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
          console.error('GPS error:', err);
          toast('Location permission denied or signal lost', 'warning');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
      setWatchId(id);
    }
  };

  // Select driver profile
  const handleSelectDriver = (driver) => {
    setSelectedDriver(driver);
    localStorage.setItem('gastroflow_active_driver', JSON.stringify(driver));
    toast(`Welcome, ${driver.name}! 🛵`, 'success');
  };

  const handleLogoutDriver = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setIsGpsActive(false);
    setSelectedDriver(null);
    localStorage.removeItem('gastroflow_active_driver');
  };

  // Accept unassigned delivery order
  const handleAcceptOrder = async (orderId) => {
    try {
      await apiFetch('/public/driver/assign', {
        method: 'POST',
        body: JSON.stringify({ orderId, driverId: selectedDriver.id })
      });
      toast('Delivery ticket claimed! 🚀', 'success');
      fetchDriverOrders();
    } catch (err) {
      toast(err.message || 'Failed to claim order', 'error');
    }
  };

  // Update order status
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
      const statusLabels = {
        out_for_delivery: 'Out for Delivery 🛵',
        delivered: 'Delivered & Completed 🎉'
      };
      toast(`Status updated: ${statusLabels[newStatus] || newStatus}`, 'success');
      fetchDriverOrders();
    } catch (err) {
      toast(err.message || 'Failed to update status', 'error');
    }
  };

  const [showRegModal, setShowRegModal] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regVehicle, setRegVehicle] = useState('Motorbike');
  const [regPlate, setRegPlate] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regName || !regPhone) {
      toast('Please enter full name and phone number.', 'warning');
      return;
    }
    try {
      setRegSubmitting(true);
      const res = await apiFetch('/public/drivers/register', {
        method: 'POST',
        body: JSON.stringify({ name: regName, phone: regPhone, vehicleType: regVehicle, plateNumber: regPlate })
      });
      toast(res.message || 'Registration submitted! Awaiting admin approval.', 'success');
      setShowRegModal(false);
      setRegName('');
      setRegPhone('');
      setRegPlate('');
      fetchDrivers();
    } catch (err) {
      toast(err.message || 'Registration failed', 'error');
    } finally {
      setRegSubmitting(false);
    }
  };

  // Login Screen if no driver selected
  if (!selectedDriver) {
    const activeDriversList = drivers.filter(d => d.status !== 'pending_approval' && d.status !== 'rejected');

    return (
      <div style={{ padding: 20, maxWidth: 500, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '3rem', marginBottom: 8 }}>🛵</div>
          <h2 style={{ margin: 0, color: 'var(--text-1)' }}>Rider Dispatch Portal</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Select your driver profile or register to join the delivery fleet</p>
        </div>

        {/* Self Registration Button */}
        <button
          className="btn btn-brand"
          onClick={() => setShowRegModal(true)}
          style={{ width: '100%', padding: '14px', marginBottom: 20, fontWeight: 800, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#10b981', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer' }}
        >
          <span>➕ Self-Register as New Delivery Rider</span>
        </button>

        {activeDriversList.length === 0 ? (
          <div style={{ padding: 20, background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>No active drivers online. Click above to self-register!</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {activeDriversList.map(drv => (
              <button
                key={drv.id}
                onClick={() => handleSelectDriver(drv)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: 16,
                  borderRadius: 12,
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-1)',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#10b98115', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
                  🛵
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-1)' }}>{drv.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📞 {drv.phone || 'No phone'} · {drv.vehicleType || drv.vehicle || 'Scooter'}</div>
                </div>
                <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>➔</span>
              </button>
            ))}
          </div>
        )}

        {/* Driver Self-Registration Modal */}
        {showRegModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', color: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>🛵 Rider Self-Registration</h3>
                <button onClick={() => setShowRegModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Full Name</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="e.g. Saman Kumara"
                    required
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '0.9rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Phone Number (WhatsApp)</label>
                  <input
                    type="text"
                    value={regPhone}
                    onChange={e => setRegPhone(e.target.value)}
                    placeholder="e.g. 0771234567"
                    required
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '0.9rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Vehicle Type</label>
                  <select
                    value={regVehicle}
                    onChange={e => setRegVehicle(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '0.9rem' }}
                  >
                    <option value="Motorbike">🛵 Motorbike / Scooter</option>
                    <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                    <option value="Car">🚗 Car / Van</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Plate Number</label>
                  <input
                    type="text"
                    value={regPlate}
                    onChange={e => setRegPlate(e.target.value)}
                    placeholder="e.g. WP BZ-9988"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '0.9rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowRegModal(false)}
                    style={{ flex: 1, padding: 12, borderRadius: 8, background: '#374151', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={regSubmitting}
                    style={{ flex: 2, padding: 12, borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer' }}
                  >
                    Submit Application
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'system-ui, sans-serif', paddingBottom: 80 }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-1)', borderRadius: 14, border: '1px solid var(--border-color)', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-1)' }}>
            🛵 {selectedDriver.name}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {selectedDriver.vehicle || 'Scooter'} · {lastCoords ? `${lastCoords.lat.toFixed(4)}, ${lastCoords.lng.toFixed(4)}` : 'GPS Idle'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={toggleGps}
            style={{
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              background: isGpsActive ? '#10b981' : '#64748b',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            {isGpsActive ? '📡 GPS Live' : '📡 Enable GPS'}
          </button>
          <button
            onClick={handleLogoutDriver}
            style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer' }}
            title="Switch Driver"
          >
            🚪
          </button>
        </div>
      </div>

      {/* Active Assigned Deliveries */}
      <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', marginTop: 0, marginBottom: 12 }}>
        📦 My Active Deliveries ({activeOrders.length})
      </h3>

      {activeOrders.length === 0 ? (
        <div style={{ padding: 24, background: 'var(--surface-1)', borderRadius: 14, border: '1px solid var(--border-color)', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '2rem', marginBottom: 6 }}>📭</div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>No active deliveries assigned to you right now.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginBottom: 24 }}>
          {activeOrders.map(ord => (
            <div key={ord.id} style={{ background: 'var(--surface-1)', borderRadius: 14, border: '1px solid var(--border-color)', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#ff6b35' }}>
                  #{ord.id.slice(-6).toUpperCase()}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 8, background: '#3b82f615', color: '#3b82f6', fontSize: '0.75rem', fontWeight: 700 }}>
                  {ord.status.toUpperCase()}
                </span>
              </div>

              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
                👤 {ord.customerName || 'Customer'}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                📍 {ord.deliveryAddress || ord.address || 'Address provided at checkout'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                {ord.customerPhone && (
                  <a
                    href={`tel:${ord.customerPhone}`}
                    style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', background: '#10b98115', color: '#10b981', borderRadius: 10, fontSize: '0.82rem', fontWeight: 700, textDecoration: 'none', border: '1px solid #10b98130' }}
                  >
                    📞 Call ({ord.customerPhone})
                  </a>
                )}
                {ord.deliveryLat && ord.deliveryLng ? (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${ord.deliveryLat},${ord.deliveryLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', background: '#3b82f615', color: '#3b82f6', borderRadius: 10, fontSize: '0.82rem', fontWeight: 700, textDecoration: 'none', border: '1px solid #3b82f630' }}
                  >
                    🗺️ Turn-by-Turn Nav
                  </a>
                ) : (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.deliveryAddress || 'Colombo')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', background: '#3b82f615', color: '#3b82f6', borderRadius: 10, fontSize: '0.82rem', fontWeight: 700, textDecoration: 'none', border: '1px solid #3b82f630' }}
                  >
                    🔍 Google Maps
                  </a>
                )}
              </div>

              {/* Items summary */}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--surface-2)', padding: 8, borderRadius: 8, marginBottom: 12 }}>
                {typeof ord.items === 'string' ? ord.items : JSON.stringify(ord.items)}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                {ord.status !== 'out_for_delivery' && ord.status !== 'delivered' && (
                  <button
                    onClick={() => handleUpdateStatus(ord.id, 'out_for_delivery')}
                    style={{ flex: 1, padding: 10, borderRadius: 10, background: '#ff6b35', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    🛵 Out for Delivery
                  </button>
                )}
                <button
                  onClick={() => handleUpdateStatus(ord.id, 'delivered')}
                  style={{ flex: 1, padding: 10, borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  ✅ Mark Delivered
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available Tickets for Claiming */}
      {availableOrders.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', marginBottom: 12 }}>
            📋 Available Unassigned Tickets ({availableOrders.length})
          </h3>
          <div style={{ display: 'grid', gap: 12 }}>
            {availableOrders.map(ord => (
              <div key={ord.id} style={{ background: 'var(--surface-1)', borderRadius: 12, border: '1px dashed var(--border-color)', padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-1)' }}>
                    #{ord.id.slice(-6).toUpperCase()} · Rs. {ord.total?.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    📍 {ord.deliveryAddress || 'Delivery Order'}
                  </div>
                </div>
                <button
                  onClick={() => handleAcceptOrder(ord.id)}
                  style={{ padding: '8px 14px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Claim Ticket ✋
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* COD Cash Reconciliation Panel */}
      <div style={{ marginTop: 24, padding: 16, background: 'var(--surface-1)', borderRadius: 14, border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', marginTop: 0, marginBottom: 8 }}>
          💵 Driver Cash Reconciliation (COD Shift Settlement)
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          Reconcile and hand over cash collected from COD deliveries to POS shift manager.
        </p>

        <button
          onClick={async () => {
            try {
              const res = await apiFetch(`/public/driver/cash-reconciliation?driverId=${selectedDriver.id}`);
              if (res && res.uncollectedOrders) {
                if (res.uncollectedOrders.length === 0) {
                  toast('All COD cash has been handed over & reconciled! ✅', 'info');
                } else {
                  const ids = res.uncollectedOrders.map(o => o.id);
                  const pin = prompt(`Manager PIN override required to confirm receipt of LKR ${res.totalCashToHandover} cash from ${selectedDriver.name}:`);
                  if (pin) {
                    await apiFetch('/public/driver/cash-reconciliation/handover', {
                      method: 'POST',
                      body: JSON.stringify({ driverId: selectedDriver.id, orderIds: ids, amountHandedOver: res.totalCashToHandover, managerPin: pin })
                    });
                    toast(`✅ Reconciled LKR ${res.totalCashToHandover} cash for ${ids.length} orders!`, 'success');
                  }
                }
              }
            } catch (e) {
              toast(e.message || 'Cash handover failed', 'error');
            }
          }}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            border: 'none',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(16,185,129,0.2)'
          }}
        >
          💰 Reconcile & Handover Shift Cash
        </button>
      </div>
    </div>
  );
}
