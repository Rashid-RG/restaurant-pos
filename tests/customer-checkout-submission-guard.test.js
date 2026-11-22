import { describe, it, expect, vi } from 'vitest';
import { createSubmissionGuard } from '../apps/customer-web/src/utils/submission-guard.js';

describe('customer checkout duplicate submission prevention', () => {
  it('allows only one request during rapid repeated taps', async () => {
    const guard = createSubmissionGuard();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const action = vi.fn(() => pending);
    const first = guard.run(action);
    expect(guard.active).toBe(true);
    expect(await guard.run(action)).toEqual({ skipped: true });
    expect(action).toHaveBeenCalledTimes(1);
    release({ orderId: 'one-order' });
    expect(await first).toEqual({ skipped: false, result: { orderId: 'one-order' } });
    expect(guard.active).toBe(false);
  });

  it('releases after network errors so the same idempotency intent can be retried', async () => {
    const guard = createSubmissionGuard();
    await expect(guard.run(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(guard.active).toBe(false);
    expect(await guard.run(async () => 'recovered')).toEqual({ skipped: false, result: 'recovered' });
  });

  it('releases even after synchronous validation failures', async () => {
    const guard = createSubmissionGuard();
    await expect(guard.run(() => { throw new Error('invalid address'); })).rejects.toThrow('invalid address');
    expect(guard.active).toBe(false);
  });
});
