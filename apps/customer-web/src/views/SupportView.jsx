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

  // OTP Verification for Unregistered Guest Users
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [otpSending, setOtpSending] = useState(false);

  const [myTickets, setMyTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [activeTicket, setActiveTicket] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const fetchTickets = async () => {
    const contact = customer?.phone || customer?.email || phoneInput || emailInput || localStorage.getItem('gastroflow_guest_contact');
    if (!contact) return;
    setLoadingTickets(true);
    try {
      const isEmail = contact.includes('@');
      const data = await apiFetch(`/customer/support/tickets?${isEmail ? `email=${encodeURIComponent(contact)}` : `phone=${encodeURIComponent(contact)}`}`);
      setMyTickets(data || []);
    } catch (_) {
    } finally {
      setLoadingTickets(false);
    }
  };

  const fetchMessages = async (ticketId) => {
    try {
      const data = await apiFetch(`/public/support/tickets/${ticketId}/messages`);
      setThreadMessages(data || []);
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  useEffect(() => {
    fetchTickets();

    // Subscribe to SSE for real-time ticket & reply updates
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const es = new EventSource(`${API_BASE}/api/events`);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'support_ticket_updated') {
          fetchTickets();
          if (activeTicket && payload.data?.ticketId === activeTicket.id) {
            fetchMessages(activeTicket.id);
            toast(`💬 New message on Ticket #${activeTicket.id}!`, 'info');
          }
        }
      } catch (_) {}
    };

    return () => es.close();
  }, [customer?.id, activeTicket]);

  const handleSendOtp = async () => {
    const target = emailInput.trim() || phoneInput.trim();
    if (!target) {
      toast('Please enter your phone number or email address for verification.', 'warning');
      return;
    }
    setOtpSending(true);
    try {
      const isEmail = target.includes('@');
      const r = await apiFetch('/otp/send', {
        method: 'POST',
        body: JSON.stringify({ channel: isEmail ? 'email' : 'sms', destination: target, purpose: 'guest_support' })
      });
      if (r.otpCode) {
        setOtpCodeInput(r.otpCode);
        toast(`Verification code: ${r.otpCode} (Auto-filled)`, 'success');
      } else {
        toast(`Verification code sent to ${target}`, 'info');
      }
      setShowOtpStep(true);
    } catch (err) {
      toast(err.message || 'Failed to send OTP code.', 'error');
    } finally {
      setOtpSending(false);
    }
  };

  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    if (!messageInput.trim()) {
      toast('Please describe your issue or question.', 'warning');
      return;
    }

    const contact = customer?.phone || customer?.email || phoneInput.trim() || emailInput.trim();
    if (!customer && !contact) {
      toast('Please provide your name and phone number or email.', 'warning');
      return;
    }

    // Guest verification requirement
    if (!customer && !showOtpStep) {
      await handleSendOtp();
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/customer/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          orderId: orderIdInput.trim() || null,
          name: nameInput.trim() || customer?.name || 'Customer',
          phone: phoneInput.trim() || customer?.phone || null,
          email: emailInput.trim() || customer?.email || null,
          issueCategory,
          message: messageInput.trim(),
          otpCode: otpCodeInput.trim() || undefined
        })
      });

      toast(`✅ Support Ticket #${res.ticketId} Created!`, 'success');
      if (contact) localStorage.setItem('gastroflow_guest_contact', contact);
      setMessageInput('');
      setShowOtpStep(false);
      setOtpCodeInput('');
      fetchTickets();
    } catch (err) {
      toast(err.message || 'Failed to submit support ticket', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenThread = (ticket) => {
    setActiveTicket(ticket);
    fetchMessages(ticket.id);
  };

  const handleSendThreadReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !activeTicket) return;
    setSendingReply(true);
    try {
      await apiFetch(`/public/support/tickets/${activeTicket.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message: replyText.trim(),
          senderType: 'customer',
          senderName: customer?.name || nameInput || 'Customer'
        })
      });
      toast('Reply sent!', 'success');
      setReplyText('');
      fetchMessages(activeTicket.id);
    } catch (err) {
      toast(err.message || 'Failed to send reply', 'error');
    } finally {
      setSendingReply(false);
    }
  };

 

  const [storeInfo, setStoreInfo] = useState({ name: 'GastroFlow Bistro', phone: '0752237947' });

  useEffect(() => {
    apiFetch('/public/menu')
      .then(data => {
        if (data) {
          setStoreInfo({
            name: data.restaurantName || 'GastroFlow Bistro',
            phone: data.storePhone || '0752237947'
          });
        }
      })
      .catch(() => {});
  }, []);

  const cleanPhone = storeInfo.phone.replace(/\D/g, '');
  const waPhone = cleanPhone.startsWith('0') ? '94' + cleanPhone.slice(1) : cleanPhone;
  const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${storeInfo.name}, I have an order enquiry.`)}`;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px', color: 'var(--text-1)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => onBack ? onBack() : (window.history.length > 1 ? window.history.back() : null)}
            style={{
              background: 'rgba(255,107,53,0.12)',
              border: '1px solid rgba(255,107,53,0.3)',
              color: '#ff6b35',
              borderRadius: 10,
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            ← Back
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900 }}>🎧 Store Customer Support</h2>
            <div style={{ fontSize: '0.78rem', color: 'var(--brand)', fontWeight: 700, marginTop: 2 }}>
              🏪 Active Store: {storeInfo.name}
            </div>
          </div>
        </div>
      </div>

      {/* Direct Store Hotline Quick Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#25D36615', border: '1px solid #25D36650', borderRadius: 14, padding: 16, textAlign: 'center', color: '#25D366', cursor: 'pointer' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>💬</div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>WhatsApp Store Desk</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>{storeInfo.phone}</div>
          </div>
        </a>

        <a href={`tel:${storeInfo.phone}`} style={{ textDecoration: 'none' }}>
          <div style={{ background: '#3b82f615', border: '1px solid #3b82f650', borderRadius: 14, padding: 16, textAlign: 'center', color: '#3b82f6', cursor: 'pointer' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>📞</div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Call Store Hotline</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>{storeInfo.phone}</div>
          </div>
        </a>
      </div>

      {/* New Support Ticket Form */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 20, marginBottom: 24, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📩</span> Submit a Support Ticket / Inquiry
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
              <option value="careers">💼 Careers / Job Opportunity</option>
              <option value="general">❓ General Inquiry</option>
            </select>
          </div>

          {!customer && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Your Full Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Kamal Perera"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Phone or Email:</label>
                <input
                  type="text"
                  placeholder="e.g. 0760130922 or email"
                  value={phoneInput || emailInput}
                  onChange={e => { setPhoneInput(e.target.value); setEmailInput(e.target.value); }}
                  style={{ width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.85rem' }}
                />
              </div>
            </div>
          )}

          {showOtpStep && !customer && (
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: 10, padding: 12 }}>
              <label style={{ fontSize: '0.8rem', color: '#818cf8', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                🔒 Enter 6-digit OTP Verification Code:
              </label>
              <input
                type="text"
                placeholder="6-digit code"
                value={otpCodeInput}
                onChange={e => setOtpCodeInput(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid #818cf8', color: 'var(--text-1)', fontSize: '1rem', fontWeight: 800, textAlign: 'center' }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>Describe Your Question or Issue:</label>
            <textarea
              rows={4}
              placeholder="Tell us how we can help you..."
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.88rem', resize: 'vertical' }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || otpSending}
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
            {submitting ? 'Submitting Ticket...' : showOtpStep ? '✅ Verify OTP & Submit Ticket' : '📩 Send Ticket to Support Team'}
          </button>
        </form>
      </div>

      {/* My Support Tickets List */}
      <div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📋</span> My Support Tickets & Live Chat ({myTickets.length})
        </h3>

        {loadingTickets ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading tickets...</div>
        ) : myTickets.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 12, textAlign: 'center', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
            No support tickets submitted yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {myTickets.map(t => (
              <div
                key={t.id}
                onClick={() => handleOpenThread(t)}
                style={{
                  background: activeTicket?.id === t.id ? 'var(--bg-surface)' : 'var(--bg-card)',
                  border: activeTicket?.id === t.id ? '2px solid #ff6b35' : '1px solid var(--border-color)',
                  borderRadius: 12,
                  padding: 14,
                  cursor: 'pointer'
                }}
              >
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

      {/* Active Ticket Live Chat Modal / Drawer */}
      {activeTicket && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 16, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>💬 Live Chat Thread — Ticket #{activeTicket.id}</h4>
            <button onClick={() => setActiveTicket(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}>✕ Close</button>
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            {threadMessages.map(m => {
              const isCust = m.senderType === 'customer';
              return (
                <div key={m.id} style={{ alignSelf: isCust ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: isCust ? 'right' : 'left' }}>
                    {m.senderName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{
                    background: isCust ? '#ff6b35' : 'var(--bg-surface)',
                    color: isCust ? '#fff' : 'var(--text-1)',
                    padding: '8px 12px',
                    borderRadius: 12,
                    fontSize: '0.85rem'
                  }}>
                    {m.message}
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSendThreadReply} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              type="text"
              placeholder="Type message to support staff..."
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.85rem' }}
              disabled={sendingReply}
            />
            <button type="submit" style={{ padding: '8px 14px', borderRadius: 8, background: '#ff6b35', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }} disabled={sendingReply || !replyText.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
