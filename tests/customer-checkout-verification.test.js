import { describe, it, expect, vi } from 'vitest';
import { issueOrderProof, consumeOrderProof, normalizeCheckoutContact, orderProofHash, ORDER_PROOF_TTL_MS } from '../lib/order-verification.js';

describe('server-authoritative, single-use checkout verification', () => {
  const makeDB = () => {
    const rows = new Map();
    const dbRun = vi.fn(async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        const [id,tenantId,destination,tokenHash,expiresAt,createdAt] = params;
        rows.set(tokenHash,{id,tenantId,destination,expiresAt,createdAt,consumedAt:null});
        return {changes:1};
      }
      if (sql.startsWith('UPDATE')) {
        const [now,tenantId,tokenHash,after,...destinations] = params;
        const row = rows.get(tokenHash);
        if (!row || row.tenantId !== tenantId || row.consumedAt !== null || row.expiresAt <= after || !destinations.includes(row.destination)) return {changes:0};
        row.consumedAt = now;
        return {changes:1};
      }
      throw Error('Unexpected SQL');
    });
    return {dbRun,rows};
  };
  it('normalizes Sri Lankan mobile and email contacts', () => {
    expect(normalizeCheckoutContact('0771234567')).toBe('+94771234567');
    expect(normalizeCheckoutContact('+94 77 123 4567')).toBe('+94771234567');
    expect(normalizeCheckoutContact('  Test@Example.COM  ')).toBe('test@example.com');
    expect(normalizeCheckoutContact('not an email@')).toBe('');
  });
  it('issues a random, non-plaintext proof and accepts it once for its contact and tenant', async () => {
    const {dbRun,rows} = makeDB();
    const {checkoutProof} = await issueOrderProof({dbRun,tenantId:'shop-a',destination:'test@example.com',now:1000});
    expect(checkoutProof.length).toBeGreaterThanOrEqual(32);
    expect(rows.get(orderProofHash(checkoutProof)).destination).toBe('test@example.com');
    const input={dbRun,tenantId:'shop-a',checkoutProof,customerPhone:'0771234567',customerEmail:'test@example.com',now:2000};
    expect(await consumeOrderProof({...input,tenantId:'shop-b'})).toBe(false);
    expect(await consumeOrderProof({...input,customerEmail:'wrong@example.com'})).toBe(false);
    expect(await consumeOrderProof(input)).toBe(true);
    expect(await consumeOrderProof(input)).toBe(false);
  });
  it('rejects expired proofs, missing tokens and unrelated phone numbers', async () => {
    const {dbRun} = makeDB();
    const {checkoutProof} = await issueOrderProof({dbRun,tenantId:'shop-a',destination:'0771234567',now:1000});
    expect(await consumeOrderProof({dbRun,tenantId:'shop-a',checkoutProof,customerPhone:'0770000000',now:2000})).toBe(false);
    expect(await consumeOrderProof({dbRun,tenantId:'shop-a',checkoutProof,customerPhone:'0771234567',now:1000+ORDER_PROOF_TTL_MS})).toBe(false);
    expect(await consumeOrderProof({dbRun,tenantId:'shop-a',checkoutProof:'',customerPhone:'0771234567'})).toBe(false);
  });
});
