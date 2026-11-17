import { describe, expect, it, vi } from 'vitest';
import { createRegistrationOtpVerifier } from '../lib/identity/index.js';

describe('tenant-bound customer registration OTP', () => {
  it('requires a verifier dependency', () => {
    expect(() => createRegistrationOtpVerifier({})).toThrow(TypeError);
  });

  it('accepts a phone OTP only within the selected restaurant', async () => {
    const verifyOTPAsync = vi.fn(async (dest,code,purpose,tenant) => tenant === 'restaurant-A' && dest === '0771234567');
    const verify = createRegistrationOtpVerifier({verifyOTPAsync});
    expect(await verify({tenantId:'restaurant-A',phone:'0771234567',email:'a@example.test',code:'123456'})).toBe(true);
    expect(await verify({tenantId:'restaurant-B',phone:'0771234567',email:null,code:'123456'})).toBe(false);
    expect(verifyOTPAsync).toHaveBeenNthCalledWith(1,'0771234567','123456','phone_verify','restaurant-A');
    expect(verifyOTPAsync).toHaveBeenNthCalledWith(2,'0771234567','123456','phone_verify','restaurant-B');
    expect(verifyOTPAsync).toHaveBeenCalledTimes(2);
  });

  it('uses email verification only after a failed phone OTP and retains the tenant', async () => {
    const verifyOTPAsync = vi.fn(async dest => dest === 'a@example.test');
    const verify = createRegistrationOtpVerifier({verifyOTPAsync});
    expect(await verify({tenantId:'restaurant-A',phone:'0771234567',email:'a@example.test',code:'654321'})).toBe(true);
    expect(verifyOTPAsync.mock.calls).toEqual([
      ['0771234567','654321','phone_verify','restaurant-A'],
      ['a@example.test','654321','phone_verify','restaurant-A']
    ]);
  });

  it('fails closed without restaurant identity or a valid challenge', async () => {
    const verifyOTPAsync = vi.fn(async()=>false);
    const verify=createRegistrationOtpVerifier({verifyOTPAsync});
    expect(await verify({tenantId:'',phone:'0771234567',email:'a@example.test',code:'123456'})).toBe(false);
    expect(await verify({tenantId:null,phone:'0771234567',email:'a@example.test',code:'123456'})).toBe(false);
    expect(verifyOTPAsync).not.toHaveBeenCalled();
    expect(await verify({tenantId:'restaurant-A',phone:'0771234567',email:null,code:'123456'})).toBe(false);
    expect(verifyOTPAsync).toHaveBeenCalledTimes(1);
  });

  it('propagates OTP provider errors instead of checking a different tenant', async () => {
    const verifyOTPAsync=vi.fn(async()=>{throw Error('OTP storage unavailable')});
    const verify=createRegistrationOtpVerifier({verifyOTPAsync});
    await expect(verify({tenantId:'restaurant-A',phone:'0771234567',email:'a@example.test',code:'123456'})).rejects.toThrow('OTP storage unavailable');
    expect(verifyOTPAsync).toHaveBeenCalledTimes(1);
  });
});
