import { describe, expect, it } from 'vitest';
import { isValidSriLankanPhone, isValidAddress } from '../lib/customer-contact-validation.js';

describe('customer phone and address compatibility policy', () => {
  it('accepts Sri Lankan mobile contact formats used by checkout and OTP', () => {
    expect(isValidSriLankanPhone('0771234567')).toBe(true);
    expect(isValidSriLankanPhone('+94771234567')).toBe(true);
    expect(isValidSriLankanPhone('077 123 4567')).toBe(true);
    expect(isValidSriLankanPhone('077-123-4567')).toBe(true);
  });
  it('rejects non-mobile and unsupported country-prefix forms', () => {
    for (const phone of ['', null, '0111234567', '94771234567', '+94111234567', '077123456', '07712345678']) {
      expect(isValidSriLankanPhone(phone)).toBe(false);
    }
  });
  it('keeps the existing address minimum length and whitespace handling', () => {
    expect(isValidAddress('  A12  ')).toBe(true);
    expect(isValidAddress(' Colombo ')).toBe(true);
    expect(isValidAddress(' a ')).toBe(false);
    expect(isValidAddress('   ')).toBe(false);
    expect(isValidAddress(null)).toBe(false);
    expect(isValidAddress({ street: 'Main' })).toBe(false);
  });
});
