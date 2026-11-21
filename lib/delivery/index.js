/**
 * Delivery domain public contract.
 *
 * Transport layers should import only from this entrypoint. Pure geometry,
 * timezone-aware peak-hour policy and tenant-scoped fee calculation remain
 * isolated from Express, database adapters and other app UIs.
 */
export { coordinatePair, haversineDistanceKm, restaurantPickupPin } from './geo-distance.js';
export { createDeliveryFeeCalculator } from './fee.js';
export { createPeakHourService, isPeakWindow, restaurantLocalHourMinute } from './peak-hours.js';
