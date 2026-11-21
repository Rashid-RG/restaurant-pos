import {describe,it,expect} from 'vitest';
import {offerSecondsRemaining,offerExpired} from './offer-clock.js';

describe('individual driver offer clock',()=>{
  it('has exactly 120 seconds at the start of a two-minute offer',()=>{
    expect(offerSecondsRemaining(120000,0)).toBe(120);
    expect(offerExpired(120000,0)).toBe(false);
  });
  it('expires at the server-issued deadline without negative counts',()=>{
    expect(offerSecondsRemaining(120000,119999)).toBe(1);
    expect(offerSecondsRemaining(120000,120000)).toBe(0);
    expect(offerSecondsRemaining(120000,130000)).toBe(0);
    expect(offerExpired(120000,120000)).toBe(true);
  });
  it('does not invent a countdown for shared marketplace orders',()=>{
    expect(offerSecondsRemaining(null,1000)).toBe(null);
    expect(offerExpired(null,1000)).toBe(false);
  });
});
