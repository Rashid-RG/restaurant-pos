import { describe, it, expect } from 'vitest';
import { acceptsOnlineOrders, recommendationScore, recommendedOpenStores } from '../apps/customer-web/src/utils/marketplace-availability.js';

describe('customer marketplace availability and ranking', () => {
  it('never considers missing, string or false store state open', () => {
    expect(acceptsOnlineOrders({ isOpen: true })).toBe(true);
    for (const store of [{}, null, { isOpen: false }, { isOpen: 'true' }, { isOpen: 1 }]) {
      expect(acceptsOnlineOrders(store)).toBe(false);
    }
  });
  it('never recommends a closed store even with strong historic signals', () => {
    expect(recommendationScore({ isOpen: false, rating: 5, ratingCount: 500, orderCount: 20, distanceKm: 0, maxDistanceKm: 10 })).toBe(0);
  });
  it('does not invent four-star quality for stores without reviews', () => {
    const base = { isOpen: true, rating: null, ratingCount: 0, orderCount: 0, distanceKm: null, maxDistanceKm: null };
    expect(recommendationScore(base)).toBe(5);
    expect(recommendationScore({ ...base, rating: 5, ratingCount: 0 })).toBe(5);
    expect(recommendationScore({ ...base, rating: 5, ratingCount: 1 })).toBe(30);
  });
  it('keeps recommendation carousel empty without a confirmed customer location', () => {
    const stores = [{ id: 'open', isOpen: true, distanceKm: 1, isDeliverable: true, recommendationScore: 80 }];
    expect(recommendedOpenStores(stores, false)).toEqual([]);
  });
  it('excludes closed, unknown and out-of-zone restaurants from recommendations', () => {
    const stores = [
      { id: 'closed', isOpen: false, distanceKm: 1, isDeliverable: true, recommendationScore: 99 },
      { id: 'unknown', distanceKm: 1, isDeliverable: true, recommendationScore: 88 },
      { id: 'out', isOpen: true, distanceKm: 15, isDeliverable: false, recommendationScore: 79 },
      { id: 'near', isOpen: true, distanceKm: 2, isDeliverable: true, recommendationScore: 60 },
      { id: 'far', isOpen: true, distanceKm: 4, isDeliverable: true, recommendationScore: 20 }
    ];
    expect(recommendedOpenStores(stores, true).map(s => s.id)).toEqual(['near','far']);
  });
});
