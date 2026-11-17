import { describe, expect, it, vi } from 'vitest';
import { createPasswordResetIssuer, PASSWORD_RESET_TTL_MS } from '../lib/identity/index.js';

function harness(overrides={}) {
  const dbRun = vi.fn(async()=>({changes:1}));
  const generateToken = vi.fn(()=> 'test-reset-token');
  const generateOtp = vi.fn(()=> '123456');
  const hashCode = vi.fn(value=>`hashed:${value}`);
  const now = vi.fn(()=>1000000);
  const random = vi.fn(()=>0.5);
  const deps = {dbRun,generateToken,generateOtp,hashCode,now,random,...overrides};
  return {...deps,issue:createPasswordResetIssuer(deps)};
}

describe('identity domain password recovery issuance',()=>{
  it('requires explicit persistence, generators and hash provider',()=>{
    expect(()=>createPasswordResetIssuer({})).toThrow(TypeError);
  });

  it('retains existing token and OTP generator sizes and hashed storage',async()=>{
    const h=harness();
    const result=await h.issue('customer','customer-A');
    expect(result).toEqual({token:'test-reset-token',code:'123456'});
    expect(h.generateToken).toHaveBeenCalledWith(24);
    expect(h.generateOtp).toHaveBeenCalledWith(6);
    expect(h.dbRun).toHaveBeenCalledTimes(2);
    expect(h.dbRun.mock.calls[0]).toEqual([
      'DELETE FROM password_resets WHERE userType = ? AND userId = ? AND consumedAt IS NULL',
      ['customer','customer-A']
    ]);
    const [sql,params]=h.dbRun.mock.calls[1];
    expect(sql).toContain('INSERT INTO password_resets');
    expect(params).toEqual([
      'pr_1000000_i', 'customer','customer-A','hashed:test-reset-token',
      'hashed:123456',1000000+PASSWORD_RESET_TTL_MS,1000000
    ]);
    expect(params).not.toContain(result.token);
    expect(params).not.toContain(result.code);
  });

  it('preserves staff recovery context without affecting another user',async()=>{
    const h=harness();
    await h.issue('staff','staff-B');
    expect(h.dbRun.mock.calls[0][1]).toEqual(['staff','staff-B']);
    expect(h.dbRun.mock.calls[1][1].slice(1,3)).toEqual(['staff','staff-B']);
  });

  it('does not insert a new recovery record if invalidation fails',async()=>{
    const h=harness({dbRun:vi.fn(async()=>{throw Error('database unavailable')})});
    await expect(h.issue('customer','customer-A')).rejects.toThrow('database unavailable');
    expect(h.dbRun).toHaveBeenCalledTimes(1);
  });
});
