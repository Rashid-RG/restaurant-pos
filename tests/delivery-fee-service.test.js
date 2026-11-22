import { describe, expect, it, vi } from 'vitest';
import { createDeliveryFeeCalculator } from '../lib/delivery-fee.js';

const store = {
  storeLat: '6.9271', storeLng: '79.8612',
  deliveryBaseFee: '99', deliveryFreeRadiusKm: '2',
  deliveryPerKmRate: '50', deliveryMaxRadiusKm: '15',
  deliveryPeakSurcharge: '50', deliveryRainSurcharge: '75',
  deliveryFreeThreshold: '3000',
};
const calculator = (settings, peak = false) => {
  const getSettingsMap = vi.fn(async tenant => settings[tenant] ?? {});
  const isPeakHour = vi.fn(async () => peak);
  return { quote: createDeliveryFeeCalculator({ getSettingsMap, isPeakHour }), getSettingsMap, isPeakHour };
};

describe('tenant-scoped delivery quotes', () => {
  it('refuses to quote when the requested tenant has no configured store pin', async () => {
    const { quote, getSettingsMap } = calculator({ restaurantA: store });
    await expect(quote(6.9271,79.8612,500,'restaurantB')).rejects.toMatchObject({
      status: 422, code: 'STORE_DELIVERY_LOCATION_MISSING',
    });
    expect(getSettingsMap).toHaveBeenCalledWith('restaurantB',expect.arrayContaining(['storeLat','storeLng']));
  });

  it('does not mix distinct restaurant locations and settings', async () => {
    const { quote } = calculator({ restaurantA: store, restaurantB: { ...store, storeLat: '7.2906',storeLng:'80.6337' } });
    const a = await quote(6.9271,79.8612,500,'restaurantA');
    const b = await quote(6.9271,79.8612,500,'restaurantB');
    expect(a.totalFee).toBe(99);
    expect(a.isOutOfRange).toBe(false);
    expect(b.isOutOfRange).toBe(true);
    expect(b.totalFee).toBe(0);
  });

  it('preserves free delivery without calling the peak surcharge provider', async () => {
    const { quote, isPeakHour } = calculator({ restaurantA: store },true);
    const result = await quote(6.9271,79.8612,3000,'restaurantA');
    expect(result).toMatchObject({ totalFee:0,isFreeDelivery:true,etaMinutes:10 });
    expect(isPeakHour).not.toHaveBeenCalled();
  });

  it('uses only the requested tenant settings for peak and rain surcharges', async () => {
    const { quote, isPeakHour } = calculator({ restaurantA: { ...store, isRainyWeather:'true' } },true);
    const result = await quote(6.9271,79.8612,500,'restaurantA');
    expect(result).toMatchObject({baseFee:99,distanceCharge:0,peakSurcharge:50,rainSurcharge:75,totalFee:224,isPeakHour:true,isRainy:true,etaMinutes:18});
    expect(isPeakHour).toHaveBeenCalledWith('restaurantA');
  });

  it('supports restaurant-specific legacy latitude and longitude fields', async () => {
    const { storeLat, storeLng, ...legacy } = store;
    const { quote } = calculator({ oldRestaurant:{ ...legacy, restaurantLat:storeLat, restaurantLng:storeLng } });
    expect((await quote(6.9271,79.8612,500,'oldRestaurant')).totalFee).toBe(99);
  });
});
