/**
 * Great-circle distance between two latitude/longitude pairs, in kilometres.
 * Extracted from server.js without altering its rounding or coercion semantics.
 * Callers must validate coordinates and tenant ownership before using this value
 * for delivery pricing, driver dispatch, or order tracking.
 */
export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function coordinatePair(latitude, longitude) {
  const hasNumber = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  if (!hasNumber(latitude) || !hasNumber(longitude)) return null;
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function restaurantPickupPin(settings = {}) {
  return coordinatePair(settings.storeLat, settings.storeLng)
    ?? coordinatePair(settings.restaurantLat, settings.restaurantLng);
}
