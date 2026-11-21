import { describe, expect, it } from 'vitest';
import { restaurantRatingText, restaurantDeliveryText, restaurantEmptyState, sortRestaurants } from '../apps/customer-web/src/utils/discovery-display.js';

describe('GastroFood marketplace discovery reliability', () => {
  it('always places accepting restaurants above closed ones regardless of sort', () => {
    const stores = [
      {id:'closed', name:'A',isOpen:false,rating:5,ratingCount:500,distanceKm:1,deliveryTime:'5 min',recommendationScore:100},
      {id:'open', name:'B',isOpen:true,rating:3,ratingCount:3,distanceKm:6,deliveryTime:'30 min',recommendationScore:15}
    ];
    for (const sort of ['recommendation','fastest','rating','distance']) {
      expect(sortRestaurants(stores,sort).map(r=>r.id)).toEqual(['open','closed']);
    }
  });
  it('keeps unknown ratings below verified ones and never invents reviews', () => {
    const unrated={id:'a',name:'Unrated',isOpen:true,rating:5,ratingCount:0};
    const rated={id:'b',name:'Rated',isOpen:true,rating:4.1,ratingCount:21};
    expect(sortRestaurants([unrated,rated],'rating')[0].id).toBe('b');
    expect(restaurantRatingText(unrated)).toBe('New · No reviews yet');
    expect(restaurantRatingText(rated)).toBe('4.1 (21 reviews)');
  });
  it('does not claim a zero fee or delivery eligibility when unknown', () => {
    expect(restaurantDeliveryText({deliveryFee:null,isDeliverable:true},true)).toBe('Delivery fee at checkout');
    expect(restaurantDeliveryText({deliveryFee:0,isDeliverable:true},true)).toBe('Delivery LKR 0');
    expect(restaurantDeliveryText({deliveryFee:90,isDeliverable:true},false)).toBe('Select location for delivery');
    expect(restaurantDeliveryText({deliveryFee:90,isDeliverable:false},true)).toBe('Delivery unavailable here');
  });
  it('returns actionable empty states that distinguish no stores and narrow filters', () => {
    expect(restaurantEmptyState({total:0}).title).toBe('No restaurants listed yet');
    expect(restaurantEmptyState({total:7,search:'no-match'}).title).toBe('No matching restaurants');
    expect(restaurantEmptyState({total:7,openOnly:true}).description).toMatch(/Clear filters/);
    expect(restaurantEmptyState({total:0,failed:true}).title).toBe('Unable to load restaurants');
  });
  it('preserves input order and ignores missing distances when sorting', () => {
    const stores=[{id:'unknown',isOpen:true,distanceKm:null},{id:'known',isOpen:true,distanceKm:2}];
    expect(sortRestaurants(stores,'distance').map(s=>s.id)).toEqual(['known','unknown']);
    expect(stores[0].id).toBe('unknown');
  });
});
