import React, { useState } from 'react';

export default function PendingOrderEmails() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/service-exceptions/order-emails', {
        headers: {Authorization: `Bearer ${localStorage.getItem('gastroflow_token')}`}, cache:'no-store'
      });
      if (!response.ok) throw new Error('Unable to load order email status.');
      setRows(await response.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  return <details className="card" style={{padding:16,marginBlock:12}} onToggle={event => {
    if (event.currentTarget.open && !rows && !loading) void refresh();
  }}>
    <summary>Pending customer order emails</summary>
    <p>Restaurant order updates awaiting email confirmation, oldest first.</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Checking email queue…</p>}
    {!error && rows?.length === 0 && <p>No pending order emails.</p>}
    {rows?.length > 0 && <ul>{rows.map(row =>
      <li key={JSON.stringify([row.orderId,row.status])}>
        {row.orderId} · {row.status.replaceAll('_',' ')} · {row.attempts} delivery attempts
      </li>
    )}</ul>}
    <button className="btn btn-secondary" disabled={loading} onClick={refresh}>Refresh status</button>
  </details>;
}
