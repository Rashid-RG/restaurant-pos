import { describe, expect, it } from 'vitest';
import { driverRegisterSchema } from '../lib/validation.js';

const valid = {
  name: 'Test Rider', phone: '0771234567', password: 'secure-passphrase-123',
  email: '', vehicleType: 'Motorbike', plateNumber: 'WP-1234', privacyAccepted: true
};

describe('driver self-registration validation boundary', () => {
  it('accepts bounded applications with explicit privacy acknowledgement', () => {
    expect(driverRegisterSchema.parse(valid).privacyAccepted).toBe(true);
    expect(driverRegisterSchema.parse({ ...valid, email: null }).email).toBeNull();
  });

  it('rejects no consent, weak passwords, malformed phones and unsupported vehicles', () => {
    for (const patch of [
      { privacyAccepted: false }, { password: '123456' }, { phone: 'invalid!' },
      { vehicleType: 'Spaceship' }, { name: 'x' }, { plateNumber: 'X'.repeat(25) },
      { extra: 'unapproved attribute' }
    ]) {
      expect(driverRegisterSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });

  it('accepts the explicitly supported vehicle options', () => {
    for (const vehicleType of ['Motorbike', 'TukTuk', 'Car', 'Bicycle']) {
      expect(driverRegisterSchema.safeParse({ ...valid, vehicleType }).success).toBe(true);
    }
  });
});
