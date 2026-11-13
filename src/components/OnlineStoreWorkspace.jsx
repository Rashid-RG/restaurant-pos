import React, { useState, useEffect, useCallback } from 'react';
import { Store, ExternalLink, Copy, ClipboardList, UtensilsCrossed, Truck, Settings2, CheckCircle2, CircleAlert, Power, Clock3, ArrowUpRight, Eye, Package } from 'lucide-react';
import { usePOS } from '../context/POSContext';
import './OnlineStoreWorkspace.css';

export default function OnlineStoreWorkspace() {
  const { currentUser, settings = {}, menuItems = [], setActiveTab, updateSetting, showToast } = usePOS();
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [publicStore, setPublicStore] = useState(null);
  const [storeCheck, setStoreCheck] = useState('checking');
  const [storeError, setStoreError] = useState('');
  const tenantId = currentUser?.tenant_id || currentUser?.tenantId;
  const storeUrl = tenantId
    ? new URL(`/customer/?tenant=${encodeURIComponent(tenantId)}&view=menu`, window.location.origin).href
    : null;
  const isOpen = publicStore?.storeOpen === true;
  const activeItems = menuItems.filter(item => item.isAvailable !== false && item.isAvailable !== 0 && item.isAvailable !== '0').length;
  const shopName = settings.businessName || settings.restaurantName || currentUser?.tenantName || 'Your restaurant';
  const verifyStore = useCallback(async () => {
    if (!tenantId) {
      setStoreCheck('error');
      setStoreError('Restaurant session missing. Please sign in again.');
      return null;
    }
    setStoreCheck('checking');
    setStoreError('');
    try {
      const token = localStorage.getItem('gastroflow_token');
      const [identityResponse, publicResponse] = await Promise.all([
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token || ''}` }, cache: 'no-store' }),
        fetch(`/api/public/menu?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' })
      ]);
      if (!identityResponse.ok || !publicResponse.ok) throw new Error('Could not verify your restaurant. Check your connection and account.');
      const [identity, store] = await Promise.all([identityResponse.json(), publicResponse.json()]);
      if (identity?.user?.tenant_id !== tenantId || store?.tenantId !== tenantId) {
        throw new Error('Restaurant mismatch. Reload this workspace and sign in again before making changes.');
      }
      setPublicStore(store);
      setStoreCheck('ready');
      return store;
    } catch (error) {
      setStoreCheck('error');
      setStoreError(error?.message || 'Restaurant verification failed.');
      return null;
    }
  }, [tenantId]);
  useEffect(() => { void verifyStore(); }, [verifyStore]);
  const goSettings = tab => {
    sessionStorage.setItem('gastroflow_settings_tab', tab);
    setActiveTab('settings');
  };
  const toggleStore = async () => {
    if (saving || storeCheck !== 'ready') return;
    setSaving(true);
    try {
      const before = await verifyStore();
      if (!before) throw new Error('Restaurant verification failed. No changes were made.');
      const next = before.storeOpen ? 'false' : 'true';
      const confirmed = await updateSetting('storeOpen', next);
      if (confirmed?.tenantId !== tenantId) throw new Error('Store update was not confirmed for this restaurant.');
      const after = await verifyStore();
      if (!after || after.storeOpen !== (next === 'true')) throw new Error('Store update could not be verified. Please reload before retrying.');
      showToast(next === 'true' ? 'Your restaurant is now accepting online orders' : 'Your restaurant paused online orders', 'success');
    } catch (error) {
      showToast(error?.message || 'Unable to update your store', 'error');
      await verifyStore();
    } finally {
      setSaving(false);
    }
  };
  const copyStoreLink = async () => {
    if (!storeUrl) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(storeUrl);
      showToast('Customer store link copied', 'success');
    } catch (_) {
      window.prompt('Copy your customer store URL:', storeUrl);
    } finally {
      setCopying(false);
    }
  };
  const profileComplete = Boolean(shopName && (settings.address || '').trim() && (settings.phone || '').trim());
  const readyMenu = activeItems > 0;
  const checklist = [
    { label: 'Business identity', help: 'Shop name, logo, phone and address', complete: profileComplete, action: () => goSettings('business') },
    { label: 'Publish your menu', help: 'Products, prices, photos and availability', complete: readyMenu, action: () => goSettings('menu') },
    { label: 'Delivery and scheduling', help: 'Set zones, fees, prep times and capacity', complete: false, action: () => goSettings('online'), manual: true },
    { label: 'Preview a customer checkout', help: 'Confirm totals, menu and order handoff', complete: false, action: () => storeUrl && window.open(storeUrl, '_blank', 'noopener,noreferrer'), manual: true }
  ];
  return (
    <main className="main-content store-workspace">
      <header className="store-workspace-header">
        <div>
          <p className="store-workspace-eyebrow"><Store size={15}/> YOUR DIGITAL STOREFRONT</p>
          <h1>Online Store</h1>
          <p>One place to launch, operate and grow your restaurant's customer ordering experience.</p>
        </div>
        <div className="store-workspace-actions">
          <button type="button" className="store-workspace-secondary" onClick={copyStoreLink} disabled={!storeUrl || copying}><Copy size={17}/> Copy store link</button>
          {storeUrl && <a className="store-workspace-primary" href={storeUrl} target="_blank" rel="noopener noreferrer"><Eye size={17}/> View customer store <ExternalLink size={14}/></a>}
        </div>
      </header>
      <div className="view-body store-workspace-body">
        <section className="store-workspace-hero">
          <div className="store-workspace-hero-main">
            <span className={`store-workspace-status ${isOpen ? 'open' : 'paused'}`}><span className="store-workspace-status-dot"/>{storeCheck === 'checking' ? 'Verifying restaurant…' : storeCheck === 'error' ? 'Store verification required' : isOpen ? 'Accepting online orders' : 'Online orders paused'}</span>
            <h2>{shopName}</h2>
            {storeError && <p role="alert" className="store-workspace-verification-error">{storeError} <button type="button" onClick={() => void verifyStore()}>Retry</button></p>}
            <p>{storeCheck === 'ready' && isOpen ? 'Your customer storefront is accepting orders.' : 'Your storefront is not currently accepting new online orders. You can preview it before opening.'}</p>
            <button type="button" onClick={toggleStore} disabled={saving || storeCheck !== 'ready'} className={`store-workspace-toggle ${isOpen ? 'stop' : ''}`}><Power size={17}/>{saving ? 'Verifying update…' : storeCheck === 'checking' ? 'Checking restaurant…' : storeCheck === 'error' ? 'Verification required' : isOpen ? 'Pause incoming orders' : 'Open online store'}</button>
          </div>
          <div className="store-workspace-hero-stats" aria-label="Store overview">
            <div><span>Menu items</span><strong>{menuItems.length}</strong><small>Total in POS menu</small></div>
            <div><span>Available items</span><strong>{activeItems}</strong><small>Ready to offer</small></div>
            <div><span>Preparation time</span><strong>{settings.takeawayPrepTime || '20'} <em>min</em></strong><small>Takeaway estimate</small></div>
          </div>
        </section>

        <section className="store-workspace-section" aria-labelledby="store-operations-title">
          <div className="store-workspace-section-heading"><div><p>RUN YOUR STORE</p><h2 id="store-operations-title">Your online operations</h2></div></div>
          <div className="store-workspace-grid">
            {[
              {icon: ClipboardList, name:'Online Orders',description:'Review new customer orders, accept them and follow progress.',action:()=>setActiveTab('online-orders'),detail:'Manage orders'},
              {icon: UtensilsCrossed,name:'Online Menu',description:'Manage dishes, prices, product photos and sold-out items.',action:()=>goSettings('menu'),detail:'Edit menu'},
              {icon: Truck,name:'Delivery & Pickup',description:'Delivery radius, fees, preparation times and order slots.',action:()=>goSettings('online'),detail:'Configure delivery'},
              {icon: Package,name:'Stock & Inventory',description:'Keep stock and item availability in sync with the menu.',action:()=>setActiveTab('inventory'),detail:'View inventory'},
              {icon: Settings2,name:'Store Profile',description:'Shop logo, business identity, contact details and address.',action:()=>goSettings('business'),detail:'Edit profile'},
              {icon: Clock3,name:'Store Controls',description:'Open/closed switch, scheduled capacity and dispatch rules.',action:()=>goSettings('online'),detail:'Advanced controls'}
            ].map(card => <button type="button" className="store-workspace-operation" key={card.name} onClick={card.action}>
              <span className="store-workspace-card-icon"><card.icon size={23}/></span>
              <strong>{card.name}</strong><span>{card.description}</span><small>{card.detail} <ArrowUpRight size={14}/></small>
            </button>)}
          </div>
        </section>

        <div className="store-workspace-bottom">
          <section className="store-workspace-checklist" aria-labelledby="store-start-title">
            <div className="store-workspace-section-heading"><div><p>GET STARTED</p><h2 id="store-start-title">Launch checklist</h2></div></div>
            {checklist.map((item, index) => <button key={item.label} type="button" onClick={item.action} className="store-workspace-check">
              <span className="store-workspace-step">{index+1}</span>
              <span className="store-workspace-check-copy"><strong>{item.label}</strong><small>{item.help}</small></span>
              {item.complete ? <CheckCircle2 size={21} color="#167d63"/> : item.manual ? <ArrowUpRight size={19}/> : <CircleAlert size={20} color="#ba7a18"/>}
            </button>)}
            <p className="store-workspace-note">Items requiring a real checkout or delivery verification must be checked manually before going live.</p>
          </section>
          <section className="store-workspace-share">
            <p className="store-workspace-eyebrow">CUSTOMER LINK</p>
            <h2>Share your restaurant online</h2>
            <p>Customers can use your restaurant-specific link to explore the menu and place orders.</p>
            <div className="store-workspace-url">{storeUrl || 'Store link unavailable until a restaurant is selected'}</div>
            <button type="button" onClick={copyStoreLink} disabled={!storeUrl} className="store-workspace-primary"><Copy size={16}/> Copy customer link</button>
            <p className="store-workspace-note">Always place a test order before sharing this link publicly. The URL is tied to your restaurant account.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
