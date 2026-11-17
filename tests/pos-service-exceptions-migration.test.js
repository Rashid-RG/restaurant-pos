import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import LegacyServiceExceptions from '../src/components/ServiceExceptions.jsx';
import PosServiceExceptions from '../apps/pos-web/src/components/ServiceExceptions.jsx';

describe('POS service exceptions component relocation', () => {
  it('preserves component identity across legacy and POS app import paths', () => {
    expect(LegacyServiceExceptions).toBe(PosServiceExceptions);
  });

  it('preserves existing tenant- and staff-bound pending action storage and retry logic', () => {
    const source = readFileSync('apps/pos-web/src/components/ServiceExceptions.jsx', 'utf8');
    expect(source).toContain('gastroflow:service-change:');
    expect(source).toContain('currentUser?.tenant_id');
    expect(source).toContain('currentUser?.id');
    expect(source).toContain('sessionStorage.setItem(key, JSON.stringify(attempt))');
    expect(source).toContain('requestId: crypto.randomUUID()');
    expect(source).toContain('revision: ticket.revision');
    expect(source).toContain('lock.current');
  });

  it('preserves server-side billing authority and POS entrypoint compatibility', () => {
    const source = readFileSync('apps/pos-web/src/components/ServiceExceptions.jsx', 'utf8');
    const legacy = readFileSync('src/components/ServiceExceptions.jsx', 'utf8');
    const html = readFileSync('index.html', 'utf8');
    expect(source).toContain('"/api/service-exceptions/" + attempt.orderId');
    expect(source).toContain('The server recalculates the bill at current menu prices');
    expect(source).toContain('from "../../../../src/context/POSContext"');
    expect(legacy).toContain('../../apps/pos-web/src/components/ServiceExceptions.jsx');
    expect(html).toContain('src="/src/main.jsx"');
  });
});
