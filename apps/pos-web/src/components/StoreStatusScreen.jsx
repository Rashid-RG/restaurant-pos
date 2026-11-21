import React, { useState } from 'react';
import { AlertTriangle, Lock, Trash2, RefreshCw, LogOut, ArrowRight, PhoneCall, Mail, ShieldAlert } from 'lucide-react';

export default function StoreStatusScreen({
  status = 'suspended', // 'suspended' | 'deleted'
  storeId = '',
  storeName = '',
  customMessage = '',
  onRefresh = () => {},
  onSignOut = () => {}
}) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState('');

  const isSuspended = status === 'suspended';
  const isDeleted = status === 'deleted';

  const handleRecheck = async () => {
    setChecking(true);
    setCheckResult('');
    try {
      const activeTenant = storeId || new URLSearchParams(window.location.search).get('tenant') || 'default_tenant';
      const res = await fetch(`/api/public/tenant/status?tenant=${encodeURIComponent(activeTenant)}`);
      const data = await res.json();
      if (res.ok && data.exists && data.status === 'active') {
        setCheckResult('✅ Store is now ACTIVE! Reloading workspace...');
        setTimeout(() => {
          onRefresh();
          window.location.reload();
        }, 1200);
      } else if (data.status === 'suspended') {
        setCheckResult('⚠️ Store is still suspended by platform administration.');
      } else {
        setCheckResult('❌ Store record was not found or has been removed.');
      }
    } catch (_) {
      setCheckResult('❌ Could not connect to platform server.');
    } finally {
      setChecking(false);
    }
  };

  const handleGoToMain = () => {
    try {
      localStorage.removeItem('gastroflow_token');
      localStorage.removeItem('gastroflow_user');
      const url = new URL(window.location.href);
      url.searchParams.delete('tenant');
      url.searchParams.delete('tenantId');
      window.location.href = url.pathname;
    } catch (_) {
      window.location.href = '/';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      backgroundColor: '#090d16',
      backgroundImage: 'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(220, 38, 38, 0.15), rgba(9, 13, 22, 1))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      color: '#f8fafc'
    }}>
      <div style={{
        maxWidth: '540px',
        width: '100%',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(20px)',
        border: isSuspended ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
        borderRadius: '24px',
        padding: '36px 32px',
        boxShadow: isSuspended
          ? '0 25px 50px -12px rgba(245, 158, 11, 0.15), 0 0 0 1px rgba(245, 158, 11, 0.1)'
          : '0 25px 50px -12px rgba(239, 68, 68, 0.2), 0 0 0 1px rgba(239, 68, 68, 0.15)',
        textAlign: 'center',
        animation: 'fadeIn 0.3s ease-out'
      }}>
        {/* Animated Icon Glow */}
        <div style={{
          width: '84px',
          height: '84px',
          borderRadius: '50%',
          margin: '0 auto 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSuspended
            ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.05))'
            : 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(185, 28, 28, 0.05))',
          border: isSuspended ? '2px solid rgba(245, 158, 11, 0.5)' : '2px solid rgba(239, 68, 68, 0.5)',
          boxShadow: isSuspended ? '0 0 30px rgba(245, 158, 11, 0.25)' : '0 0 30px rgba(239, 68, 68, 0.3)'
        }}>
          {isSuspended ? (
            <Lock size={40} color="#f59e0b" style={{ filter: 'drop-shadow(0 0 8px rgba(245,158,11,0.5))' }} />
          ) : (
            <Trash2 size={40} color="#ef4444" style={{ filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.5))' }} />
          )}
        </div>

        {/* Status Badge */}
        <div style={{ marginBottom: '14px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '9999px',
            fontSize: '0.78rem',
            fontWeight: '700',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: isSuspended ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: isSuspended ? '#fbbf24' : '#f87171',
            border: isSuspended ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isSuspended ? '#fbbf24' : '#f87171',
              boxShadow: isSuspended ? '0 0 8px #fbbf24' : '0 0 8px #f87171'
            }} />
            {isSuspended ? 'STORE SUSPENDED' : 'STORE TERMINATED / NOT FOUND'}
          </span>
        </div>

        {/* Main Title */}
        <h1 style={{
          fontSize: '1.65rem',
          fontWeight: '800',
          margin: '0 0 8px',
          letterSpacing: '-0.02em',
          color: '#f8fafc'
        }}>
          {isSuspended ? 'Restaurant Store Suspended' : 'Restaurant Store Not Found'}
        </h1>

        {/* Store Identifier if known */}
        {(storeName || storeId) && (
          <div style={{
            fontSize: '0.9rem',
            color: '#94a3b8',
            marginBottom: '16px',
            fontWeight: '500'
          }}>
            Target Instance: <span style={{ color: '#e2e8f0', fontWeight: '600' }}>{storeName || storeId}</span>
          </div>
        )}

        {/* Description */}
        <p style={{
          fontSize: '0.92rem',
          lineHeight: '1.55',
          color: '#cbd5e1',
          margin: '0 0 24px',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '14px 18px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.06)'
        }}>
          {customMessage || (
            isSuspended
              ? 'This store instance has been temporarily suspended by the platform administrator. Access to the POS terminal, Kitchen Display (KDS), and customer ordering is paused.'
              : 'This store instance has been permanently deleted or does not exist on this platform. Its data and credentials are no longer active.'
          )}
        </p>

        {/* Recheck Feedback Banner */}
        {checkResult && (
          <div style={{
            marginBottom: '18px',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '0.85rem',
            background: checkResult.startsWith('✅') ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: checkResult.startsWith('✅') ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
            color: checkResult.startsWith('✅') ? '#4ade80' : '#fca5a5'
          }}>
            {checkResult}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {isSuspended && (
            <button
              onClick={handleRecheck}
              disabled={checking}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '12px 20px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0f172a',
                fontSize: '0.92rem',
                fontWeight: '700',
                border: 'none',
                cursor: checking ? 'not-allowed' : 'pointer',
                opacity: checking ? 0.7 : 1,
                boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
                transition: 'all 0.2s ease'
              }}
            >
              <RefreshCw size={18} style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} />
              {checking ? 'Checking Status...' : 'Check If Reactivated'}
            </button>
          )}

          <button
            onClick={onSignOut || handleGoToMain}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '12px 20px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#f8fafc',
              fontSize: '0.92rem',
              fontWeight: '600',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
          >
            <LogOut size={18} />
            Sign Out / Switch Store
          </button>

          {isDeleted && (
            <button
              onClick={handleGoToMain}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '12px 20px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#ffffff',
                fontSize: '0.92rem',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(59, 130, 246, 0.35)'
              }}
            >
              <ArrowRight size={18} />
              Go to Primary Platform Store
            </button>
          )}
        </div>

        {/* Footer Support Info */}
        <div style={{
          marginTop: '24px',
          paddingTop: '18px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: '0.8rem',
          color: '#64748b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px'
        }}>
          <ShieldAlert size={14} color="#64748b" />
          <span>Need help? Contact your GastroFlow platform administrator.</span>
        </div>
      </div>
    </div>
  );
}
