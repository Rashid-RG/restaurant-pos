import React, { useState, useEffect } from 'react';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import LoginRegisterView from './LoginRegisterView.jsx';
import { apiFetch } from '../utils/api.js';

export default function ProfileView({ toast, resetToken, onResetHandled }) {
  const { customer, logout, refreshProfile, getToken } = useCustomerAuth();
  const { t, dict } = useLang();
  const { addItem, setCartOpen } = useCart();
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Saved Addresses & Cards states
  const [addresses, setAddresses] = useState([]);
  const [cards, setCards] = useState([]);
  const [newAddress, setNewAddress] = useState('');
  const [newCardNum, setNewCardNum] = useState('');
  const [newCardExpiry, setNewCardExpiry] = useState('');

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone || '');
      fetchOrders();
      fetchAddresses();
      fetchCards();
    }
  }, [customer]);

  const fetchOrders = async () => {
    const token = getToken();
    if (!token) return;
    setLoadingOrders(true);
    try {
      const data = await apiFetch('/customer/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(data);
    } catch {} finally {
      setLoadingOrders(false);
    }
  };

  const fetchAddresses = async () => {
    try {
      const data = await apiFetch('/customer/addresses');
      setAddresses(data || []);
    } catch {}
  };

  const fetchCards = async () => {
    try {
      const data = await apiFetch('/customer/cards');
      setCards(data || []);
    } catch {}
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/customer/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ name, phone, password: password || undefined })
      });
      await refreshProfile();
      setEditMode(false);
      setPassword('');
      toast('Profile updated! ✓', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAddress = async (e) => {
    e.preventDefault();
    if (!newAddress.trim()) return;
    try {
      await apiFetch('/customer/addresses', {
        method: 'POST',
        body: JSON.stringify({ addressLine: newAddress.trim(), isDefault: addresses.length === 0 ? 1 : 0 })
      });
      setNewAddress('');
      toast('Address saved successfully! ✓', 'success');
      fetchAddresses();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleAddCard = async (e) => {
    e.preventDefault();
    if (!newCardNum.trim()) return;
    const cleanNum = newCardNum.replace(/\s+/g, '');
    if (cleanNum.length < 12) {
      toast('Please enter a valid card number.', 'error');
      return;
    }
    const lastFour = cleanNum.slice(-4);
    const cardType = cleanNum.startsWith('4') ? 'Visa' : cleanNum.startsWith('5') ? 'Mastercard' : 'Amex';
    try {
      await apiFetch('/customer/cards', {
        method: 'POST',
        body: JSON.stringify({
          cardToken: `tok_${Date.now()}`,
          cardType,
          lastFour,
          expiry: newCardExpiry.trim() || '12/28'
        })
      });
      setNewCardNum('');
      setNewCardExpiry('');
      toast('Card saved successfully! ✓', 'success');
      fetchCards();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleReorder = (order) => {
    if (!order.items || order.items.length === 0) return;
    order.items.forEach(item => {
      addItem({
        id: item.menuItemId || item.id,
        name: item.name,
        price: item.price,
        emoji: item.emoji || '🍽️'
      }, item.quantity, [], ''); // Default empty modifiers/notes for clean reorder
    });
    toast('Items added to cart! Reorder prefilled. 🛒', 'success');
    setCartOpen(true);
  };

  const handleCancelOrder = async (orderId) => {
    if (!window.confirm('Are you sure you want to cancel this pending order? Items and stock will be restored.')) return;
    try {
      const res = await apiFetch(`/public/orders/${orderId}/cancel`, {
        method: 'POST'
      });
      if (res && (res.success || res.status === 'cancelled')) {
        toast('Order cancelled successfully! Stock restored. 🚫', 'success');
        fetchOrders();
      } else {
        toast(res.error || 'Could not cancel order.', 'error');
      }
    } catch (err) {
      toast(err.message || 'Failed to cancel order.', 'error');
    }
  };

  if (!customer) {
    return <LoginRegisterView onSuccess={refreshProfile} toast={toast} resetToken={resetToken} onResetHandled={onResetHandled} />;
  }

  const initials = customer.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="profile-page fade-in" style={{ padding: '20px 16px 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="profile-avatar" style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--brand)', color: '#fff', fontSize: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          {initials || '👤'}
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>{customer.name}</h2>
        <p className="text-muted" style={{ margin: '4px 0 0' }}>{customer.email}</p>
      </div>

      {/* Loyalty Points Card */}
      <div style={{
        background: 'linear-gradient(135deg, var(--brand) 0%, #6b48ff 100%)',
        borderRadius: '12px', padding: '20px', color: '#fff', marginBottom: 16, textAlign: 'center'
      }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>Loyalty Balance</div>
        <div style={{ fontSize: '2.5rem', fontWeight: 800 }}>{customer.loyaltyPoints || 0}</div>
        <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: 4 }}>
          ≈ Rs. {Math.floor((customer.loyaltyPoints || 0) / 100).toFixed(2)} off your next bill
        </div>
        <div style={{ marginTop: 12, fontSize: '0.75rem', opacity: 0.6 }}>
          Total Account Spending: Rs. {(customer.totalSpent || 0).toFixed(2)}
        </div>
      </div>

      {/* Profile Info */}
      {!editMode ? (
        <div className="profile-card" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16 }}>
          <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span className="info-label" style={{ color: 'var(--text-muted)' }}>Name</span>
            <span className="info-value" style={{ fontWeight: 600 }}>{customer.name}</span>
          </div>
          <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span className="info-label" style={{ color: 'var(--text-muted)' }}>Email</span>
            <span className="info-value" style={{ fontWeight: 600 }}>{customer.email}</span>
          </div>
          <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span className="info-label" style={{ color: 'var(--text-muted)' }}>Phone</span>
            <span className="info-value" style={{ fontWeight: 600 }}>{customer.phone || '—'}</span>
          </div>
          <button className="btn btn-outline mt-12" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={() => setEditMode(true)}>✏️ {t.editProfile}</button>
        </div>
      ) : (
        <div className="profile-card" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16 }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: 12 }}>Edit Profile</h3>
          <form onSubmit={handleSave} noValidate>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Full Name</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Phone</label>
              <input className="form-control" type="text" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>New Password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to keep)</span></label>
              <input className="form-control" type="password" placeholder="Minimum 6 characters"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
              <button type="submit" className="btn btn-brand" disabled={saving}>{saving ? '⏳ Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Saved Addresses list */}
      <div className="profile-card" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 12 }}>📍 {t.savedAddresses}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {addresses.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No saved delivery addresses.</p>
          ) : (
            addresses.map(a => (
              <div key={a.id} style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.01)', borderRadius: 8, fontSize: '0.82rem', border: '1px solid var(--border-color)' }}>
                {a.addressLine} {a.isDefault === 1 && <span style={{ color: 'var(--brand)', fontWeight: 700, marginLeft: 6 }}>(Default)</span>}
              </div>
            ))
          )}
        </div>
        <form onSubmit={handleAddAddress} style={{ display: 'flex', gap: 8 }}>
          <input className="form-control" placeholder="Add new delivery address..." value={newAddress} onChange={e => setNewAddress(e.target.value)} />
          <button className="btn btn-brand" type="submit" style={{ width: 'auto', padding: '0 16px' }}>Add</button>
        </form>
      </div>

      {/* Saved Cards list */}
      <div className="profile-card" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 12 }}>💳 {t.savedCards}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {cards.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No saved payment cards.</p>
          ) : (
            cards.map(c => (
              <div key={c.id} style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.01)', borderRadius: 8, fontSize: '0.82rem', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                <span>💳 {c.cardType} ending in {c.lastFour}</span>
                <span style={{ color: 'var(--text-muted)' }}>Exp: {c.expiry}</span>
              </div>
            ))
          )}
        </div>
        <form onSubmit={handleAddCard} style={{ display: 'flex', gap: 8 }}>
          <input className="form-control" type="text" inputMode="numeric" autoComplete="cc-number" placeholder="Card number..." value={newCardNum} onChange={e => setNewCardNum(e.target.value)} />
          <input className="form-control" style={{ width: '80px' }} placeholder="MM/YY" value={newCardExpiry} onChange={e => setNewCardExpiry(e.target.value)} />
          <button className="btn btn-brand" type="submit" style={{ width: 'auto', padding: '0 16px' }}>Save</button>
        </form>
      </div>

      {/* Order History */}
      <div className="profile-card" style={{ background: 'var(--bg-card)', padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 12 }}>📋 {t.orderHistory}</h3>
        {loadingOrders ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '16px 0' }}>No orders yet. Start ordering! 🍽️</p>
        ) : (
          orders.map(order => (
            <div key={order.id} style={{
              borderBottom: '1px solid var(--border-color)', paddingBottom: 10, marginBottom: 10
            }}>
              <div className="flex-between" style={{ marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--brand)', fontWeight: 700 }}>
                  {order.id.slice(0, 20)}…
                </span>
                <span className={`chip chip-${order.status === 'paid' || order.status === 'completed' ? 'green' : 'orange'}`} style={{ fontSize: '0.68rem', padding: '2px 8px' }}>{order.status.toUpperCase()}</span>
              </div>
              <div className="flex-between" style={{ fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(order.timestamp).toLocaleDateString()} · {order.orderType || order.diningType}
                </span>
                <span style={{ fontWeight: 800, color: 'var(--brand)' }}>Rs. {order.total?.toFixed(0)}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {order.items?.map(i => `${i.name} ×${i.quantity}`).join(', ')}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem', width: 'auto' }} onClick={() => handleReorder(order)}>
                  🔄 Reorder
                </button>
                {order.status === 'pending' && (
                  <button
                    className="btn btn-danger"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      width: 'auto',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                    onClick={() => handleCancelOrder(order.id)}
                  >
                    🚫 Cancel Order
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Sign Out */}
      <button className="btn btn-danger mt-12" style={{ width: '100%', padding: 12 }} onClick={logout}>🚪 {t.logout}</button>
    </div>
  );
}
