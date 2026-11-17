import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LegacyStoreStatusScreen from '../src/components/StoreStatusScreen.jsx';
import PosStoreStatusScreen from '../apps/pos-web/src/components/StoreStatusScreen.jsx';

describe('POS store status screen migration contract', () => {
  it('exposes the exact same component at the original POS import path', () => {
    expect(LegacyStoreStatusScreen).toBe(PosStoreStatusScreen);
  });

  it('preserves the suspended-store view and sign-out action', () => {
    const html=renderToStaticMarkup(React.createElement(PosStoreStatusScreen, {
      status:'suspended',storeId:'restaurant-A',storeName:'A Restaurant',customMessage:'Contact support'
    }));
    expect(html).toContain('STORE SUSPENDED');
    expect(html).toContain('A Restaurant');
    expect(html).toContain('Contact support');
    expect(html).toContain('Check If Reactivated');
    expect(html).toContain('Sign Out / Switch Store');
  });

  it('preserves deleted-store restriction and does not show reactivation control', () => {
    const html=renderToStaticMarkup(React.createElement(PosStoreStatusScreen, {
      status:'deleted',storeId:'restaurant-B'
    }));
    expect(html).toContain('Restaurant Store Not Found');
    expect(html).toContain('Sign Out / Switch Store');
    expect(html).not.toContain('Check If Reactivated');
  });

  it('retains tenant-status check URL, existing POS route and unchanged app bootstrap', () => {
    const source=readFileSync('apps/pos-web/src/components/StoreStatusScreen.jsx','utf8');
    const app=readFileSync('src/App.jsx','utf8');
    const html=readFileSync('index.html','utf8');
    expect(source).toContain('/api/public/tenant/status?tenant=');
    expect(source).toContain("localStorage.removeItem('gastroflow_token')");
    expect(app).toContain("import StoreStatusScreen from './components/StoreStatusScreen'");
    expect(html).toContain('src="/src/main.jsx"');
  });
});
