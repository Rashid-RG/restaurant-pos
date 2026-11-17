import { describe, expect, it, vi } from 'vitest';
import { createReleaseOrderLoyalty } from '../lib/orders/index.js';

describe('tenant-bound cancellation loyalty reversal', () => {
  it('requires both injected database dependencies', () => {
    expect(() => createReleaseOrderLoyalty({})).toThrow(TypeError);
  });

  it('uses the explicit tenant for the order, customer and reversal update', async () => {
    const dbGet = vi.fn(async () => ({ customerAccountId:'account-A', loyaltyPointsReserved:90, loyaltyReversed:0 }));
    const dbRun = vi.fn(async () => ({changes:1}));
    await createReleaseOrderLoyalty({dbGet,dbRun})('order-A','restaurant-A');
    expect(dbGet).toHaveBeenCalledWith(
      expect.stringContaining('FROM orders WHERE id=? AND tenant_id=?'), ['order-A','restaurant-A']
    );
    expect(dbRun).toHaveBeenNthCalledWith(1,
      expect.stringContaining('WHERE id=? AND tenant_id=?'), [90,'account-A','restaurant-A']
    );
    expect(dbRun).toHaveBeenNthCalledWith(2,
      expect.stringContaining('WHERE id=? AND tenant_id=?'), ['order-A','restaurant-A']
    );
  });

  it('does not credit unreserved or already reversed points', async () => {
    const dbRun = vi.fn();
    for(const row of [null,{customerAccountId:'A',loyaltyPointsReserved:0,loyaltyReversed:0},
      {customerAccountId:'A',loyaltyPointsReserved:100,loyaltyReversed:1}]) {
      const dbGet = vi.fn(async () => row);
      await createReleaseOrderLoyalty({dbGet,dbRun})('order-A','restaurant-A');
    }
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('fails without marking the order reversed if account credit was not applied', async () => {
    const dbGet = vi.fn(async () => ({customerAccountId:'account-A',loyaltyPointsReserved:80,loyaltyReversed:0}));
    const dbRun = vi.fn(async()=>({changes:0}));
    await expect(createReleaseOrderLoyalty({dbGet,dbRun})('order-A','restaurant-A'))
      .rejects.toThrow('Loyalty account needs reconciliation before cancellation.');
    expect(dbRun).toHaveBeenCalledTimes(1);
  });

  it('propagates database errors so the caller can roll back its transaction', async () => {
    const dbGet = vi.fn(async()=>({customerAccountId:'account-A',loyaltyPointsReserved:80,loyaltyReversed:0}));
    const dbRun = vi.fn(async()=>{throw new Error('database operation failed')});
    await expect(createReleaseOrderLoyalty({dbGet,dbRun})('order-A','restaurant-A'))
      .rejects.toThrow('database operation failed');
  });
});
