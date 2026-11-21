import { describe, it, expect } from 'vitest';
import { OTP_PURPOSES, isOtpPurpose, canCreateCustomerSession } from '../lib/otp-purposes.js';

describe('purpose-bound OTP verification', () => {
  it('recognizes login, registration and order verification but not arbitrary purposes', () => {
    expect(OTP_PURPOSES).toEqual(['login','phone_verify','order_verify']);
    for (const purpose of OTP_PURPOSES) expect(isOtpPurpose(purpose)).toBe(true);
    for (const purpose of ['guest_support','guest_support_verify','reset','order_verify_login','',null,undefined]) {
      expect(isOtpPurpose(purpose)).toBe(false);
    }
  });
  it('never permits a checkout or registration verification to issue a login session', () => {
    expect(canCreateCustomerSession('login')).toBe(true);
    expect(canCreateCustomerSession('phone_verify')).toBe(false);
    expect(canCreateCustomerSession('order_verify')).toBe(false);
  });
});
