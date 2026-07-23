import { describe, it, expect } from 'vitest';
import { getPlan, checkLimit, planList, PLANS } from '../lib/plans.js';

describe('SaaS plan limits', () => {
  it('exposes the three tiers', () => {
    const ids = planList().map(p => p.id);
    expect(ids).toEqual(['basic', 'pro', 'enterprise']);
  });

  it('falls back to basic for an unknown plan', () => {
    expect(getPlan('bogus')).toBe(PLANS.basic);
  });

  it('allows usage under the limit and blocks at/over it', () => {
    expect(checkLimit('basic', 'users', 2).allowed).toBe(true);   // 2 < 3
    expect(checkLimit('basic', 'users', 3).allowed).toBe(false);  // 3 >= 3
    expect(checkLimit('basic', 'orders', 499).allowed).toBe(true);
    expect(checkLimit('basic', 'orders', 500).allowed).toBe(false);
  });

  it('gives enterprise unlimited headroom', () => {
    expect(checkLimit('enterprise', 'users', 1000).allowed).toBe(true);
    expect(checkLimit('enterprise', 'orders', 1e6).allowed).toBe(true);
  });

  it('returns an actionable upgrade reason when blocked', () => {
    const r = checkLimit('basic', 'users', 3);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/upgrade/i);
    expect(r.limit).toBe(3);
  });
});
