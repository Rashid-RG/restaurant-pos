import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function SupportTicketsView() {
  const { showToast } = usePOS();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/tickets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (ticketId) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setThreadMessages(data);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  useEffect(() => {
    fetchTickets();

    // Subscribe to Real-Time SSE updates for instant ticket alerts
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const es = new EventSource(`${API_BASE}/api/events`);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'support_ticket_created' || payload.type === 'support_ticket_updated') {
          showToast(`🎧 Live Support Alert: ${payload.data?.message || 'New ticket update!'}`, 'info');
          fetchTickets();
          if (selectedTicket && payload.data?.ticketId === selectedTicket.id) {
            fetchMessages(selectedTicket.id);
          }
        }
      } catch (_) {}
    };

    return () => es.close();
  }, [selectedTicket]);

  const handleOpenThread = (tkt) => {
    setSelectedTicket(tkt);
    fetchMessages(tkt.id);
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicket) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: replyText.trim(),
          senderType: 'staff',
          senderName: 'Store Manager'
        })
      });
      if (res.ok) {
        showToast('Reply sent to customer live!', 'success');
        setReplyText('');
        fetchMessages(selectedTicket.id);
        fetchTickets();
      }
    } catch (err) {
      showToast('Error sending reply: ' + err.message, 'error');
    } finally {
      setSendingReply(false);
    }
  };

  const handleResolveTicket = async (ticketId) => {
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/tickets/${ticketId}/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to resolve ticket');
      showToast(`Ticket #${ticketId} marked as resolved!`, 'success');
      fetchTickets();
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket(prev => prev ? { ...prev, status: 'resolved' } : null);
      }
    } catch (err) {
      showToast('Error resolving ticket: ' + err.message, 'error');
    }
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>🎧 Customer Complaints & Support Desk</h1>
          <p>Real-time inbox for customer complaints, live chat threads, and AI escalation tickets.</p>
        </div>
      </div>

      <div className="view-body" style={{ padding: '20px 0', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        
        {/* Ticket List */}
        <div style={{ flex: 1, minWidth: '320px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading support tickets...</div>
          ) : tickets.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '12px', color: 'var(--text-muted)' }}>
              🎉 No open support tickets or customer complaints!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {tickets.map(tkt => {
                const phone = tkt.customerPhone || '0760130922';
                const waLink = `https://wa.me/${phone.replace(/[\s+-]/g, '')}?text=Hello%20${encodeURIComponent(tkt.customerName || 'Customer')},%20regarding%20your%20support%20ticket%20%23${tkt.id}`;
                const isSelected = selectedTicket?.id === tkt.id;

                return (
                  <div
                    key={tkt.id}
                    onClick={() => handleOpenThread(tkt)}
                    style={{
                      background: isSelected ? 'var(--bg-surface)' : 'var(--bg-card)',
                      border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Ticket #{tkt.id}</h3>
                        <span className={`badge ${tkt.status === 'resolved' ? 'badge-success' : 'badge-danger'}`} style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                          {tkt.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        ⏰ {new Date(tkt.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 600 }}>
                      👤 {tkt.customerName || 'Customer'} {tkt.customerPhone && `(📞 ${tkt.customerPhone})`}
                    </div>

                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--color-primary)' }}>
                      💬 "{tkt.message || 'Support request'}"
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="btn btn-secondary"
                        style={{ background: '#25D366', color: '#fff', padding: '6px 10px', fontSize: '0.78rem', textDecoration: 'none', borderRadius: '6px', fontWeight: 700 }}
                      >
                        💬 WhatsApp
                      </a>
                      {tkt.status !== 'resolved' && (
                        <button
                          className="btn btn-primary"
                          onClick={(e) => { e.stopPropagation(); handleResolveTicket(tkt.id); }}
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                        >
                          ✓ Resolve
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Chat Thread Drawer */}
        {selectedTicket && (
          <div style={{ flex: 1, minWidth: '320px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', height: '600px' }}>
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>💬 Live Thread #{selectedTicket.id}</h3>
                <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setSelectedTicket(null)}>✕ Close</button>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Customer: <strong>{selectedTicket.customerName}</strong> ({selectedTicket.customerPhone || 'Verified'})
              </div>
            </div>

            {/* Chat Messages */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '6px' }}>
              {threadMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px', fontSize: '0.85rem' }}>No messages yet in this thread.</div>
              ) : (
                threadMessages.map(msg => {
                  const isStaff = msg.senderType === 'staff';
                  return (
                    <div key={msg.id} style={{ alignSelf: isStaff ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px', textAlign: isStaff ? 'right' : 'left' }}>
                        {msg.senderName || (isStaff ? 'Staff' : 'Customer')} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{
                        background: isStaff ? 'var(--color-primary)' : 'var(--bg-surface)',
                        color: isStaff ? '#fff' : 'var(--text-main)',
                        padding: '10px 14px',
                        borderRadius: isStaff ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                        fontSize: '0.88rem',
                        lineHeight: 1.4,
                        border: isStaff ? 'none' : '1px solid var(--border-color)'
                      }}>
                        {msg.message}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply Input */}
            <form onSubmit={handleSendReply} style={{ display: 'flex', gap: '8px', marginTop: '14px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
              <input
                type="text"
                className="input"
                placeholder="Type reply to customer..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                style={{ flex: 1, borderRadius: '20px', padding: '10px 16px', fontSize: '0.88rem' }}
                disabled={sendingReply}
              />
              <button type="submit" className="btn btn-primary" style={{ borderRadius: '20px', padding: '10px 18px', fontWeight: 700 }} disabled={sendingReply || !replyText.trim()}>
                Send 🚀
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
