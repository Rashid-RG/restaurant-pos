import { describe, expect, it, vi } from 'vitest';
import { createCustomerRegistrationDuplicates, isCustomerRegistrationUniqueConflict } from '../lib/identity/index.js';

describe('tenant-bound customer registration uniqueness', () => {
  it('requires an explicit database reader and tenant identity', async () => {
    expect(() => createCustomerRegistrationDuplicates({})).toThrow(TypeError);
    const dbGet=vi.fn();
    const find=createCustomerRegistrationDuplicates({dbGet});
    await expect(find({tenantId:'',phone:'0771234567'})).rejects.toThrow('Restaurant tenant required');
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('does not treat the same phone in another restaurant as a duplicate', async () => {
    const dbGet=vi.fn(async (sql,params) => params[0] === 'restaurant-A' ? {id:'account-A'} : null);
    const find=createCustomerRegistrationDuplicates({dbGet});
    expect(await find({
      tenantId:'restaurant-B',phone:'0771234567',normalizedPhone:'+94771234567',
      originalPhone:'077 123-4567',email:'guest@example.test'
    })).toBeNull();
    expect(dbGet).toHaveBeenNthCalledWith(1,
      'SELECT id FROM customer_accounts WHERE tenant_id=? AND (phone=? OR phone=? OR phone=?)',
      ['restaurant-B','0771234567','+94771234567','077 123-4567']);
    expect(dbGet).toHaveBeenNthCalledWith(2,
      'SELECT id FROM customer_accounts WHERE tenant_id=? AND LOWER(email)=LOWER(?)',
      ['restaurant-B','guest@example.test']);
    expect(dbGet).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicates owned by the same restaurant', async () => {
    const dbGet=vi.fn(async(sql)=>sql.includes('phone=?') ? {id:'existing'} : null);
    const find=createCustomerRegistrationDuplicates({dbGet});
    expect(await find({tenantId:'restaurant-A',phone:'0771234567',normalizedPhone:'+94771234567'})).toBe('phone');
    expect(dbGet).toHaveBeenCalledTimes(1);
    dbGet.mockImplementation(async sql => sql.includes('LOWER(email)') ? {id:'existing'} : null);
    expect(await find({tenantId:'restaurant-A',phone:'0770000000',normalizedPhone:'+94770000000',email:'guest@example.test'})).toBe('email');
  });

  it('classifies only customer unique conflicts as expected legacy storage limitations', () => {
    expect(isCustomerRegistrationUniqueConflict(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: customer_accounts.email'))).toBe(true);
    expect(isCustomerRegistrationUniqueConflict(new Error('duplicate key value violates unique constraint "customer_accounts_email_key"'))).toBe(true);
    expect(isCustomerRegistrationUniqueConflict(new Error('database unavailable'))).toBe(false);
    expect(isCustomerRegistrationUniqueConflict(new Error('UNIQUE constraint failed: orders.id'))).toBe(false);
  });
});
