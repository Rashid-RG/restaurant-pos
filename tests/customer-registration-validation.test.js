import { describe, expect, it } from 'vitest';
import { isSixDigitOtp, validRegistrationPassword } from '../apps/customer-web/src/utils/registration-validation.js';

describe('GastroFood registration verification', () => {
  it('accepts actual six-digit codes, including codes with leading zeros', () => {
    expect(isSixDigitOtp('962346')).toBe(true);
    expect(isSixDigitOtp('012345')).toBe(true);
    expect(isSixDigitOtp(' 962346 ')).toBe(true);
  });
  it('rejects regex escape artifacts, incomplete and non-numeric codes', () => {
    for (const code of ['\\d{6}', '12345', '1234567', 'ABCDEF', '12 456', '', null]) {
      expect(isSixDigitOtp(code)).toBe(false);
    }
  });
  it('requires 10–72 characters and does not silently accept short passwords', () => {
    expect(validRegistrationPassword('123456789')).toBe(false);
    expect(validRegistrationPassword('1234567890')).toBe(true);
    expect(validRegistrationPassword('x'.repeat(72))).toBe(true);
    expect(validRegistrationPassword('x'.repeat(73))).toBe(false);
  });
});