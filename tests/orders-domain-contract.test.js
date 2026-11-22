import { describe, expect, it, vi } from 'vitest';
import * as orders from '../lib/orders/index.js';
import * as legacy from '../lib/checkout-recovery.js';

describe('orders domain compatibility and tenant isolation', () => {
  it('preserves every checkout recovery export for existing integrations', () => {
    for (const symbol of ['initCheckoutRecovery','checkoutIdentity','findRecoveredOrder','saveCheckout','publicOrderConfirmation'])
      expect(legacy[symbol]).toBe(orders[symbol]);
  });

  it('only recovers an order under its requested restaurant tenant', async () => {
    const tenantId = 'restaurant-A';
    const identity = { requestHash: 'keyhash', payloadHash: 'payloadhash' };
    const dbGet = vi.fn(async (sql, params) => {
      if (sql.includes('FROM checkout_requests')) return { payloadHash: 'payloadhash', orderId: 'order-1' };
      return { id: 'order-1', tenant_id: tenantId, status: 'pending' };
    });
    const result = await orders.findRecoveredOrder({ dbGet, tenantId, identity });
    expect(result.id).toBe('order-1');
    expect(dbGet).toHaveBeenNthCalledWith(1,
      expect.stringContaining('tenant_id=? AND requestHash=?'), [tenantId, identity.requestHash]);
    expect(dbGet).toHaveBeenNthCalledWith(2,
      expect.stringContaining('id=? AND tenant_id=?'), ['order-1', tenantId]);
  });

  it('does not return a recovered order when the original payload differs', async () => {
    const dbGet = vi.fn(async () => ({ payloadHash: 'other', orderId: 'order-1' }));
    await expect(orders.findRecoveredOrder({
      dbGet, tenantId: 'restaurant-A', identity: { requestHash: 'keyhash', payloadHash: 'payloadhash' }
    })).rejects.toMatchObject({ status: 409 });
    expect(dbGet).toHaveBeenCalledTimes(1);
  });

  it('writes recovery records with the explicit tenant within the caller transaction', async () => {
    const dbRun = vi.fn(async () => ({ changes: 1 }));
    await orders.saveCheckout({
      dbRun, tenantId: 'restaurant-A', identity: { requestHash: 'h1', payloadHash: 'h2' }, orderId: 'order-1'
    });
    expect(dbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO checkout_requests'),
      ['restaurant-A', 'h1', 'h2', 'order-1', expect.any(Number)]
    );
  });
});
