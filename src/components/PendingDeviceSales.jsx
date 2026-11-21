import React, { useState } from 'react';
import { flushOfflineQueue, getOfflineQueue } from '../utils/offlineSync.js';

export default function PendingDeviceSales() {
  const [sales, setSales] = useState(getOfflineQueue);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!sales.length && !result) return null;

  async function retry() {
    setBusy(true);
    try {
      setResult(await flushOfflineQueue());
      setSales(getOfflineQueue());
    } finally { setBusy(false); }
  }

  return (
    <section className="card" style={{padding:16, marginBlock:12}} aria-label="Offline sales on this till">
      <h2>Offline sales on this till</h2>
      {sales.length > 0 && <p>These cash sales are waiting for server confirmation. Keep this browser’s saved data until they are reconciled.</p>}
      <ul>{sales.map(sale => {
        const conflict = result?.conflicts?.find(row => row.offlineId === sale.offlineId);
        return <li key={sale.offlineId}>
          <strong>LKR {Number(sale.total).toFixed(2)}</strong> · {sale.offlineId}
          {conflict && <p>{conflict.reason}</p>}
        </li>;
      })}</ul>
      {sales.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={retry}>{busy ? 'Checking sales…' : 'Retry pending sales'}</button>}
      <p role="status">{result?.error || (result && (sales.length ? `${sales.length} pending on this till.` : 'All queued sales acknowledged.'))}</p>
    </section>
  );
}
