import { describe, it, expect } from 'vitest';
import { shouldForgetCustomerSession } from '../apps/customer-web/src/utils/auth-recovery.js';

describe('customer session resilience', () => {
  it('only forgets a session after explicit authentication denial', () => {
    expect(shouldForgetCustomerSession({ status: 401 })).toBe(true);
    expect(shouldForgetCustomerSession({ status: 403 })).toBe(true);
    for (const error of [null, new Error('Connection timeout'), { status: 0 }, { status: 429 }, { status: 500 }, { status: 503 }]) {
      expect(shouldForgetCustomerSession(error)).toBe(false);
    }
  });
});
