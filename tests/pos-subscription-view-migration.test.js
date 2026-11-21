import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import LegacySubscriptionBilling from '../src/components/SubscriptionBilling.jsx';
import PosSubscriptionBilling from '../apps/pos-web/src/components/SubscriptionBilling.jsx';

describe('POS subscription billing view migration', () => {
  it('retains the exact same component at the original import path', () => {
    expect(LegacySubscriptionBilling).toBe(PosSubscriptionBilling);
  });

  it('retains the initial billing view without initiating a payment', () => {
    const markup = renderToStaticMarkup(React.createElement(PosSubscriptionBilling));
    expect(markup).toContain('Restaurant subscription');
    expect(markup).toContain('Plan and billing');
    expect(markup).toContain('Loading billing');
    expect(markup).not.toContain('Continue to recurring checkout');
  });

  it('does not change the API, payment allowlist, session token or running app entrypoint', () => {
    const source=readFileSync('apps/pos-web/src/components/SubscriptionBilling.jsx','utf8');
    const legacy=readFileSync('src/components/SubscriptionBilling.jsx','utf8');
    const html=readFileSync('index.html','utf8');
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    expect(source).toContain("fetch('/api/saas/billing'+path");
    expect(source).toContain("localStorage.getItem('gastroflow_token')");
    expect(source).toContain('https://sandbox.payhere.lk/pay/checkout');
    expect(source).toContain('https://www.payhere.lk/pay/checkout');
    expect(legacy).toContain("../../apps/pos-web/src/components/SubscriptionBilling.jsx");
    expect(html).toContain('src="/src/main.jsx"');
    expect(pkg.scripts.build).toBe('vite build');
  });
});
