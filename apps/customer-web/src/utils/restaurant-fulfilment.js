// The server evaluates the unrounded delivery distance. A city centroid is
// useful for ordering pickup results but cannot confirm a customer's address.
export function deliveryState(store, precise, current) {
  if (store.isOpen !== true) return 'closed';
  if (!precise) return 'address';
  if (!current || typeof store.isDeliverable !== 'boolean') return 'unknown';
  return store.isDeliverable ? 'available' : 'outside';
}

export function locationKey(coords) {
  if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng) ||
      Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return '';
  return coords.lat + ',' + coords.lng;
}
