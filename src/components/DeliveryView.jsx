import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function DeliveryView() {
  const { orders, showToast } = usePOS();
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState({});

  // Driver registration form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('Motorbike');
  const [plateNumber, setPlateNumber] = useState('');

  const deliveryOrders = orders.filter(o => o.diningType === 'delivery' || o.diningType === 'takeaway' || o.source === 'online');

  const fetchDrivers = async () => {
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/drivers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDrivers(data);
      }
    } catch (err) {
      console.error('Failed to fetch drivers:', err);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, []);

  const handleRegisterDriver = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      showToast('Please enter driver name and phone number.', 'warning');
      return;
    }
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, phone, vehicleType, plateNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Driver ${name} registered successfully!`, 'success');
      setName('');
      setPhone('');
      setPlateNumber('');
      fetchDrivers();
    } catch (err) {
      showToast('Registration error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDriver = async (id, driverName) => {
    if (!window.confirm(`Delete driver ${driverName} from delivery fleet?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/delivery/drivers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete driver');
      showToast(`Driver ${driverName} removed.`, 'info');
      fetchDrivers();
    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  };

  const handleAssignDriver = async (orderId) => {
    const driverId = selectedDriver[orderId];
    if (!driverId) {
      showToast('Please select a driver from the dropdown.', 'warning');
      return;
    }
    const drv = drivers.find(d => d.id === driverId);
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/delivery/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId, driverId, driverName: drv?.name, driverPhone: drv?.phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Assigned ${drv?.name || driverId} to Order #${orderId.slice(-4).toUpperCase()}`, 'success');
      fetchDrivers();
    } catch (err) {
      showToast('Assignment error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveDriver = async (id, driverName, action) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/delivery/drivers/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: action === 'approve' ? 'available' : 'rejected' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Driver ${driverName} ${action === 'approve' ? 'approved & activated!' : 'rejected.'}`, action === 'approve' ? 'success' : 'info');
      fetchDrivers();
    } catch (err) {
      showToast('Approval error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const pendingDrivers = drivers.filter(d => d.status === 'pending_approval');
  const activeDrivers = drivers.filter(d => d.status !== 'pending_approval' && d.status !== 'rejected');

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>🛵 Delivery Dispatch & Fleet Management</h1>
          <p>Review rider self-registrations, approve fleet drivers, and assign active orders.</p>
        </div>
      </div>

      <div className="view-body" style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* 0. Pending Driver Registrations Queue */}
        {pendingDrivers.length > 0 && (
          <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '2px dashed #eab308', borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: '#eab308', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⏳ Pending Rider Self-Registration Applications ({pendingDrivers.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              {pendingDrivers.map(d => (
                <div key={d.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '14px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem' }}>👤 {d.name}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>📞 {d.phone} • {d.vehicleType || 'Motorbike'} ({d.plateNumber || 'N/A'})</div>
                    <span className="badge badge-warning" style={{ marginTop: '6px', textTransform: 'uppercase', fontSize: '10px' }}>
                      Awaiting Admin Approval
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                    <button
                      className="btn btn-success"
                      onClick={() => handleApproveDriver(d.id, d.name, 'approve')}
                      disabled={loading}
                      style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700, background: '#10b981', color: '#fff', border: 'none' }}
                    >
                      ✓ Approve Driver
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleApproveDriver(d.id, d.name, 'reject')}
                      disabled={loading}
                      style={{ padding: '8px 12px', fontSize: '0.82rem', fontWeight: 700 }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* 1. Register New Delivery Driver Form */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 800 }}>➕ Register New Fleet Driver</h3>
          <form onSubmit={handleRegisterDriver} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Driver Full Name</label>
              <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kamal Perera" required />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Phone Number</label>
              <input className="form-input" type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0771234567" required />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Vehicle Type</label>
              <select className="form-input" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                <option value="Motorbike">🛵 Motorbike / Scooter</option>
                <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                <option value="Car">🚗 Car / Van</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Plate Number</label>
              <input className="form-input" type="text" value={plateNumber} onChange={e => setPlateNumber(e.target.value)} placeholder="e.g. WP BZ-9876" />
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', padding: '10px' }}>
                Register Driver
              </button>
            </div>
          </form>
        </div>

        {/* 2. Registered Drivers Fleet Roster */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 800 }}>🛵 Active Delivery Fleet ({drivers.length})</h3>
          {drivers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No registered drivers in fleet yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
              {drivers.map(d => (
                <div key={d.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', padding: '12px 16px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>🛵 {d.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>📞 {d.phone} • {d.vehicleType || 'Motorbike'} ({d.plateNumber || 'N/A'})</div>
                    <span className={`badge ${d.status === 'busy' ? 'badge-warning' : 'badge-success'}`} style={{ marginTop: '4px', textTransform: 'uppercase', fontSize: '10px' }}>
                      {d.status}
                    </span>
                  </div>
                  <button className="btn btn-danger" onClick={() => handleDeleteDriver(d.id, d.name)} style={{ padding: '4px 8px', fontSize: '12px' }}>
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Live Delivery Orders & Dispatch Cards */}
        <div>
          <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800 }}>📦 Active Delivery & Takeaway Orders</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {deliveryOrders.length === 0 ? (
              <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '12px', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                🛵 No active delivery or online takeaway orders.
              </div>
            ) : (
              deliveryOrders.map((ord) => {
                const assignedDrv = drivers.find(d => d.id === ord.driverId);
                const waLink = assignedDrv ? `https://wa.me/${assignedDrv.phone.replace(/[\s+-]/g, '')}?text=Delivery%20Order%20%23${ord.id.slice(-4).toUpperCase()}%20Address:%20${encodeURIComponent(ord.deliveryAddress || 'Store Pickup')}` : '#';

                return (
                  <div key={ord.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Order #{ord.id.slice(-4).toUpperCase()}</h3>
                      <span className={`badge ${ord.status === 'delivered' ? 'badge-success' : ord.status === 'ready' ? 'badge-warning' : 'badge-primary'}`} style={{ textTransform: 'uppercase' }}>
                        {ord.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div>👤 <strong>{ord.customerName || (ord.customerId ? ord.customerId.split('|')[0] : 'Guest Customer')}</strong></div>
                      {ord.customerPhone && <div>📞 {ord.customerPhone}</div>}
                      {ord.deliveryAddress && <div>📍 {ord.deliveryAddress}</div>}
                      <div>💰 Total: <strong>Rs. {ord.total?.toFixed(2)}</strong> ({ord.paymentMethod || 'COD'})</div>
                    </div>

                    {/* Driver Assignment Controls */}
                    <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>Assign Delivery Rider:</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          value={selectedDriver[ord.id] || ord.driverId || ''}
                          onChange={(e) => setSelectedDriver({ ...selectedDriver, [ord.id]: e.target.value })}
                          style={{ flex: 1, padding: '8px', borderRadius: '8px', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        >
                          <option value="">-- Select Driver --</option>
                          {activeDrivers.map(d => (
                            <option key={d.id} value={d.id}>
                              🛵 {d.name} ({d.phone}) — {d.status.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleAssignDriver(ord.id)}
                          disabled={loading}
                          style={{ padding: '8px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                        >
                          Assign Rider
                        </button>
                      </div>
                      {assignedDrv && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ background: '#25D366', color: '#fff', padding: '6px', fontSize: '0.78rem', textDecoration: 'none', textAlign: 'center', fontWeight: 700, borderRadius: '8px' }}
                        >
                          💬 Alert Rider {assignedDrv.name} via WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
