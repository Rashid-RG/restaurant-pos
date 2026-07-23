import React, { useState, useEffect, Component } from 'react';
import { CustomerAuthProvider, useCustomerAuth } from './context/CustomerAuthContext.jsx';
import { CartProvider, useCart } from './context/CartContext.jsx';
import { LanguageProvider, useLang } from './context/LanguageContext.jsx';
import Toast, { useToast } from './components/Toast.jsx';
import MenuView from './views/MenuView.jsx';
import CartCheckoutView from './views/CartCheckoutView.jsx';
import OrderTrackingView from './views/OrderTrackingView.jsx';
import ProfileView from './views/ProfileView.jsx';
import DriverView from './views/DriverView.jsx';
import RestaurantsView from './views/RestaurantsView.jsx';
import LegalPoliciesView from './views/LegalPoliciesView.jsx';

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
  const tax = subtotal * 0.10; // 10% tax matching server key key
  const total = subtotal + tax;

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
            <div className="cart-summary-row"><span>Tax (10%)</span><span>Rs. {tax.toFixed(2)}</span></div>
            <div className="cart-summary-row total"><span>Total</span><span>Rs. {total.toFixed(2)}</span></div>
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
    window.addEventListener('appinstalled', () => setVisible(false));
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
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
      // Direct instruction fallback if no native prompt is available
      if (isIOS) {
        alert("To Install GastroFlow on iPhone:\n\n1. Tap the Share button (📤) at the bottom.\n2. Scroll down and tap 'Add to Home Screen'.");
      } else {
        alert("To Install GastroFlow:\n\n1. Tap the browser menu (⁝ or ⋯) in the top-right.\n2. Select 'Add to Home Screen' or 'Install App'.");
      }
      dismiss();
    }
  };

  return (
    <div className="install-banner" role="dialog" aria-label="Install GastroFlow">
      <span style={{ fontSize: '1.6rem' }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-1)' }}>{t('installTitle')}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isIOS ? "Tap 📤 and select 'Add to Home Screen'" : t('installBody')}
        </div>
      </div>
      <button className="btn btn-brand" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }} onClick={install}>
        {deferred ? t('install') : 'Guide'}
      </button>
      <button aria-label="Dismiss" onClick={dismiss} style={{ fontSize: '1.2rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
    </div>
  );
}

// ── Inner App (needs context) ────────────────────────────────────────
function InnerApp() {
  const [view, setView] = useState('menu');
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const { customer, loading: authLoading } = useCustomerAuth();
  const { totalItems, setCartOpen } = useCart();
  const { messages, toast } = useToast();
  const { t, lang, setLang, languages } = useLang();

  // Deep links & Mode detection:
  // ?mode=driver, #driver, or persistent localStorage launches GastroDriver directly.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const track = params.get('track');
    const reset = params.get('reset');
    const mode = params.get('mode') || params.get('driver');
    const legal = params.get('legal') || params.get('policies');
    const hash = window.location.hash;
    const isDriverSaved = localStorage.getItem('gastroflow_driver_app') === 'true';

    if (mode === 'driver' || mode === '1' || mode === 'true' || hash === '#driver' || isDriverSaved) {
      localStorage.setItem('gastroflow_driver_app', 'true');
      setView('driver');
    } else if (track) {
      setTrackingOrderId(track);
      setView('track');
    } else if (reset) {
      setResetToken(reset);
      setView('account');
    } else if (legal) {
      setView('legal');
    }
    if (track || reset) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (authLoading) return (
    <div className="page-loading">
      <div className="spinner" />
      <p>{t('loading')}</p>
    </div>
  );

  const navigate = (v) => {
    if (v === 'driver') {
      localStorage.setItem('gastroflow_driver_app', 'true');
    } else {
      localStorage.removeItem('gastroflow_driver_app');
    }
    setView(v);
  };

  const handleOrderPlaced = (orderId) => {
    setTrackingOrderId(orderId);
    setView('track');
  };

  // Dedicated Standalone Driver App View
  if (view === 'driver') {
    return (
      <div className="app-shell" style={{ background: '#0a0f1d', color: '#f8fafc', minHeight: '100dvh' }}>
        <Toast messages={messages} />
        <header className="top-header" style={{ background: '#111827', borderBottom: '1px solid #1f2937' }}>
          <img src="/driver-logo.png" alt="GastroDriver Logo" style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'cover' }} />
          <span className="restaurant-name" style={{ color: '#10b981', fontWeight: 800, fontSize: '1.1rem', marginLeft: 8 }}>GastroDriver</span>
          <button
            onClick={() => {
              localStorage.removeItem('gastroflow_driver_app');
              setView('menu');
            }}
            style={{
              fontSize: '0.78rem',
              background: '#1f2937',
              color: '#10b981',
              border: '1px solid #10b98150',
              padding: '6px 12px',
              borderRadius: 14,
              fontWeight: 700,
              marginLeft: 'auto',
              cursor: 'pointer'
            }}
          >
            🍔 Switch to Food App
          </button>
        </header>
        <main className="main-content" style={{ padding: '16px 12px 32px' }}>
          <DriverView toast={toast} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toast messages={messages} />
      <InstallPrompt />

      {/* Top Header */}
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/food-logo.png" alt="GastroFood Logo" style={{ width: '38px', height: '38px', borderRadius: '10px', objectFit: 'cover', boxShadow: '0 2px 8px rgba(255,107,53,0.25)' }} />
          <span className="restaurant-name" style={{ fontSize: '1.35rem', fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: '#ff6b35', letterSpacing: '-0.5px' }}>
            GastroFlow
          </span>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => navigate('driver')} title="Open Driver Rider Portal" style={{ fontSize: '1.1rem', background: '#10b98120', border: '1px solid #10b98150' }}>
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
              setView('menu');
            }}
            toast={toast}
          />
        )}
        {view === 'menu' && <MenuView onNavigate={navigate} toast={toast} />}
        {view === 'checkout' && <CartCheckoutView onOrderPlaced={handleOrderPlaced} onNavigate={navigate} toast={toast} />}
        {view === 'track' && <OrderTrackingView orderId={trackingOrderId} onBack={() => navigate('menu')} toast={toast} />}
        {view === 'account' && <ProfileView toast={toast} resetToken={resetToken} onResetHandled={() => setResetToken(null)} />}
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
            <img src="/food-logo.png" alt="GastroFood Logo" style={{ width: 22, height: 22, borderRadius: 5 }} />
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
