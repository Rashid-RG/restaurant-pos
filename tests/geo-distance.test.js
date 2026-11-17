import { describe, it, expect } from 'vitest';
import { haversineDistanceKm } from '../lib/geo-distance.js';

describe('pure delivery distance helper', () => {
  it('returns zero for identical coordinates', () => {
    expect(haversineDistanceKm(6.9271,79.8612,6.9271,79.8612)).toBe(0);
  });
  it('preserves symmetry when origin and destination are reversed', () => {
    const forward = haversineDistanceKm(6.9271,79.8612,7.2906,80.6337);
    const reverse = haversineDistanceKm(7.2906,80.6337,6.9271,79.8612);
    expect(forward).toBeCloseTo(reverse,12);
    expect(forward).toBeGreaterThan(90);
    expect(forward).toBeLessThan(100);
  });
  it('handles the equator and antimeridian using great-circle geometry', () => {
    const distance = haversineDistanceKm(0,179.5,0,-179.5);
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });
  it('does not mutate input coordinate objects', () => {
    const origin = Object.freeze({lat:6.9,lng:79.8});
    const dest = Object.freeze({lat:7.0,lng:80.0});
    expect(haversineDistanceKm(origin.lat,origin.lng,dest.lat,dest.lng)).toBeGreaterThan(0);
  });
});
