import { describe, expect, it } from 'vitest';
import { customerAppUrl, posAppUrl } from '../lib/app-links.js';

describe('existing app-link configuration precedence', () => {
  it('resolves the explicit customer app origin first', () => {
    expect(customerAppUrl({ CUSTOMER_APP_URL:'https://food.example.test', CORS_ORIGIN:'https://pos.example.test' }))
      .toBe('https://food.example.test');
  });
  it('uses CORS origin when customer origin is not configured', () => {
    expect(customerAppUrl({ CORS_ORIGIN:'https://staging.example.test' })).toBe('https://staging.example.test');
  });
  it('keeps the legacy localhost defaults in development', () => {
    expect(customerAppUrl({})).toBe('http://localhost:3001');
    expect(posAppUrl({})).toBe('http://localhost:3000');
  });
  it('does not substitute a customer URL for the POS reset URL', () => {
    expect(posAppUrl({ POS_APP_URL:'https://pos.example.test', CUSTOMER_APP_URL:'https://food.example.test' }))
      .toBe('https://pos.example.test');
  });
  it('preserves fallback behavior for blank values', () => {
    expect(customerAppUrl({ CUSTOMER_APP_URL:'', CORS_ORIGIN:'https://fallback.example.test' }))
      .toBe('https://fallback.example.test');
    expect(posAppUrl({ POS_APP_URL:'' })).toBe('http://localhost:3000');
  });
});
