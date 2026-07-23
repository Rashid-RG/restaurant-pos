import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function SupportTicketsView() {
  const { showToast } = usePOS();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchTickets();
  }, []);

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
    } catch (err) {
      showToast('Error resolving ticket: ' + err.message, 'error');
    }
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>🎧 Customer Complaints & Support Desk</h1>
          <p>Real-time inbox for customer complaints, AI escalation tickets, and support requests.</p>
        </div>
      </div>

      <div className="view-body" style={{ padding: '20px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading support tickets...</div>
        ) : tickets.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '12px', color: 'var(--text-muted)' }}>
            🎉 No open support tickets or customer complaints!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {tickets.map(tkt => {
              const phone = tkt.customerPhone || '94112345678';
              const waLink = `https://wa.me/${phone.replace(/[\s+-]/g, '')}?text=Hello%20${encodeURIComponent(tkt.customerName || 'Customer')},%20regarding%20your%20support%20ticket%20%23${tkt.id}`;
              return (
                <div key={tkt.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Ticket #{tkt.id}</h3>
                      <span className={`badge ${tkt.status === 'resolved' ? 'badge-success' : 'badge-danger'}`} style={{ textTransform: 'uppercase' }}>
                        {tkt.status}
                      </span>
                      {tkt.orderId && <span className="badge badge-info">Order #{tkt.orderId.slice(-4).toUpperCase()}</span>}
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', fontWeight: 600 }}>
                      👤 {tkt.customerName || 'Customer'} {tkt.customerPhone && `(📞 ${tkt.customerPhone})`}
                    </div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--color-primary)' }}>
                      💬 "{tkt.issue || tkt.description || 'Support request via GastroAI'}"
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ⏰ Submitted: {new Date(tkt.timestamp).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary"
                      style={{ background: '#25D366', color: '#fff', padding: '8px 14px', fontSize: '0.82rem', textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}
                    >
                      💬 WhatsApp Customer
                    </a>
                    {tkt.status !== 'resolved' && (
                      <button
                        className="btn btn-primary"
                        onClick={() => handleResolveTicket(tkt.id)}
                        style={{ padding: '8px 14px', fontSize: '0.82rem' }}
                      >
                        ✓ Mark Resolved
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
