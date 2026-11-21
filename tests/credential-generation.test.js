import { describe, expect, it } from 'vitest';
import { generateStrongPassword, generateSecurePin } from '../lib/credential-generation.js';

describe('CSPRNG-backed provisioning credentials', () => {
  it('generates the expected default password length with every required character class', () => {
    for (let i = 0; i < 25; i++) {
      const pwd = generateStrongPassword();
      expect(pwd).toHaveLength(10);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#$%&*]/);
      expect(pwd).not.toMatch(/[OIl1o0]/);
    }
  });
  it('supports the existing explicit 16-character demo provisioning flow', () => {
    expect(generateStrongPassword(16)).toHaveLength(16);
  });
  it('generates six-digit PINs, preserving possible leading zeros', () => {
    for (let i = 0; i < 25; i++) {
      expect(generateSecurePin()).toMatch(/^\d{6}$/);
      expect(generateSecurePin(8)).toMatch(/^\d{8}$/);
    }
  });
  it('uses independent random results instead of a deterministic sequence', () => {
    const samples = Array.from({length: 12}, () => generateStrongPassword());
    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});
