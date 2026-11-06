import PlatformOperations from './PlatformOperations';
import React, { useEffect, useState } from 'react';
import { Store, Plus, RefreshCw, Search, ShieldCheck, X, Key, Copy, Check, Eye, EyeOff, Lock, ExternalLink, ShieldAlert } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import './platform.css';

export default function PlatformAdmin({ embedded = false }) {
  const { currentUser, showToast } = usePOS();
  const [activeSubTab, setActiveSubTab] = useState('restaurants'); // 'restaurants' | 'credentials' | 'operations'
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

  // Password reset modal state
  const [resetModalTenant, setResetModalTenant] = useState(null);
  const [customPassword, setCustomPassword] = useState('');
  const [customPin, setCustomPin] = useState('');
  const [autoGen, setAutoGen] = useState(true);
  const [resetSuccessData, setResetSuccessData] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [visiblePasswords, setVisiblePasswords] = useState({});

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

  useEffect(() => {
    if (currentUser?.isPlatformAdmin === true) {
      load();
    }
  }, [currentUser?.isPlatformAdmin]);

  useEffect(() => {
    if (currentUser?.isPlatformAdmin === true && activeSubTab === 'credentials') {
      loadCredentials();
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
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
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
                        <code style={{ fontSize: '13px', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: '6px' }}>
                          {visiblePasswords[cred.id] ? cred.password : '••••••••••••'}
                        </code>
                        {cred.hasSavedPassword && (
                          <button
                            onClick={() => togglePasswordVisibility(cred.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
                            title={visiblePasswords[cred.id] ? "Hide password" : "Show password"}
                          >
                            {visiblePasswords[cred.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        )}
                        {cred.hasSavedPassword && (
                          <button
                            onClick={() => copyToClipboard(cred.password, `pwd_${cred.id}`)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
                            title="Copy password"
                          >
                            {copiedKey === `pwd_${cred.id}` ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Quick Staff PIN
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <code style={{ fontSize: '13px', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: '6px' }}>
                          {cred.pin}
                        </code>
                        <button
                          onClick={() => copyToClipboard(cred.pin, `pin_${cred.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
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

      {/* TAB 3: PLATFORM OPERATIONS & FINANCIALS */}
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
