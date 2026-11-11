import { describe, expect, it } from 'vitest';
import { dateAtRestaurant, formatRestaurantTime, restaurantTimeZone, shiftCalendarDate, validTimeZone } from '../src/utils/restaurant-time.js';

describe('tenant time zone helpers', () => {
  it('keeps different restaurants independent around midnight', () => {
    const instant = '2026-11-11T20:30:00Z';
    expect(dateAtRestaurant(instant, 'Asia/Qatar')).toBe('2026-11-11');
    expect(dateAtRestaurant(instant, 'Asia/Dubai')).toBe('2026-11-12');
  });
  it('uses safe defaults for existing tenants', () => {
    expect(restaurantTimeZone({})).toBe('Asia/Colombo');
    expect(restaurantTimeZone({timeZone:'Asia/Qatar'})).toBe('Asia/Qatar');
    expect(validTimeZone('Not/AZone')).toBe(false);
  });
  it('does not mutate stored timestamp values', () => {
    const instant = 1794441600000;
    const date = new Date(instant);
    formatRestaurantTime(date, 'Asia/Dubai');
    expect(date.getTime()).toBe(instant);
  });
  it('shifts calendar dates independently of device time zone', () => {
    expect(shiftCalendarDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});
