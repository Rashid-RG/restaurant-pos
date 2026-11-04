import React, { useEffect, useState } from 'react';
import { Store, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import './platform.css';

export default function PlatformAdmin({ embedded = false }) {
  const { currentUser, showToast } = usePOS();
  const [restaurants,setRestaurants] = useState([]);
  const [plans,setPlans] = useState([]);
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('all');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [creating,setCreating] = useState(false);
  const [busy,setBusy] = useState(false);
  const [updating,setUpdating] = useState(null);
  const [created,setCreated] = useState(null);
  const request = async (path, options = {}) => {
    const response = await fetch(path,{ ...options, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('gastroflow_token')}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not complete this request.');
    return data;
  };
  const load = async () => {
    setLoading(true); setError('');
    try { const [rows,available] = await Promise.all([request('/api/saas/tenants'),request('/api/saas/plans')]); setRestaurants(rows); setPlans(available.plans || available); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (currentUser?.isPlatformAdmin === true) load(); }, [currentUser?.isPlatformAdmin]);
  if (currentUser?.isPlatformAdmin !== true) return <p role="alert">Platform owner access is required.</p>;
  const partners = restaurants.filter(row => row.id !== 'default_tenant');
  const filtered = partners.filter(row => (status === 'all' || row.status === status) && `${row.name} ${row.subdomain} ${row.ownerEmail}`.toLowerCase().includes(query.toLowerCase()));
  const update = async (restaurant, changes) => {
    setUpdating(restaurant.id);
    try { await request(`/api/saas/tenants/${encodeURIComponent(restaurant.id)}`,{method:'PATCH',body:JSON.stringify(changes)}); showToast('Restaurant updated.','success'); await load(); }
    catch (failure) { showToast(failure.message,'error'); }
    finally { setUpdating(null); }
  };
  const create = async event => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      const result = await request('/api/saas/tenants',{method:'POST',body:JSON.stringify({ name:fields.get('name'),subdomain:fields.get('subdomain'),ownerEmail:fields.get('ownerEmail'),plan:fields.get('plan') })});
      setCreated(result.tenant); setCreating(false); await load(); showToast('Restaurant and owner account created.','success');
    } catch (failure) { showToast(failure.message,'error'); }
    finally { setBusy(false); }
  };
  return <section className={`platform-page ${embedded ? 'platform-embedded' : ''}`} aria-label="Platform administration">
    <header className="platform-heading"><div><span className="platform-eyebrow"><ShieldCheck size={14}/> PLATFORM OWNER</span><h1>Every restaurant. One clear view.</h1><p>Manage independent restaurants, their owners and access to your platform.</p></div><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16}/> Add restaurant</button></header>
    <div className="platform-stats">{[['Restaurants',partners.length],['Active',partners.filter(row => row.status === 'active' || row.status === 'trial').length],['Suspended',partners.filter(row => row.status === 'suspended').length],['Restaurant staff',partners.reduce((sum,row) => sum + Number(row.staffCount || 0),0)]].map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    {created && <section className="platform-credentials" aria-label="New restaurant owner access"><button className="platform-dismiss" onClick={() => setCreated(null)} aria-label="Dismiss owner credentials"><X size={18}/></button><h2>{created.name} is ready to set up</h2><p>Share these credentials securely with its owner. They are shown only for this creation response.</p><dl><dt>Username</dt><dd>{created.staffUsername}</dd><dt>Temporary password</dt><dd>{created.temporaryPassword}</dd><dt>PIN</dt><dd>{created.temporaryPin}</dd></dl><a href={created.posUrl} target="_blank" rel="noreferrer">Open restaurant sign in ↗</a><p>The storefront starts closed with an empty menu. The owner must configure it before taking orders.</p></section>}
    <div className="platform-toolbar"><label><Search size={17}/><input aria-label="Search restaurants" placeholder="Find a restaurant or owner…" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="Filter restaurant status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="trial">Trial</option><option value="suspended">Suspended</option></select><button className="btn btn-outline" onClick={load} disabled={loading} aria-label="Refresh restaurants"><RefreshCw size={16}/></button></div>
    {error && <div className="platform-error" role="alert">{error} <button onClick={load}>Try again</button></div>}
    {loading ? <p role="status">Loading restaurants…</p> : !error && <div className="platform-restaurants">{filtered.map(row => <article className="platform-restaurant" key={row.id}><header><span className="platform-store-icon"><Store size={22}/></span><div><h2>{row.name}</h2><span>{row.ownerEmail}</span></div><span className={`platform-status ${row.status}`}>{row.status}</span></header><div className="platform-restaurant-details"><span><strong>{row.staffCount}</strong> staff</span><span><strong>{row.orderCount}</strong> orders</span><code>{row.subdomain}</code></div><label className="platform-plan-label">Plan<select aria-label={`Plan for ${row.name}`} value={row.plan} disabled={updating === row.id} onChange={event => update(row,{plan:event.target.value})}>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}</select></label><footer><a href={row.customerUrl} target="_blank" rel="noreferrer">View storefront ↗</a><button className="btn btn-outline" disabled={updating === row.id} onClick={() => update(row,{status:row.status === 'suspended' ? 'active' : 'suspended'})}>{row.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button></footer></article>)}{filtered.length === 0 && <div className="platform-empty"><Store size={32}/><h2>{partners.length ? 'No matching restaurants' : 'Your first restaurant starts here'}</h2><p>{partners.length ? 'Try another search or status.' : 'Add an independent restaurant and give its owner a private workspace.'}</p></div>}</div>}
    {creating && <div className="platform-modal-backdrop"><section className="platform-modal" role="dialog" aria-modal="true" aria-label="Add restaurant"><header><h2>Add a restaurant</h2><button className="btn btn-outline" disabled={busy} onClick={() => setCreating(false)} aria-label="Close add restaurant"><X size={18}/></button></header><form onSubmit={create}><label>Restaurant name<input name="name" maxLength={120} required autoFocus/></label><label>Restaurant address<input name="subdomain" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={48} placeholder="colombo-kitchen" required/><small>A unique name used in restaurant links.</small></label><label>Owner email<input name="ownerEmail" type="email" maxLength={254} required/></label><label>Plan<select name="plan" defaultValue="basic">{plans.map(plan => <option value={plan.id} key={plan.id}>{plan.label}</option>)}</select></label><p>Creates a separate owner account and an empty, closed storefront. No email is sent automatically.</p><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating restaurant…' : 'Create restaurant and owner'}</button></form></section></div>}
  </section>;
}
