import {describe, expect, it} from 'vitest';
import {onlineHours, validOnlineHours} from '../lib/online-hours.js';

describe('restaurant-local online ordering hours', () => {
  it('keeps legacy stores open for their configured modes', () => {
    expect(onlineHours({}).includes(Date.now())).toBe(true);
    for (const value of ['24:00-09:00','09:00-09:00','9:00-10:00',null]) expect(validOnlineHours(value)).toBe(false);
    expect(validOnlineHours('')).toBe(true);
  });

  it('checks overnight boundaries in restaurant time', () => {
    const hours = onlineHours({timeZone:'Asia/Colombo', onlineOrderHours:'22:00-02:00'});
    expect(hours.includes(Date.parse('2026-11-21T16:29:00Z'))).toBe(false);
    expect(hours.includes(Date.parse('2026-11-21T16:30:00Z'))).toBe(true);
    expect(hours.includes(Date.parse('2026-11-21T20:29:00Z'))).toBe(true);
    expect(hours.includes(Date.parse('2026-11-21T20:30:00Z'))).toBe(false);
  });
});
