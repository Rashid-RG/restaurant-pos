import { describe, expect, it, vi } from 'vitest';
import * as delivery from '../lib/delivery/index.js';
import { haversineDistanceKm as legacyDistance } from '../lib/geo-distance.js';
import { createDeliveryFeeCalculator as legacyFee } from '../lib/delivery-fee.js';
import { createPeakHourService as legacyPeak } from '../lib/peak-hours.js';

describe('delivery domain architecture contract', () => {
  it('keeps legacy imports wired to the canonical domain implementation', () => {
    expect(legacyDistance).toBe(delivery.haversineDistanceKm);
    expect(legacyFee).toBe(delivery.createDeliveryFeeCalculator);
    expect(legacyPeak).toBe(delivery.createPeakHourService);
  });

  it('retains tenant identity from quotation through peak-hour evaluation', async () => {
    const getSettingsMap = vi.fn(async (tenant, fields) => {
      if (tenant !== 'restaurant-only') throw new Error('wrong tenant');
      return fields.includes('storeLat')
        ? { storeLat:'6.9271', storeLng:'79.8612' }
        : { timeZone:'Asia/Colombo' };
    });
    const isPeakHour = delivery.createPeakHourService({
      getSettingsMap,
      now: () => new Date('2026-01-01T06:30:00.000Z')
    });
    const calculateFee = delivery.createDeliveryFeeCalculator({ getSettingsMap, isPeakHour });
    const quote = await calculateFee(6.9271,79.8612,500,'restaurant-only');
    expect(quote.totalFee).toBe(149);
    expect(quote.isPeakHour).toBe(true);
    expect(getSettingsMap).toHaveBeenCalledTimes(2);
    for(const [tenant] of getSettingsMap.mock.calls) expect(tenant).toBe('restaurant-only');
  });
});
