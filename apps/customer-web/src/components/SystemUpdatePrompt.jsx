import React, { useState, useEffect } from 'react';

/**
 * SystemUpdatePrompt — Auto-detects server deployments and service worker updates,
 * displaying a prominent update banner with a "🚀 Update Now" button.
 */
export default function SystemUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [swRegistration, setSwRegistration] = useState(null);

  useEffect(() => {
    // 1. Listen to Service Worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        setSwRegistration(reg);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          }
        });
      }).catch(() => {});

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }

    // 2. Poll server version every 45s to detect server deployments
    let initialTimestamp = null;
    const checkServerVersion = async () => {
      try {
        const res = await fetch('/api/system/version');
        if (res.ok) {
          const data = await res.json();
          if (initialTimestamp === null) {
            initialTimestamp = data.buildTimestamp;
          } else if (data.buildTimestamp && data.buildTimestamp !== initialTimestamp) {
            setUpdateAvailable(true);
          }
        }
      } catch (_) {}
    };

    checkServerVersion();
    const interval = setInterval(checkServerVersion, 45000);
    return () => clearInterval(interval);
  }, []);

  const handleApplyUpdate = () => {
    setUpdating(true);
    if (swRegistration && swRegistration.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    setTimeout(() => {
      // Clear caches and reload
      if ('caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
      window.location.reload(true);
    }, 400);
  };

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 999999,
        maxWidth: 460,
        width: 'calc(100% - 32px)',
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#ffffff',
        borderRadius: 16,
        padding: '14px 18px',
        boxShadow: '0 12px 36px rgba(16,185,129,0.4)',
        display: 'flex',
        alignItems: 'center',
        justify: 'space-between',
        gap: 12,
        animation: 'slideUp 0.4s ease-out',
        border: '1px solid rgba(255,255,255,0.3)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>🎉</span>
        <div>
          <div style={{ fontWeight: 900, fontSize: '0.92rem', color: '#ffffff' }}>
            New System Update Ready!
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: 2 }}>
            A fresh update is available with new features.
          </div>
        </div>
      </div>

      <button
        onClick={handleApplyUpdate}
        disabled={updating}
        style={{
          background: '#ffffff',
          color: '#059669',
          border: 'none',
          padding: '10px 16px',
          borderRadius: 12,
          fontWeight: 900,
          fontSize: '0.85rem',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          transition: 'all 0.2s ease'
        }}
      >
        {updating ? '⏳ Updating…' : '🚀 Update Now'}
      </button>
    </div>
  );
}
