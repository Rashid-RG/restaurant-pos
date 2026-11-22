import { describe, expect, it, vi } from 'vitest';
import * as orders from '../lib/orders/index.js';
import * as legacy from '../lib/order-verification.js';

describe('orders domain proof compatibility and isolation', () => {
  it('preserves all legacy order proof exports by identity', () => {
    for (const symbol of ['ORDER_PROOF_TTL_MS', 'orderProofHash', 'normalizeCheckoutContact', 'issueOrderProof', 'consumeOrderProof'])
      expect(orders[symbol]).toBe(legacy[symbol]);
  });

  it('normalizes supported checkout contacts without granting account access', () => {
    expect(orders.normalizeCheckoutContact('  FOOD@Example.com  ')).toBe('food@example.com');
    expect(orders.normalizeCheckoutContact('0771234567')).toBe('+94771234567');
    expect(orders.normalizeCheckoutContact('not-an-email@')).toBe('');
  });

  it('issues a tenant-bound proof with only a hashed token stored', async () => {
    const dbRun = vi.fn(async () => ({changes:1}));
    const now = Date.UTC(2026, 0, 1);
    const result = await orders.issueOrderProof({dbRun, tenantId:'restaurant-A', destination:'0771234567', now});
    expect(result.checkoutProof).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(result.expiresAt).toBe(now + orders.ORDER_PROOF_TTL_MS);
    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, args] = dbRun.mock.calls[0];
    expect(sql).toContain('INSERT INTO order_verification_proofs');
    expect(args[1]).toBe('restaurant-A');
    expect(args[2]).toBe('+94771234567');
    expect(args[3]).toBe(orders.orderProofHash(result.checkoutProof));
    expect(args.join(' ')).not.toContain(result.checkoutProof);
  });

  it('consumes proof only using the explicit tenant and matching normalized contact', async () => {
    const dbRun = vi.fn(async () => ({changes:1}));
    const proof = 'a'.repeat(43);
    expect(await orders.consumeOrderProof({
      dbRun, tenantId:'restaurant-A', checkoutProof:proof, customerPhone:'0771234567',
      now: 123456
    })).toBe(true);
    const [sql, args] = dbRun.mock.calls[0];
    expect(sql).toContain('tenant_id=? AND tokenHash=? AND consumedAt IS NULL AND expiresAt>?');
    expect(args).toEqual([123456,'restaurant-A',orders.orderProofHash(proof),123456,'+94771234567']);
  });

  it('rejects invalid proof and duplicate consumption results', async () => {
    const dbRun = vi.fn(async () => ({changes:0}));
    expect(await orders.consumeOrderProof({
      dbRun, tenantId:'restaurant-B', checkoutProof:'bad', customerPhone:'0771234567'
    })).toBe(false);
    expect(dbRun).not.toHaveBeenCalled();
    expect(await orders.consumeOrderProof({
      dbRun, tenantId:'restaurant-B', checkoutProof:'a'.repeat(43), customerPhone:'0771234567'
    })).toBe(false);
    expect(dbRun).toHaveBeenCalledTimes(1);
  });
});
