import { describe, expect, it } from 'vitest';
import * as identity from '../lib/identity/index.js';
import * as communications from '../lib/communications/index.js';
import * as oldContact from '../lib/customer-contact-validation.js';
import * as oldCredentials from '../lib/credential-generation.js';
import * as oldLinks from '../lib/app-links.js';

describe('identity and communications domain contracts', () => {
  it('retains the exact legacy identity exports', () => {
    expect(identity.isValidSriLankanPhone).toBe(oldContact.isValidSriLankanPhone);
    expect(identity.isValidAddress).toBe(oldContact.isValidAddress);
    expect(identity.generateStrongPassword).toBe(oldCredentials.generateStrongPassword);
    expect(identity.generateSecurePin).toBe(oldCredentials.generateSecurePin);
  });
  it('retains the exact legacy communications exports', () => {
    expect(communications.customerAppUrl).toBe(oldLinks.customerAppUrl);
    expect(communications.posAppUrl).toBe(oldLinks.posAppUrl);
  });
  it('keeps customer contact acceptance and POS link precedence unchanged', () => {
    expect(identity.isValidSriLankanPhone('+94771234567')).toBe(true);
    expect(identity.isValidAddress(' Colombo ')).toBe(true);
    expect(communications.customerAppUrl({ CUSTOMER_APP_URL: 'https://food.example.test', CORS_ORIGIN: 'https://fallback.example.test' }))
      .toBe('https://food.example.test');
    expect(communications.posAppUrl({ POS_APP_URL: 'https://pos.example.test' }))
      .toBe('https://pos.example.test');
  });
});
