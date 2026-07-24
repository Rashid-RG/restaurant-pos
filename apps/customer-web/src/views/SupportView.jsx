import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';

export default function SupportView({ onBack, toast = () => {} }) {
  const { t } = useLang();
  const { customer } = useCustomerAuth();

  const [issueCategory, setIssueCategory] = useState('order_delay');
  const [orderIdInput, setOrderIdInput] = useState('');
  const [nameInput, setNameInput] = useState(customer?.name || '');
  const [phoneInput, setPhoneInput] = useState(customer?.phone || '');
  const [emailInput, setEmailInput] = useState(customer?.email || '');
  const [messageInput, setMessageInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [myTickets, setMyTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const fetchTickets = async () => {
    const contact = customer?.phone || customer?.email || phoneInput || emailInput;
    if (!contact) return;
    setLoadingTickets(true);
    try {
      const isEmail = contact.includes('@');
      const data = await apiFetch(`/public/support/tickets?${isEmail ? `email=${encodeURIComponent(contact)}` : `phone=${encodeURIComponent(contact)}`}`);
      setMyTickets(data || []);
    } catch (_) {
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [customer?.id]);

  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    if (!messageInput.trim()) {
      toast('Please describe your issue or question.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/public/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          orderId: orderIdInput.trim() || null,
          name: nameInput.trim() || customer?.name || 'Customer',
          phone: phoneInput.trim() || customer?.phone || null,
          email: emailInput.trim() || customer?.email || null,
          issueCategory,
          message: messageInput.trim()
        })
      });

      toast(`✅ Support Ticket #${res.ticketId} Created!`, 'success');
      setMessageInput('');
      fetchTickets();
    } catch (err) {
      toast(err.message || 'Failed to submit support ticket', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const waText = encodeURIComponent(`🚨 Customer Help Request: Hi GastroFlow Support, I need assistance with my order/account.`);
  const waLink = `https://wa.me/94112345678?text=${waText}`;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px', color: 'var(--text-1)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '6px 12px', color: 'var(--text-1)', cursor: 'pointer', fontWeight: 700 }}
            >
              ← Back
            </button>
          )}
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900 }}>🎧 Customer Support Desk</h2>
        </div>
      </div>

      {/* Direct Escalation Quick Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <div style={{ background: '#25D36615', border: '1px solid #25D36650', borderRadius: 14, padding: 16, textAlign: 'center', color: '#25D366', cursor: 'pointer' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>💬</div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>WhatsApp Live Support</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>Instant Response</div>
          </div>
        </a>

        <a href="tel:+94112345678" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#3b82f615', border: '1px solid #3b82f650', borderRadius: 14, padding: 16, textAlign: 'center', color: '#3b82f6', cursor: 'pointer' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>📞</div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Call Store Manager</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>+94 11 234 5678</div>
          </div>
        </a>
      </div>

      {/* New Support Ticket Form */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 20, marginBottom: 24, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📩</span> Submit a Support Ticket
        </h3>

        <form onSubmit={handleSubmitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Select Issue Category:
            </label>
            <select
              value={issueCategory}
              onChange={e => setIssueCategory(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.9rem', fontWeight: 600 }}
            >
              <option value="order_delay">🛵 Order Delay / Late Delivery</option>
              <option value="food_quality">🍲 Food Quality / Wrong Item</option>
              <option value="payment_refund">💳 Payment / Refund Query</option>
              <option value="cancellation">❌ Order Cancellation Request</option>
              <option value="general">❓ General Inquiry</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Order ID (Optional):</label>
              <input
                type="text"
                placeholder="e.g. ord_online_1234"
                value={orderIdInput}
                onChange={e => setOrderIdInput(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Contact Phone / Email:</label>
              <input
                type="text"
                placeholder="e.g. 0771234567 or email"
                value={phoneInput || emailInput}
                onChange={e => { setPhoneInput(e.target.value); setEmailInput(e.target.value); }}
                style={{ width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Describe Your Issue:</label>
            <textarea
              rows={4}
              placeholder="Tell us what went wrong or how we can help you..."
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.88rem', resize: 'vertical' }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 10,
              background: '#ff6b35',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.95rem',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(255,107,53,0.3)'
            }}
          >
            {submitting ? 'Submitting Ticket...' : '📩 Send Ticket to Restaurant Manager'}
          </button>
        </form>
      </div>

      {/* My Support Tickets List */}
      <div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📋</span> My Support Tickets ({myTickets.length})
        </h3>

        {loadingTickets ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading tickets...</div>
        ) : myTickets.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 12, textAlign: 'center', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
            No support tickets submitted yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {myTickets.map(t => (
              <div key={t.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#ff6b35' }}>Ticket #{t.id}</span>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: 12,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: t.status === 'resolved' ? '#10b98120' : '#f59e0b20',
                    color: t.status === 'resolved' ? '#10b981' : '#f59e0b'
                  }}>
                    {t.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>{t.message}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Submitted: {new Date(t.createdAt).toLocaleString()} {t.orderId ? `· Order: #${t.orderId}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
