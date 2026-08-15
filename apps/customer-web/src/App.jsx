import React, { useState, useEffect, Component } from 'react';
import { CustomerAuthProvider, useCustomerAuth } from './context/CustomerAuthContext.jsx';
import { CartProvider, useCart } from './context/CartContext.jsx';
import { LanguageProvider, useLang } from './context/LanguageContext.jsx';
import Toast, { useToast } from './components/Toast.jsx';
import MenuView from './views/MenuView.jsx';
import CartCheckoutView from './views/CartCheckoutView.jsx';
import OrderTrackingView from './views/OrderTrackingView.jsx';
import ProfileView from './views/ProfileView.jsx';
import RestaurantsView from './views/RestaurantsView.jsx';
import LegalPoliciesView from './views/LegalPoliciesView.jsx';
import SupportView from './views/SupportView.jsx';
import GastroAiConcierge from './components/GastroAiConcierge.jsx';
import { setActiveTenant } from './utils/tenant.js';
import SystemUpdatePrompt from './components/SystemUpdatePrompt.jsx';


// ── Error Boundary ───────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, fontFamily: 'monospace', color: '#c00', background: '#fff0f0', minHeight: '100dvh' }}>
        <h2>⚠ App Error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', marginTop: 12 }}>
          {this.state.error?.message}{'\n\n'}{this.state.error?.stack}
        </pre>
      </div>
    );
    return this.props.children;
  }
}


function CartSheet({ onCheckout }) {
  const { items, cartOpen, setCartOpen, addItem, removeItem, deleteItem, subtotal, totalItems } = useCart();
  // Use the same formula as CartCheckoutView so the cart sidebar and checkout
  // page show a consistent total. Previously CartSheet used subtotal * 1.10
  // while checkout adds 10% service charge AND 10% tax (~21% effective markup).
  const serviceCharge = subtotal * 0.10;
  const tax = (subtotal + serviceCharge) * 0.10;
  const total = Math.round(subtotal + serviceCharge + tax);

  return (
    <>
      <div className={`cart-backdrop ${cartOpen ? 'open' : ''}`} onClick={() => setCartOpen(false)} />
      <div className={`cart-sheet ${cartOpen ? 'open' : ''}`}>
        <div className="cart-sheet-handle" />
        <div className="cart-sheet-header">
          <h2>🛒 Cart · {totalItems} items</h2>
          <button className="cart-close-btn" onClick={() => setCartOpen(false)}>✕</button>
        </div>
        <div className="cart-body">
          {items.length === 0 ? (
            <div className="cart-empty">
              <div className="empty-icon">🛒</div>
              <p>Your cart is empty!</p>
            </div>
          ) : items.map(item => (
            <div key={item.cartId} className="cart-item">
              <div className="cart-item-emoji">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} loading="lazy"
                    style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }}
                    onError={(e) => { e.currentTarget.replaceWith(document.createTextNode(item.emoji || '🍽️')); }} />
                ) : (item.emoji || '🍽️')}
              </div>
              <div className="cart-item-info">
                <div className="cart-item-name">{item.name}</div>
                {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {item.selectedModifiers.map(m => `+ ${m.name}`).join(', ')}
                  </div>
                )}
                {item.notes && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--brand)', fontStyle: 'italic', marginTop: 2 }}>
                    Note: "{item.notes}"
                  </div>
                )}
                <div className="cart-item-price">Rs. {item.unitPrice.toFixed(2)} each</div>
              </div>
              <div className="qty-control">
                <button className="dec" onClick={() => removeItem(item.cartId)}>−</button>
                <span className="qty">{item.qty}</span>
                <button className="inc" onClick={() => addItem(item, 1, item.selectedModifiers, item.notes)}>+</button>
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="cart-footer">
            <div className="cart-summary-row"><span>Subtotal</span><span>Rs. {subtotal.toFixed(2)}</span></div>
            <div className="cart-summary-row"><span>Service Charge (10%)</span><span>Rs. {serviceCharge.toFixed(2)}</span></div>
            <div className="cart-summary-row"><span>Tax (10%)</span><span>Rs. {tax.toFixed(2)}</span></div>
            <div className="cart-summary-row total"><span>Est. Total</span><span>Rs. {total.toFixed(2)}</span></div>
            <button
              className="btn btn-brand"
              style={{ marginTop: 12 }}
              onClick={() => { setCartOpen(false); onCheckout && onCheckout(); }}
            >
              Go to Checkout · Rs. {total.toFixed(2)}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Add-to-Home-Screen banner ────────────────────────────────────────
function InstallPrompt() {
  const { t } = useLang();
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    // Check if already in standalone/installed mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;

    if (localStorage.getItem('gastroflow_install_dismissed')) return;

    // Detect OS
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    setIsIOS(ios);

    const isHttp = window.location.protocol === 'http:';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // On Android Chrome over non-localhost HTTP, beforeinstallprompt will NOT fire, so we manually show the banner as a guide
    if (!ios && isHttp && !isLocalhost) {
      setVisible(true);
    }

    // On iOS Safari, beforeinstallprompt is not supported, so we manually show the banner guide
    if (ios) {
      setVisible(true);
    }

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    // Store handler reference so we can properly remove it on cleanup (Bug 10 fix: memory leak)
    const onInstalled = () => setVisible(false);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem('gastroflow_install_dismissed', '1');
    setVisible(false);
  };

  const install = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setVisible(false);
    } else {
      // No native prompt available — reveal the manual steps inline (no blocking alert()).
      setShowSteps((s) => !s);
    }
  };

  const steps = isIOS
    ? ['Tap the Share button (📤) at the bottom.', "Scroll down and tap 'Add to Home Screen'."]
    : ['Open the browser menu (⁝ or ⋯) in the top-right.', "Select 'Add to Home Screen' or 'Install App'."];

  return (
    <div className="install-banner" role="dialog" aria-label="Install GastroFlow" style={{ flexWrap: 'wrap' }}>
      <span style={{ fontSize: '1.6rem' }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-1)' }}>{t('installTitle')}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isIOS ? "Tap 📤 and select 'Add to Home Screen'" : t('installBody')}
        </div>
      </div>
      <button className="btn btn-brand" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }} onClick={install}>
        {deferred ? t('install') : (showSteps ? 'Hide' : 'Guide')}
      </button>
      <button aria-label="Dismiss" onClick={dismiss} style={{ fontSize: '1.2rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
      {showSteps && (
        <ol style={{ flexBasis: '100%', margin: '8px 0 0', paddingLeft: 20, fontSize: '0.78rem', color: 'var(--text-1)', lineHeight: 1.6 }}>
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

// ── Inner App (needs context) ────────────────────────────────────────
function InnerApp() {
  const [view, setView] = useState('menu');
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const { customer, loading: authLoading } = useCustomerAuth();
  const { items, totalItems, setCartOpen } = useCart();
  const { messages, toast } = useToast();
  const { t, lang, setLang, languages } = useLang();

  // Sync initial view from URL query parameter ?view=... or ?page=... & deep links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const track = params.get('track');
    const reset = params.get('reset');
    const legal = params.get('legal') || params.get('policies');
    const viewParam = params.get('view') || params.get('page');
    const table = params.get('table');
    const tenant = params.get('tenant');

    if (table) {
      localStorage.setItem('gastroflow_table_number', table);
      toast && toast(`🪑 Seated at Table #${table}! Menu loaded for table order.`, 'success');
    }
    if (tenant) {
      setActiveTenant(tenant);
    }

    if (track) {
      setTrackingOrderId(track);
      setView('track');
    } else if (reset) {
      setResetToken(reset);
      setView('account');
    } else if (legal) {
      setView('legal');
    } else if (viewParam && ['menu', 'restaurants', 'checkout', 'track', 'account', 'support', 'legal'].includes(viewParam)) {
      setView(viewParam);
    }

    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const v = p.get('view') || p.get('page') || 'menu';
      setView(v);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (v, extraParams = {}) => {
    setView(v);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', v);
      Object.entries(extraParams).forEach(([k, val]) => {
        if (val !== null && val !== undefined) url.searchParams.set(k, val);
        else url.searchParams.delete(k);
      });
      window.history.pushState({}, '', url.toString());
    } catch (_) {}
  };


  // Redirect to the standalone GastroDriver PWA. Dev: customer runs on :3001, driver on :3002.
  // Production: set VITE_DRIVER_URL to the driver app's host.
  const openDriverApp = () => {
    const url = import.meta.env.VITE_DRIVER_URL
      || (window.location.port === '3001'
        ? `${window.location.protocol}//${window.location.hostname}:3002`
        : '/driver-app');
    window.location.href = url;
  };

  const handleOrderPlaced = (orderId) => {
    setTrackingOrderId(orderId);
    setView('track');
  };

  return (
    <div className="app-shell">
      <Toast messages={messages} />
      <InstallPrompt />
      <SystemUpdatePrompt />



      {/* Top Header */}
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 }}>
          {view !== 'restaurants' && (
            <button
              onClick={() => {
                // Bug 8 fix: window.history.length > 1 is always true in a real browser
                // session — it would navigate out of the SPA on first load.
                // Always navigate within the app instead.
                navigate('restaurants');
              }}
              style={{
                background: 'rgba(255,107,53,0.14)',
                border: '1px solid rgba(255,107,53,0.35)',
                color: '#ff6b35',
                borderRadius: 8,
                padding: '4px 8px',
                fontSize: '0.78rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                flexShrink: 0,
                boxShadow: '0 2px 5px rgba(0,0,0,0.08)'
              }}
              title="Go Back"
            >
              <span>←</span>
              <span className="back-btn-text">Back</span>
            </button>
          )}
          <img src="food-logo.png" alt="GastroFood Logo" style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }} onClick={() => navigate('restaurants')} />
          <span className="restaurant-name" style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: '#ff6b35', letterSpacing: '-0.5px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => navigate('restaurants')}>
            GastroFlow
          </span>

          {localStorage.getItem('gastroflow_table_number') && (
            <span style={{ background: '#10b98120', color: '#10b981', padding: '2px 6px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800, border: '1px solid #10b98150', flexShrink: 0 }}>
              🪑 #{localStorage.getItem('gastroflow_table_number')}
            </span>
          )}
        </div>

        <div className="header-actions">
          <button className="icon-btn" onClick={() => navigate('support')} title="Customer Support Desk" style={{ fontSize: '1.1rem', background: '#3b82f620', border: '1px solid #3b82f650' }}>
            🎧
          </button>
          <button className="icon-btn" onClick={openDriverApp} title="Open Driver Rider Portal" style={{ fontSize: '1.1rem', background: '#10b98120', border: '1px solid #10b98150' }}>
            🛵
          </button>
          <select
            className="lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label={t('language')}
            title={t('language')}
          >
            {languages.map(l => <option key={l.code} value={l.code}>{l.short}</option>)}
          </select>
          {totalItems > 0 && (
            <button className="icon-btn" onClick={() => setCartOpen(true)} title={t('navCart')}>
              🛒
              <span className="badge">{totalItems}</span>
            </button>
          )}
          <button className="icon-btn" onClick={() => navigate('account')} title={t('navAccount')}>
            {customer ? '👤' : '🔑'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {view === 'restaurants' && (
          <RestaurantsView
            onSelectRestaurant={(rest) => {
              if (rest && rest.id) setActiveTenant(rest.id);
              setView('menu');
            }}
            toast={toast}
          />
        )}
        {view === 'menu' && <MenuView onNavigate={navigate} toast={toast} />}
        {view === 'checkout' && <CartCheckoutView onOrderPlaced={handleOrderPlaced} onNavigate={navigate} toast={toast} />}
        {view === 'track' && <OrderTrackingView orderId={trackingOrderId} onBack={() => navigate('menu')} toast={toast} />}
        {view === 'account' && <ProfileView toast={toast} resetToken={resetToken} onResetHandled={() => setResetToken(null)} />}
        {view === 'support' && <SupportView onBack={() => navigate('menu')} toast={toast} />}
        {view === 'legal' && <LegalPoliciesView onBack={() => navigate('menu')} />}

        {/* ── Signature Footer & Gateway Legal Policies ── */}
        <footer style={{
          padding: '24px 16px 44px',
          textAlign: 'center',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--surface-1, rgba(0,0,0,0.02))',
          marginTop: 40,
          fontSize: '0.78rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <img src="food-logo.png" alt="GastroFood Logo" style={{ width: 22, height: 22, borderRadius: 5 }} />
            <span>GastroFlow Bistro & Marketplace Platform</span>
          </div>

          {/* Professional Policy Pill Grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 12px', marginBottom: 16 }}>
            <button
              onClick={() => navigate('legal')}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-1)', padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            >
              📄 Terms of Service
            </button>
            <button
              onClick={() => navigate('legal')}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-1)', padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            >
              🔒 Privacy Policy
            </button>
            <button
              onClick={() => navigate('legal')}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-1)', padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            >
              💸 Refund Policy
            </button>
            <button
              onClick={() => navigate('legal')}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-1)', padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            >
              🚚 Delivery Tariffs
            </button>
            <button
              onClick={() => navigate('legal')}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--brand)', padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
            >
              💳 Merchant Compliance
            </button>
          </div>

          {/* Signature & Founder Rights */}
          <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', maxWidth: 460, margin: '0 auto 12px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-1)', fontWeight: 700 }}>
              Crafted & Engineered by <strong style={{ color: 'var(--brand)' }}>RS Technologies</strong> 🇱🇰
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Owner & Founder: <strong style={{ color: 'var(--text-1)' }}>M.R.M Rashid</strong> · Certified Proprietary SaaS Engine
            </div>
          </div>

          <div style={{ fontSize: '0.68rem', opacity: 0.6, marginTop: 4 }}>
            © {new Date().getFullYear()} RS Technologies. All rights reserved. Registered in Sri Lanka.
          </div>
        </footer>
      </main>

      {/* Global 24/7 GastroAI Concierge Assistant */}
      <GastroAiConcierge onNavigate={navigate} cartItems={items} />

      {/* Cart Sheet */}
      <CartSheet onCheckout={() => navigate('checkout')} />

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button className={`nav-item ${view === 'restaurants' ? 'active' : ''}`} onClick={() => navigate('restaurants')}>
          <span className="nav-icon">🏪</span>
          Stores
        </button>
        <button className={`nav-item ${view === 'menu' ? 'active' : ''}`} onClick={() => navigate('menu')}>
          <span className="nav-icon">🍽️</span>
          {t('navMenu')}
        </button>
        <button className={`nav-item ${view === 'checkout' ? 'active' : ''}`} onClick={() => navigate('checkout')}>
          <span className="nav-icon">🛒</span>
          {t('navCart')}
          {totalItems > 0 && <span className="badge" style={{ position: 'static', fontSize: '0.6rem', padding: '1px 5px' }}>{totalItems}</span>}
        </button>
        <button className={`nav-item ${view === 'track' ? 'active' : ''}`} onClick={() => navigate('track')}>
          <span className="nav-icon">📦</span>
          {t('navTrack')}
        </button>
        <button className={`nav-item ${view === 'account' ? 'active' : ''}`} onClick={() => navigate('account')}>
          <span className="nav-icon">{customer ? '👤' : '🔑'}</span>
          {customer ? t('navAccount') : t('navSignIn')}
        </button>
      </nav>
    </div>
  );
}

// ── Root App ────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <CustomerAuthProvider>
          <CartProvider>
            <InnerApp />
          </CartProvider>
        </CustomerAuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
