import {describe,it,expect} from 'vitest';
import {
  LOCATION_FRESH_MS, LOCATION_MAX_ACCURACY_METERS,
  classifyLocationSignal, locationActivitySql, locationActivityParams,
  normalizeLocationActivity
} from '../lib/delivery/location-monitor.js';

describe('platform delivery-location monitoring diagnostics', () => {
  const now=1_900_000_000_000;
  it('separates fresh, stale, inaccurate and absent driver fixes',()=>{
    expect(classifyLocationSignal(now-1000,15,now)).toBe('fresh');
    expect(classifyLocationSignal(now-LOCATION_FRESH_MS,LOCATION_MAX_ACCURACY_METERS,now)).toBe('fresh');
    expect(classifyLocationSignal(now-LOCATION_FRESH_MS-1,15,now)).toBe('stale');
    expect(classifyLocationSignal(now+1,15,now)).toBe('stale');
    expect(classifyLocationSignal(now-1000,151,now)).toBe('poorAccuracy');
    expect(classifyLocationSignal(now-1000,null,now)).toBe('poorAccuracy');
    expect(classifyLocationSignal(now-1000,0,now)).toBe('poorAccuracy');
    expect(classifyLocationSignal(null,null,now)).toBe('missing');
    expect(classifyLocationSignal(undefined,15,now)).toBe('missing');
  });
  it('passes six bounded freshness timestamps to its query',()=>{
    expect(locationActivityParams(now)).toEqual([
      now-LOCATION_FRESH_MS,now,now-LOCATION_FRESH_MS,now,
      now-LOCATION_FRESH_MS,now
    ]);
    expect((locationActivitySql.match(/\\?/g)||[]).length).toBe(6);
  });
  it('includes only active delivery trips and matches assigned driver identity',()=>{
    expect(locationActivitySql).toContain('dl.orderId=o.id AND dl.driverName=o.driverId');
    expect(locationActivitySql).toContain("o.status IN ('picked_up','out_for_delivery','arrived')");
    expect(locationActivitySql).toContain("o.orderType='delivery' OR o.diningType='delivery'");
    expect(locationActivitySql).not.toMatch(/\\b(?:lat|lng|phone|email)\\b/i);
  });
  it('produces numeric aggregate-only data from nullable database rows',()=>{
    expect(normalizeLocationActivity({trips:3,fresh:1,stale:1,poorAccuracy:0,missing:1}))
      .toEqual({trips:3,fresh:1,stale:1,poorAccuracy:0,missing:1});
    expect(normalizeLocationActivity()).toEqual({trips:0,fresh:0,stale:0,poorAccuracy:0,missing:0});
  });
});
