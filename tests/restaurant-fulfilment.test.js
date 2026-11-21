import {describe, expect, it} from 'vitest';
import {deliveryState, locationKey} from '../apps/customer-web/src/utils/restaurant-fulfilment.js';

describe('location-based restaurant labels', () => {
  const store = {isOpen:true, distanceKm:5, deliveryRadiusKm:5};
  it('honours both server decisions even when displayed distances round to the same value', () => {
    expect(deliveryState({...store,isDeliverable:false},true,true)).toBe('outside');
    expect(deliveryState({...store,isDeliverable:true},true,true)).toBe('available');
  });
  it('requires an open restaurant, an exact location and a current quote', () => {
    const available = {...store,isDeliverable:true};
    expect(deliveryState({...available,isOpen:false},true,true)).toBe('closed');
    expect(deliveryState(available,false,true)).toBe('address');
    expect(deliveryState(available,true,false)).toBe('unknown');
    expect(deliveryState(store,true,true)).toBe('unknown');
  });
  it('distinguishes pin changes and rejects missing or invalid coordinates', () => {
    expect(locationKey({lat:0,lng:0})).toBe('0,0');
    expect(locationKey({lat:7,lng:80})).not.toBe(locationKey({lat:7.1,lng:80}));
    for (const coords of [null, {lat:null,lng:80}, {lat:91,lng:80}]) expect(locationKey(coords)).toBe('');
  });
});
