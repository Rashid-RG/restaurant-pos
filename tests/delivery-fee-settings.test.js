import { describe, expect, it } from 'vitest';
import { createDeliveryFeeCalculator } from '../lib/delivery/fee.js';

const calculator = (settings = {}, peak = false) => createDeliveryFeeCalculator({
  getSettingsMap: async (tenantId) => {
    expect(tenantId).toBe('tenant-a');
    return { storeLat: '6.9271', storeLng: '79.8612', ...settings };
  },
  isPeakHour: async () => peak
});

describe('tenant delivery fee quote safety', () => {
  it('preserves deliberate zero charges and zero free radius', async () => {
    const quote = await calculator({
      deliveryBaseFee: '0', deliveryFreeRadiusKm: '0', deliveryPerKmRate: '0',
      deliveryPeakSurcharge: '0', deliveryRainSurcharge: '0',
      deliveryFreeThreshold: '9000', isRainyWeather: 'true'
    }, true)(6.93, 79.865, 100, 'tenant-a');
    expect(quote.totalFee).toBe(0);
    expect(quote.isOutOfRange).toBe(false);
    expect(quote.isFreeDelivery).toBe(false);
  });

  it('rejects missing and invalid customer coordinates', async () => {
    const calculate = calculator();
    await expect(calculate(null, 79.86, 100, 'tenant-a')).rejects.toMatchObject({code: 'CUSTOMER_DELIVERY_LOCATION_INVALID', status: 422});
    await expect(calculate(91, 79.86, 100, 'tenant-a')).rejects.toMatchObject({code: 'CUSTOMER_DELIVERY_LOCATION_INVALID'});
    await expect(calculate(6.9, Infinity, 100, 'tenant-a')).rejects.toMatchObject({code: 'CUSTOMER_DELIVERY_LOCATION_INVALID'});
  });

  it('never borrows a missing restaurant location from another tenant', async () => {
    const calculate = createDeliveryFeeCalculator({
      getSettingsMap: async () => ({}), isPeakHour: async () => false
    });
    await expect(calculate(6.9, 79.8, 100, 'tenant-a')).rejects.toMatchObject({code: 'STORE_DELIVERY_LOCATION_MISSING'});
  });

  it('returns an out-of-range quote without a payable fee', async () => {
    const quote = await calculator({deliveryMaxRadiusKm: '1'})(7.2, 80.1, 100, 'tenant-a');
    expect(quote.isOutOfRange).toBe(true);
    expect(quote.totalFee).toBe(0);
  });
});
