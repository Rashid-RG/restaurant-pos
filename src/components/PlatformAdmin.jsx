import PlatformOperations from './PlatformOperations';
import React, { useEffect, useState } from 'react';
import { 
  Store, Plus, RefreshCw, Search, ShieldCheck, X, Key, Copy, Check, 
  Eye, EyeOff, Lock, ExternalLink, ShieldAlert, BarChart3, Radio, 
  Palette, Send, ArrowRightCircle, Megaphone, DollarSign, Building2
} from 'lucide-react';
import { usePOS } from '../context/POSContext';
import './platform.css';

export default function PlatformAdmin({ embedded = false }) {
  const { currentUser, showToast } = usePOS();
  const [activeSubTab, setActiveSubTab] = useState('restaurants'); // 'restaurants' | 'credentials' | 'analytics' | 'broadcasts' | 'branding' | 'operations'
  const [restaurants, setRestaurants] = useState([]);
  const [credentialsList, setCredentialsList] = useState([]);
  const [plans, setPlans] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [credLoading, setCredLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [created, setCreated] = useState(null);

  // Platform Analytics State
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Broadcasts State
  const [broadcastsList, setBroadcastsList] = useState([]);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastType, setBroadcastType] = useState('info');
  const [broadcastHours, setBroadcastHours] = useState('24');
  const [broadcastBusy, setBroadcastBusy] = useState(false);

  // Branding Settings State
  const [brandingSettings, setBrandingSettings] = useState({
    platformName: 'GastroFlow',
    platformCompany: 'RS Technologies',
    platformSlogan: 'Smarter Dining Operations & Cloud POS',
    platformLogoUrl: '/gastroflow-brand.svg?v=1',
    commissionRate: '15',
    supportEmail: 'support@gastroflow.lk'
  });
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [brandingBusy, setBrandingBusy] = useState(false);

  // Password reset modal state
  const [resetModalTenant, setResetModalTenant] = useState(null);
  const [customPassword, setCustomPassword] = useState('');
  const [customPin, setCustomPin] = useState('');
  const [autoGen, setAutoGen] = useState(true);
  const [resetSuccessData, setResetSuccessData] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [visiblePins, setVisiblePins] = useState({});

  const request = async (path, options = {}) => {
    try {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('gastroflow_token')}`
        }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new Error('Server is waking up (Render free tier). Please wait a few seconds and try again.');
        }
        throw new Error(`Server returned status ${response.status}. Please try again.`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not complete this request.');
      return data;
    } catch (err) {
      if (err.message && (err.message.includes('<!DOCTYPE') || err.message.includes('Unexpected token'))) {
        throw new Error('Server connection was interrupted or server is warming up. Please try again.');
      }
      throw err;
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, available] = await Promise.all([
        request('/api/saas/tenants'),
        request('/api/saas/plans')
      ]);
      setRestaurants(Array.isArray(rows) ? rows : []);
      setPlans(Array.isArray(available) ? available : available.plans || []);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCredentials = async () => {
    setCredLoading(true);
    try {
      const creds = await request('/api/saas/tenants/credentials');
      setCredentialsList(Array.isArray(creds) ? creds : []);
    } catch (err) {
      showToast(err.message || 'Could not load credentials list.', 'error');
    } finally {
      setCredLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const data = await request('/api/platform/analytics');
      setAnalyticsData(data);
    } catch (err) {
      showToast(err.message || 'Could not load platform analytics.', 'error');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const loadBroadcasts = async () => {
    setBroadcastLoading(true);
    try {
      const list = await request('/api/platform/broadcasts');
      setBroadcastsList(Array.isArray(list) ? list : []);
    } catch (err) {
      showToast(err.message || 'Could not load broadcasts.', 'error');
    } finally {
      setBroadcastLoading(false);
    }
  };

  const loadBranding = async () => {
    setBrandingLoading(true);
    try {
      const data = await request('/api/platform/settings');
      if (data && Object.keys(data).length > 0) {
        setBrandingSettings(prev => ({ ...prev, ...data }));
      }
    } catch (err) {
      showToast(err.message || 'Could not load platform branding settings.', 'error');
    } finally {
      setBrandingLoading(false);
    }
  };

  const handleSendBroadcast = async (e) => {
    e.preventDefault();
    if (!broadcastMsg.trim() || broadcastBusy) return;
    setBroadcastBusy(true);
    try {
      await request('/api/platform/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          message: broadcastMsg.trim(),
          type: broadcastType,
          expiresInHours: Number(broadcastHours) || 24
        })
      });
      showToast('📢 Broadcast announcement sent live to all restaurant terminals!', 'success');
      setBroadcastMsg('');
      await loadBroadcasts();
    } catch (err) {
      showToast(err.message || 'Failed to dispatch broadcast.', 'error');
    } finally {
      setBroadcastBusy(false);
    }
  };

  const handleDeactivateBroadcast = async (id) => {
    try {
      await request(`/api/platform/broadcasts/${id}/deactivate`, { method: 'PATCH' });
      showToast('Broadcast deactivated.', 'info');
      await loadBroadcasts();
    } catch (err) {
      showToast(err.message || 'Failed to deactivate broadcast.', 'error');
    }
  };

  const handleSaveBranding = async (e) => {
    e.preventDefault();
    if (brandingBusy) return;
    setBrandingBusy(true);
    try {
      await request('/api/platform/settings', {
        method: 'POST',
        body: JSON.stringify(brandingSettings)
      });
      showToast('✅ Platform branding settings updated globally!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save settings.', 'error');
    } finally {
      setBrandingBusy(false);
    }
  };

  const handleImpersonate = (tenantId, name) => {
    showToast(`⚡ Switching context to "${name}"...`, 'info');
    setTimeout(() => {
      window.location.href = `/?tenant=${encodeURIComponent(tenantId)}`;
    }, 400);
  };

  useEffect(() => {
    if (currentUser?.isPlatformAdmin === true) {
      load();
    }
  }, [currentUser?.isPlatformAdmin]);

  useEffect(() => {
    if (currentUser?.isPlatformAdmin === true) {
      if (activeSubTab === 'credentials') loadCredentials();
      else if (activeSubTab === 'analytics') loadAnalytics();
      else if (activeSubTab === 'broadcasts') loadBroadcasts();
      else if (activeSubTab === 'branding') loadBranding();
    }
  }, [activeSubTab, currentUser?.isPlatformAdmin]);

  if (currentUser?.isPlatformAdmin !== true) {
    return <p role="alert" style={{ padding: '24px' }}>Platform owner access is required.</p>;
  }

  const partners = restaurants.filter(row => row.id !== 'default_tenant');
  const filtered = partners.filter(row =>
    (status === 'all' || row.status === status) &&
    `${row.name} ${row.subdomain} ${row.ownerEmail}`.toLowerCase().includes(query.toLowerCase())
  );

  const filteredCreds = credentialsList.filter(row =>
    `${row.name} ${row.subdomain} ${row.ownerUsername} ${row.ownerEmail}`.toLowerCase().includes(query.toLowerCase())
  );

  const update = async (restaurant, changes) => {
    setUpdating(restaurant.id);
    try {
      await request(`/api/saas/tenants/${encodeURIComponent(restaurant.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes)
      });
      showToast('Restaurant updated.', 'success');
      await load();
      if (activeSubTab === 'credentials') await loadCredentials();
    } catch (failure) {
      showToast(failure.message, 'error');
    } finally {
      setUpdating(null);
    }
  };

  const create = async event => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      const result = await request('/api/saas/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: fields.get('name'),
          subdomain: fields.get('subdomain'),
          ownerEmail: fields.get('ownerEmail'),
          plan: fields.get('plan')
        })
      });
      setCreated(result.tenant);
      setCreating(false);
      await load();
      await loadCredentials();
      showToast('Restaurant created and credentials recorded in vault!', 'success');
    } catch (failure) {
      showToast(failure.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetModalTenant || busy) return;
    setBusy(true);
    try {
      const payload = autoGen ? {} : { customPassword, customPin };
      const res = await request(`/api/saas/tenants/${encodeURIComponent(resetModalTenant.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setResetSuccessData(res.credentials);
      showToast(`Credentials for ${resetModalTenant.name} updated!`, 'success');
      await loadCredentials();
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to reset password.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast('Copied to clipboard!', 'info');
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const togglePasswordVisibility = (id) => {
    setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const togglePinVisibility = (id) => {
    setVisiblePins(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className={`platform-page ${embedded ? 'platform-embedded' : ''}`} aria-label="Platform administration">
      <header className="platform-heading">
        <div>
          <span className="platform-eyebrow"><ShieldCheck size={14} /> PLATFORM OWNER</span>
          <h1>Every restaurant. One clear view.</h1>
          <p>Manage independent restaurants, reset owner credentials, and govern your platform.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Add restaurant
        </button>
      </header>

      {/* Top Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '12px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}>
        <button
          className={`btn ${activeSubTab === 'restaurants' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('restaurants')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <Store size={16} /> Restaurants ({partners.length})
        </button>
        <button
          className={`btn ${activeSubTab === 'credentials' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('credentials')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <Key size={16} /> Passwords & Access Vault
        </button>
        <button
          className={`btn ${activeSubTab === 'analytics' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('analytics')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <BarChart3 size={16} /> Global Analytics & GMV
        </button>
        <button
          className={`btn ${activeSubTab === 'broadcasts' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('broadcasts')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <Megaphone size={16} /> Broadcast Alerts
        </button>
        <button
          className={`btn ${activeSubTab === 'branding' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('branding')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <Palette size={16} /> Platform Branding & Company
        </button>
        <button
          className={`btn ${activeSubTab === 'operations' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveSubTab('operations')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
        >
          <ShieldAlert size={16} /> Operations & Audit
        </button>
      </div>

      {/* Overview Stat Cards */}
      <div className="platform-stats">
        {[
          ['Restaurants', partners.length],
          ['Active', partners.filter(row => row.status === 'active' || row.status === 'trial').length],
          ['Suspended', partners.filter(row => row.status === 'suspended').length],
          ['Restaurant staff', partners.reduce((sum, row) => sum + Number(row.staffCount || 0), 0)]
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      {/* Newly Created Notification */}
      {created && (
        <section className="platform-credentials" aria-label="New restaurant owner access" style={{ border: '2px solid #10b981' }}>
          <button className="platform-dismiss" onClick={() => setCreated(null)} aria-label="Dismiss owner credentials">
            <X size={18} />
          </button>
          <h2>🎉 {created.name} is ready to set up</h2>
          <p>Credentials have been saved to your <strong>Passwords & Access Vault</strong> so you can always view them.</p>
          <dl>
            <dt>Username</dt>
            <dd style={{ fontWeight: 'bold' }}>{created.staffUsername}</dd>
            <dt>Temporary password</dt>
            <dd style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--color-primary)' }}>{created.temporaryPassword}</dd>
            <dt>PIN</dt>
            <dd style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{created.temporaryPin}</dd>
          </dl>
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-outline"
              onClick={() => copyToClipboard(`Username: ${created.staffUsername}\nPassword: ${created.temporaryPassword}\nPIN: ${created.temporaryPin}\nURL: ${window.location.origin}${created.posUrl}`, 'new_cred')}
            >
              {copiedKey === 'new_cred' ? <Check size={14} color="#10b981" /> : <Copy size={14} />} Copy All Credentials
            </button>
            <a className="btn btn-primary" href={created.posUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              Open Restaurant Sign In <ExternalLink size={14} style={{ marginLeft: 4 }} />
            </a>
          </div>
        </section>
      )}

      {error && (
        <div className="platform-error" role="alert" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '14px', borderRadius: '12px', marginBottom: '20px' }}>
          {error} <button onClick={load} className="btn btn-outline" style={{ marginLeft: '12px', padding: '4px 10px', height: 'auto', fontSize: '12px' }}>Try again</button>
        </div>
      )}

      {/* TAB 1: RESTAURANTS OVERVIEW */}
      {activeSubTab === 'restaurants' && (
        <>
          <div className="platform-toolbar">
            <label>
              <Search size={17} />
              <input aria-label="Search restaurants" placeholder="Find a restaurant or owner…" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <select aria-label="Filter restaurant status" value={status} onChange={event => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
            </select>
            <button className="btn btn-outline" onClick={load} disabled={loading} aria-label="Refresh restaurants">
              <RefreshCw size={16} />
            </button>
          </div>

          {loading ? (
            <p role="status">Loading restaurants…</p>
          ) : (
            <div className="platform-restaurants">
              {filtered.map(row => (
                <article className="platform-restaurant" key={row.id}>
                  <header>
                    <span className="platform-store-icon"><Store size={22} /></span>
                    <div>
                      <h2>{row.name}</h2>
                      <span>{row.ownerEmail}</span>
                    </div>
                    <span className={`platform-status ${row.status}`}>{row.status}</span>
                  </header>

                  <div className="platform-restaurant-details">
                    <span><strong>{row.staffCount}</strong> staff</span>
                    <span><strong>{row.orderCount}</strong> orders</span>
                    <code>{row.subdomain}</code>
                  </div>

                  <label className="platform-plan-label">
                    Plan
                    <select
                      aria-label={`Plan for ${row.name}`}
                      value={row.plan}
                      disabled={updating === row.id}
                      onChange={event => update(row, { plan: event.target.value })}
                    >
                      {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
                    </select>
                  </label>

                  <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-outline"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12px' }}
                      onClick={() => {
                        setResetModalTenant(row);
                        setResetSuccessData(null);
                        setCustomPassword('');
                        setCustomPin('');
                        setAutoGen(true);
                      }}
                    >
                      <Key size={14} /> Reset Password
                    </button>
                    <button
                      className="btn btn-outline"
                      disabled={updating === row.id}
                      onClick={() => update(row, { status: row.status === 'suspended' ? 'active' : 'suspended' })}
                    >
                      {row.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </button>
                  </div>

                  <footer>
                    <a href={row.customerUrl} target="_blank" rel="noreferrer">View storefront ↗</a>
                    <a href={row.posUrl} target="_blank" rel="noreferrer">Open POS ↗</a>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', height: 'auto', marginLeft: 'auto' }}
                      onClick={() => handleImpersonate(row.id, row.name)}
                      title="Directly switch to this store without logging out"
                    >
                      ⚡ Switch Store
                    </button>
                  </footer>
                </article>
              ))}

              {filtered.length === 0 && (
                <div className="platform-empty">
                  <Store size={32} />
                  <h2>{partners.length ? 'No matching restaurants' : 'Your first restaurant starts here'}</h2>
                  <p>{partners.length ? 'Try another search or status.' : 'Add an independent restaurant and give its owner a private workspace.'}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* TAB 2: CREDENTIALS & PASSWORD MANAGEMENT (SEPARATE DEDICATED PAGE) */}
      {activeSubTab === 'credentials' && (
        <section aria-label="Restaurant Credentials & Access Management">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 4px 0', fontWeight: 700 }}>Restaurant Access & Passwords</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                View and manage login credentials for every restaurant owner. Passwords stored here remain permanently accessible to the platform owner.
              </p>
            </div>
            <button className="btn btn-outline" onClick={loadCredentials} disabled={credLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Refresh Vault
            </button>
          </div>

          <div className="platform-toolbar">
            <label style={{ width: '100%' }}>
              <Search size={17} />
              <input
                aria-label="Search credentials"
                placeholder="Search by restaurant name, username or email…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </label>
          </div>

          {credLoading ? (
            <p>Loading credential vault…</p>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {filteredCreds.map(cred => (
                <div
                  key={cred.id}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '16px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Store size={18} color="var(--color-primary)" /> {cred.name}
                        <span className={`platform-status ${cred.status}`} style={{ fontSize: '11px' }}>{cred.status}</span>
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        URL address: <code>{cred.subdomain}</code> · Contact: {cred.ownerEmail}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-outline"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 12px' }}
                        onClick={() => {
                          const credText = `Restaurant: ${cred.name}\nUsername: ${cred.ownerUsername}\nPassword: ${cred.password}\nPIN: ${cred.pin}\nDirect Login: ${window.location.origin}${cred.posUrl}`;
                          copyToClipboard(credText, `all_${cred.id}`);
                        }}
                        title="Copy all credentials for this restaurant"
                      >
                        {copiedKey === `all_${cred.id}` ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        {copiedKey === `all_${cred.id}` ? 'All Copied!' : 'Copy All'}
                      </button>

                      <button
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 14px' }}
                        onClick={() => {
                          setResetModalTenant(cred);
                          setResetSuccessData(null);
                          setCustomPassword('');
                          setCustomPin('');
                          setAutoGen(true);
                        }}
                      >
                        <Lock size={14} /> Reset / Change Password
                      </button>
                    </div>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '12px',
                    background: 'var(--bg-app)',
                    padding: '14px 16px',
                    borderRadius: '12px'
                  }}>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Owner Username
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <strong style={{ fontSize: '14px' }}>{cred.ownerUsername}</strong>
                        <button
                          onClick={() => copyToClipboard(cred.ownerUsername, `user_${cred.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.75, padding: '4px' }}
                          title="Copy username"
                        >
                          {copiedKey === `user_${cred.id}` ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Password
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <code style={{ fontSize: '13px', background: 'var(--bg-card)', padding: '3px 8px', borderRadius: '6px', letterSpacing: visiblePasswords[cred.id] ? 'normal' : '1px' }}>
                          {visiblePasswords[cred.id] ? cred.password : '••••••••••••'}
                        </code>
                        <button
                          onClick={() => togglePasswordVisibility(cred.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.75, padding: '4px' }}
                          title={visiblePasswords[cred.id] ? "Hide password" : "Show password"}
                        >
                          {visiblePasswords[cred.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          onClick={() => copyToClipboard(cred.password, `pwd_${cred.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.75, padding: '4px' }}
                          title="Copy password"
                        >
                          {copiedKey === `pwd_${cred.id}` ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Quick Staff PIN
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <code style={{ fontSize: '13px', background: 'var(--bg-card)', padding: '3px 8px', borderRadius: '6px', letterSpacing: visiblePins[cred.id] ? 'normal' : '1px' }}>
                          {visiblePins[cred.id] ? cred.pin : '••••'}
                        </code>
                        <button
                          onClick={() => togglePinVisibility(cred.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.75, padding: '4px' }}
                          title={visiblePins[cred.id] ? "Hide PIN" : "Show PIN"}
                        >
                          {visiblePins[cred.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          onClick={() => copyToClipboard(cred.pin, `pin_${cred.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.75, padding: '4px' }}
                          title="Copy PIN"
                        >
                          {copiedKey === `pin_${cred.id}` ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Direct POS Login
                      </span>
                      <div style={{ marginTop: '4px' }}>
                        <a
                          href={cred.posUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)', fontWeight: 600 }}
                        >
                          Open Restaurant POS <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {filteredCreds.length === 0 && (
                <div className="platform-empty">
                  <Key size={32} />
                  <h2>No restaurant credentials found</h2>
                  <p>When you create restaurants, their access credentials will always appear here permanently.</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: GLOBAL ANALYTICS & GMV */}
      {activeSubTab === 'analytics' && (
        <section aria-label="Cross-Restaurant Platform Analytics">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 4px 0', fontWeight: 700 }}>Global Platform Analytics & GMV</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                Consolidated real-time revenue across all independent restaurants and storefronts.
              </p>
            </div>
            <button className="btn btn-outline" onClick={loadAnalytics} disabled={analyticsLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Refresh Analytics
            </button>
          </div>

          {analyticsLoading ? (
            <p>Aggregating platform revenue and store data…</p>
          ) : (
            <>
              {/* Aggregate KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Platform GMV</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '4px' }}>
                    Rs. {Number(analyticsData?.totals?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>All-time settled revenue</small>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Today's Platform Revenue</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                    Rs. {Number(analyticsData?.totals?.todayRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{analyticsData?.totals?.todayOrders || 0} orders today</small>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Settled Orders</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
                    {analyticsData?.totals?.totalOrders || 0}
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Across all {partners.length} restaurants</small>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Partner Stores</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#3b82f6', marginTop: '4px' }}>
                    {partners.filter(p => p.status === 'active' || p.status === 'trial').length}
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Of {partners.length} registered</small>
                </div>
              </div>

              {/* Per-Store Performance Comparison Table */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Restaurant Sales Comparison</h3>
                  <small style={{ color: 'var(--text-muted)' }}>Ranked by All-Time Revenue</small>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 16px' }}>Restaurant</th>
                        <th style={{ padding: '12px 16px' }}>Plan</th>
                        <th style={{ padding: '12px 16px' }}>Status</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Today's Sales</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>All-Time GMV</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Orders</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Staff</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(analyticsData?.tenants || []).map((t, idx) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{t.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t.subdomain}</div>
                          </td>
                          <td style={{ padding: '12px 16px', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700 }}>
                            {t.plan}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span className={`platform-status ${t.status}`}>{t.status}</span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                            Rs. {Number(t.todayRevenue || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>
                            Rs. {Number(t.totalRevenue || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>{t.totalOrders || 0}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>{t.staffCount || 0}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <button
                              className="btn btn-outline"
                              style={{ padding: '4px 8px', fontSize: '11px', height: 'auto' }}
                              onClick={() => handleImpersonate(t.id, t.name)}
                            >
                              ⚡ Switch
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* TAB 4: BROADCAST ANNOUNCEMENTS */}
      {activeSubTab === 'broadcasts' && (
        <section aria-label="Platform Broadcast Announcements">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 4px 0', fontWeight: 700 }}>Live Platform Broadcasts</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                Send global announcement banners live to all active restaurant POS cashiers, managers, and kitchen screens.
              </p>
            </div>
            <button className="btn btn-outline" onClick={loadBroadcasts} disabled={broadcastLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Refresh List
            </button>
          </div>

          {/* Broadcast Composer */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '20px', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: 700 }}>📢 Compose Global Announcement</h3>
            <form onSubmit={handleSendBroadcast}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Announcement Message</label>
                <textarea
                  className="form-input"
                  rows={3}
                  required
                  placeholder="e.g. ⚠️ Scheduled platform maintenance tonight at 11:30 PM (approx. 10 minutes). Cloud POS will automatically sync."
                  value={broadcastMsg}
                  onChange={e => setBroadcastMsg(e.target.value)}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Banner Style</label>
                  <select
                    className="form-input"
                    value={broadcastType}
                    onChange={e => setBroadcastType(e.target.value)}
                    style={{ width: '100%', height: '38px' }}
                  >
                    <option value="info">ℹ️ Information (Blue)</option>
                    <option value="warning">⚠️ Notice / Warning (Yellow)</option>
                    <option value="alert">🚨 Urgent Alert (Red)</option>
                    <option value="success">🎉 Success / Release (Green)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Duration</label>
                  <select
                    className="form-input"
                    value={broadcastHours}
                    onChange={e => setBroadcastHours(e.target.value)}
                    style={{ width: '100%', height: '38px' }}
                  >
                    <option value="2">2 Hours</option>
                    <option value="6">6 Hours</option>
                    <option value="24">24 Hours (1 Day)</option>
                    <option value="48">48 Hours (2 Days)</option>
                    <option value="168">7 Days</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={broadcastBusy} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Send size={15} /> {broadcastBusy ? 'Dispatching Broadcast…' : 'Dispatch Live Broadcast'}
              </button>
            </form>
          </div>

          {/* Broadcasts History */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Announcement History</h3>
            </div>
            {broadcastsList.length === 0 ? (
              <p style={{ padding: '24px', color: 'var(--text-muted)', margin: 0 }}>No broadcasts have been sent yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {broadcastsList.map(b => (
                  <div key={b.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                          background: b.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                          color: b.isActive ? '#10b981' : '#64748b'
                        }}>
                          {b.isActive ? 'Active' : 'Expired / Dismissed'}
                        </span>
                        <small style={{ color: 'var(--text-muted)' }}>Sent by {b.createdBy || 'Platform'}</small>
                        <small style={{ color: 'var(--text-muted)' }}>• {new Date(b.createdAt).toLocaleString()}</small>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>{b.message}</div>
                    </div>
                    {Boolean(b.isActive) && (
                      <button
                        className="btn btn-outline"
                        style={{ padding: '4px 10px', fontSize: '12px', height: 'auto', color: '#ef4444', borderColor: '#ef4444' }}
                        onClick={() => handleDeactivateBroadcast(b.id)}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 5: PLATFORM BRANDING & COMPANY SETTINGS */}
      {activeSubTab === 'branding' && (
        <section aria-label="White-Label Platform Branding Settings">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 4px 0', fontWeight: 700 }}>White-Label Platform Branding</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
                Customize your company name, software title, logo, and slogan displayed across all terminals, PDFs, and invoices.
              </p>
            </div>
            <button className="btn btn-outline" onClick={loadBranding} disabled={brandingLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={15} /> Reload Settings
            </button>
          </div>

          <form onSubmit={handleSaveBranding} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '24px', maxWidth: '720px' }}>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Platform Creator / Engineering Company Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={brandingSettings.platformCompany || ''}
                  onChange={e => setBrandingSettings({ ...brandingSettings, platformCompany: e.target.value })}
                  placeholder="e.g. RS Technologies"
                  style={{ width: '100%', height: '40px' }}
                />
                <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                  Appears in all audit statement PDF footers, system labels, and Z-Reports (e.g. "Platform Engineered by RS Technologies").
                </small>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Platform Software Product Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={brandingSettings.platformName || ''}
                  onChange={e => setBrandingSettings({ ...brandingSettings, platformName: e.target.value })}
                  placeholder="e.g. GastroFlow"
                  style={{ width: '100%', height: '40px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Platform Tagline / Slogan
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={brandingSettings.platformSlogan || ''}
                  onChange={e => setBrandingSettings({ ...brandingSettings, platformSlogan: e.target.value })}
                  placeholder="e.g. Smarter Dining Operations & Cloud POS"
                  style={{ width: '100%', height: '40px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Platform Logo URL
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={brandingSettings.platformLogoUrl || ''}
                  onChange={e => setBrandingSettings({ ...brandingSettings, platformLogoUrl: e.target.value })}
                  placeholder="/gastroflow-brand.svg?v=1"
                  style={{ width: '100%', height: '40px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Default Commission Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input"
                    value={brandingSettings.commissionRate || ''}
                    onChange={e => setBrandingSettings({ ...brandingSettings, commissionRate: e.target.value })}
                    placeholder="15"
                    style={{ width: '100%', height: '40px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Platform Support Email
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    value={brandingSettings.supportEmail || ''}
                    onChange={e => setBrandingSettings({ ...brandingSettings, supportEmail: e.target.value })}
                    placeholder="support@gastroflow.lk"
                    style={{ width: '100%', height: '40px' }}
                  />
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <button type="submit" className="btn btn-primary" disabled={brandingBusy} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={16} /> {brandingBusy ? 'Saving Branding…' : 'Save Platform Branding'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* TAB 6: PLATFORM OPERATIONS & FINANCIALS */}
      {activeSubTab === 'operations' && (
        <PlatformOperations restaurants={partners} />
      )}

      {/* RESET PASSWORD MODAL */}
      {resetModalTenant && (
        <div className="platform-modal-backdrop" onClick={() => !busy && setResetModalTenant(null)}>
          <section
            className="platform-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reset Restaurant Password"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '520px' }}
          >
            <header>
              <h2>Reset Password for {resetModalTenant.name}</h2>
              <button className="btn btn-outline" disabled={busy} onClick={() => setResetModalTenant(null)}>
                <X size={18} />
              </button>
            </header>

            {resetSuccessData ? (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', color: '#10b981', padding: '16px', borderRadius: '12px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={18} /> Password Successfully Reset!
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-main)' }}>
                    The new credentials have been permanently stored in your vault and are active immediately:
                  </p>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '16px', borderRadius: '12px', display: 'grid', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Username:</span>
                    <strong>{resetSuccessData.username}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>New Password:</span>
                    <code style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--color-primary)' }}>{resetSuccessData.password}</code>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>New PIN:</span>
                    <code style={{ fontSize: '14px', fontWeight: 'bold' }}>{resetSuccessData.pin}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      copyToClipboard(`Restaurant: ${resetModalTenant.name}\nUsername: ${resetSuccessData.username}\nPassword: ${resetSuccessData.password}\nPIN: ${resetSuccessData.pin}\nLogin URL: ${window.location.origin}${resetSuccessData.posUrl}`, 'modal_all');
                    }}
                  >
                    {copiedKey === 'modal_all' ? '✓ Copied' : 'Copy All Info'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setResetModalTenant(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleResetPassword}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Generate a new password and staff PIN for the owner of <strong>{resetModalTenant.name}</strong>. The old password will be invalidated immediately.
                </p>

                <div style={{ marginBottom: '16px', display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                    <input
                      type="radio"
                      checked={autoGen}
                      onChange={() => setAutoGen(true)}
                    />
                    Auto-generate secure password
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                    <input
                      type="radio"
                      checked={!autoGen}
                      onChange={() => setAutoGen(false)}
                    />
                    Set custom password
                  </label>
                </div>

                {!autoGen && (
                  <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                    <label>
                      New Password (min 8 chars)
                      <input
                        type="text"
                        value={customPassword}
                        onChange={e => setCustomPassword(e.target.value)}
                        placeholder="e.g. SecretPass#2026"
                        minLength={8}
                        required={!autoGen}
                      />
                    </label>
                    <label>
                      New Quick PIN (4-6 digits)
                      <input
                        type="text"
                        value={customPin}
                        onChange={e => setCustomPin(e.target.value)}
                        placeholder="e.g. 8899"
                        pattern="\d{4,6}"
                        maxLength={6}
                      />
                    </label>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button type="submit" className="btn btn-primary" disabled={busy} style={{ flex: 1 }}>
                    {busy ? 'Updating Password…' : 'Confirm Password Reset'}
                  </button>
                  <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setResetModalTenant(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {/* CREATE RESTAURANT MODAL */}
      {creating && (
        <div className="platform-modal-backdrop">
          <section className="platform-modal" role="dialog" aria-modal="true" aria-label="Add restaurant">
            <header>
              <h2>Add a restaurant</h2>
              <button className="btn btn-outline" disabled={busy} onClick={() => setCreating(false)} aria-label="Close add restaurant">
                <X size={18} />
              </button>
            </header>
            <form onSubmit={create}>
              <label>
                Restaurant name
                <input name="name" maxLength={120} required autoFocus placeholder="e.g. Spice Garden Restaurant" />
              </label>
              <label>
                Restaurant URL slug / address
                <input name="subdomain" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={48} placeholder="e.g. spice-garden" required />
                <small>A unique name used in restaurant links (lowercase, letters and hyphens).</small>
              </label>
              <label>
                Owner email
                <input name="ownerEmail" type="email" maxLength={254} required placeholder="owner@spicegarden.lk" />
              </label>
              <label>
                Plan
                <select name="plan" defaultValue="basic">
                  {plans.map(plan => <option value={plan.id} key={plan.id}>{plan.label}</option>)}
                </select>
              </label>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Generates a private owner account and saves credentials permanently to your Password Vault.
              </p>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating restaurant…' : 'Create restaurant and owner'}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
