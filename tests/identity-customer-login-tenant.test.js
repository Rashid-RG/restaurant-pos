import { describe, expect, it, vi } from 'vitest';
import { createCustomerLoginLookup } from '../lib/identity/index.js';

describe('restaurant-scoped customer login lookup', () => {
  it('requires explicit data access and phone normalizer', () => {
    expect(() => createCustomerLoginLookup({})).toThrow(TypeError);
  });

  it('queries only the selected restaurant and never falls back across tenants', async () => {
    const dbGet = vi.fn(async (_sql, args) => args[0] === 'restaurant-A' ? { id: 'account-A', tenant_id: 'restaurant-A' } : null);
    const normalizeLkPhone = vi.fn(value => value.startsWith('0') ? '+94' + value.slice(1) : value);
    const lookup = createCustomerLoginLookup({dbGet,normalizeLkPhone});
    expect(await lookup('restaurant-A','077 123-4567')).toMatchObject({id:'account-A'});
    expect(await lookup('restaurant-B','077 123-4567')).toBeNull();
    expect(dbGet).toHaveBeenNthCalledWith(1,
      'SELECT * FROM customer_accounts WHERE tenant_id=? AND (phone=? OR phone=?)',
      ['restaurant-A','+94771234567','0771234567']);
    expect(dbGet).toHaveBeenNthCalledWith(2,
      'SELECT * FROM customer_accounts WHERE tenant_id=? AND (phone=? OR phone=?)',
      ['restaurant-B','+94771234567','0771234567']);
    expect(dbGet).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no tenant was resolved', async () => {
    const dbGet=vi.fn();
    const lookup=createCustomerLoginLookup({dbGet,normalizeLkPhone:x=>x});
    await expect(lookup('', '0771234567')).rejects.toThrow('Restaurant tenant required');
    await expect(lookup(undefined, '0771234567')).rejects.toThrow('Restaurant tenant required');
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('propagates database errors instead of silently trying another restaurant', async () => {
    const dbGet=vi.fn(async()=>{throw new Error('database unavailable')});
    const lookup=createCustomerLoginLookup({dbGet,normalizeLkPhone:x=>x});
    await expect(lookup('restaurant-A','0771234567')).rejects.toThrow('database unavailable');
    expect(dbGet).toHaveBeenCalledTimes(1);
  });
});
