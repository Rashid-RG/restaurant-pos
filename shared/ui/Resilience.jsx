import React, { useEffect, useState } from 'react';

export function ConnectionStatus({ compact = false }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  if (compact) return <span className={`gf-connection ${online ? '' : 'is-offline'}`} role="status"><span />{online ? 'Connected' : 'Offline'}</span>;
  return online ? null : <div className="gf-offline-banner" role="status">You’re offline. Your current view is still available. Reconnect before submitting an order or payment.</div>;
}

export class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[Application error]', error); }
  render() {
    if (this.state.failed) return <main className="gf-recovery" role="alert"><span>GastroFlow</span><h1>Let’s get you back on track.</h1><p>This screen could not load. Refresh to try again. If you were making a payment, check your order status before retrying.</p><button onClick={() => location.reload()}>Reload application</button></main>;
    return this.props.children;
  }
}
