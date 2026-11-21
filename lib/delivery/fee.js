import { coordinatePair, haversineDistanceKm, restaurantPickupPin } from './geo-distance.js';

/**
 * Tenant-scoped delivery quote policy. Database access and peak-hour detection
 * remain injected by the server so this module cannot bypass tenant context.
 * Existing fee rounding, distance limits and error responses are unchanged.
 */
function configurableAmount(value, fallback, { allowZero = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= (allowZero ? 0 : Number.EPSILON) ? amount : fallback;
}

export function createDeliveryFeeCalculator({ getSettingsMap, isPeakHour }) {
  if (typeof getSettingsMap !== 'function' || typeof isPeakHour !== 'function') {
    throw new TypeError('Delivery fee calculator needs tenant-scoped settings and peak-hour providers');
  }
  async function calculateDeliveryFee(customerLat, customerLng, subtotal = 0, tenantId = 'default_tenant') {
    const destination = coordinatePair(customerLat, customerLng);
    if (!destination) {
      const error = new Error('Select a valid delivery location before requesting a quote.');
      error.status = 422;
      error.code = 'CUSTOMER_DELIVERY_LOCATION_INVALID';
      throw error;
    }
    const s = await getSettingsMap(tenantId, [
      'storeLat', 'storeLng', 'restaurantLat', 'restaurantLng', 'deliveryBaseFee', 'deliveryFreeRadiusKm', 'deliveryPerKmRate',
      'deliveryMaxRadiusKm', 'deliveryPeakSurcharge', 'deliveryRainSurcharge', 'deliveryFreeThreshold', 'isRainyWeather'
    ]);
    // Never use another restaurant's coordinates as a fallback. Older tenant
    // profiles may have their own restaurantLat/restaurantLng settings.
    const pickup = restaurantPickupPin(s);
    if (!pickup) {
      const error = new Error('Delivery location is not configured for this restaurant. Ask the owner to set the store map pin in Online Store settings, or choose pickup.');
      error.status = 422;
      error.code = 'STORE_DELIVERY_LOCATION_MISSING';
      throw error;
    }
    const { lat, lng } = destination;
    const { lat: storeLat, lng: storeLng } = pickup;
    const baseFee = configurableAmount(s.deliveryBaseFee, 99);
    const freeRadius = configurableAmount(s.deliveryFreeRadiusKm, 2);
    const perKmRate = configurableAmount(s.deliveryPerKmRate, 50);
    const maxRadius = configurableAmount(s.deliveryMaxRadiusKm, 15, { allowZero: false });
    const peakSurchargeAmt = configurableAmount(s.deliveryPeakSurcharge, 50);
    const rainSurchargeAmt = configurableAmount(s.deliveryRainSurcharge, 75);
    const freeThreshold = configurableAmount(s.deliveryFreeThreshold, 3000, { allowZero: false });
    const isRainy = s.isRainyWeather === 'true';
  
    const distanceKm = haversineDistanceKm(storeLat, storeLng, lat, lng);
    const roundedDistance = Math.round(distanceKm * 10) / 10; // 1 decimal
  
    // Out of range
    if (distanceKm > maxRadius) {
      return {
        distanceKm: roundedDistance,
        baseFee: 0, distanceCharge: 0, peakSurcharge: 0, rainSurcharge: 0,
        totalFee: 0, isFreeDelivery: false, isOutOfRange: true,
        maxRadiusKm: maxRadius,
        storeLat, storeLng,
        etaMinutes: 0
      };
    }
  
    // Free delivery for high-value orders
    if (subtotal >= freeThreshold) {
      const etaMinutes = Math.round(10 + distanceKm * 3.5); // ~17 km/h avg Sri Lankan traffic
      return {
        distanceKm: roundedDistance,
        baseFee: 0, distanceCharge: 0, peakSurcharge: 0, rainSurcharge: 0,
        totalFee: 0, isFreeDelivery: true, isOutOfRange: false,
        freeThreshold, storeLat, storeLng,
        etaMinutes
      };
    }
  
    // Distance-based pricing
    const chargeableKm = Math.max(0, distanceKm - freeRadius);
    const distanceCharge = Math.round(chargeableKm * perKmRate);
    const peak = await isPeakHour(tenantId);
    const peakSurcharge = peak ? peakSurchargeAmt : 0;
    const rainSurcharge = isRainy ? rainSurchargeAmt : 0;
    const totalFee = Math.round(baseFee + distanceCharge + peakSurcharge + rainSurcharge);
  
    // ETA: Sri Lankan urban traffic averages ~15-20 km/h for scooters
    // Add 5 min per peak hour, 3 min for rain
    let etaMinutes = Math.round(10 + distanceKm * 3.5);
    if (peak) etaMinutes += 5;
    if (isRainy) etaMinutes += 3;
  
    return {
      distanceKm: roundedDistance,
      baseFee,
      distanceCharge,
      peakSurcharge,
      rainSurcharge,
      totalFee,
      isFreeDelivery: false,
      isOutOfRange: false,
      isPeakHour: peak,
      isRainy,
      freeRadius,
      freeThreshold,
      maxRadiusKm: maxRadius,
      storeLat, storeLng,
      etaMinutes
    };
  }
  return calculateDeliveryFee;
}
