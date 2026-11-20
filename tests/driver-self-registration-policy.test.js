import { describe, expect, it } from 'vitest';
import { driverRegisterSchema, driverOtpRequestSchema, driverOtpVerifySchema } from '../lib/validation.js';

const valid = {
  name: 'Test Rider', phone: '0771234567', password: 'secure-passphrase-123',
  email: 'driver@example.com', verificationCode: '123456', vehicleType: 'Motorbike', plateNumber: 'WP-1234', privacyAccepted: true
};

describe('driver self-registration validation boundary', () => {
  it('accepts bounded applications with explicit privacy acknowledgement', () => {
    expect(driverRegisterSchema.parse(valid).privacyAccepted).toBe(true);
    expect(driverRegisterSchema.safeParse({ ...valid, email: null }).success).toBe(false);
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

  it('supports verified email and separate recovery verification', () => {
    const {verificationCode: _unused,...withoutCode}=valid;
    expect(driverRegisterSchema.safeParse({...withoutCode,verificationToken:'x'.repeat(40)}).success).toBe(true);
    expect(driverOtpRequestSchema.safeParse({email:valid.email,flow:'recover'}).success).toBe(true);
    expect(driverOtpRequestSchema.safeParse({email:valid.email,flow:'register'}).success).toBe(true);
    expect(driverOtpRequestSchema.safeParse({email:valid.email,flow:'invalid'}).success).toBe(false);
    expect(driverOtpVerifySchema.safeParse({email:valid.email,verificationCode:'123456'}).success).toBe(true);
    expect(driverOtpVerifySchema.safeParse({email:valid.email,verificationCode:'1234'}).success).toBe(false);
  });

  it('accepts the explicitly supported vehicle options', () => {
    for (const vehicleType of ['Motorbike', 'TukTuk', 'Car', 'Bicycle']) {
      expect(driverRegisterSchema.safeParse({ ...valid, vehicleType }).success).toBe(true);
    }
  });
});
