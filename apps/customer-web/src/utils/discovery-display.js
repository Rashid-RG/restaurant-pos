import { acceptsOnlineOrders } from './marketplace-availability.js';

const verifiedRating = store => Number(store?.ratingCount) > 0 && Number.isFinite(Number(store?.rating)) && Number(store.rating) >= 1 && Number(store.rating) <= 5;

export function restaurantRatingText(store) {
  if (!verifiedRating(store)) return 'New · No reviews yet';
  return `${Number(store.rating).toFixed(1)} (${Math.floor(Number(store.ratingCount))} reviews)`;
}

export function restaurantDeliveryText(store, hasLocation = false) {
  if (hasLocation && store?.isDeliverable === false) return 'Delivery unavailable here';
  if (!hasLocation || store?.isDeliverable !== true) return 'Select location for delivery';
  const fee = store?.deliveryFee == null ? NaN : Number(store.deliveryFee);
  return Number.isFinite(fee) && fee >= 0 ? `Delivery LKR ${fee.toFixed(0)}` : 'Delivery fee at checkout';
}

export function restaurantEmptyState({ loading = false, failed = false, total = 0, search = '', cuisine = 'all', openOnly = false, deliveryOnly = false } = {}) {
  if (loading) return { title: 'Finding restaurants', description: 'Checking available restaurants and menus.' };
  if (failed && total === 0) return { title: 'Unable to load restaurants', description: 'Check your connection, then retry.' };
  if (total === 0) return { title: 'No restaurants listed yet', description: 'Explore again later or check another location.' };
  if (openOnly || deliveryOnly) return { title: 'No matches for these filters', description: 'Clear filters to view more restaurants, including pickup options.' };
  if (search.trim() || cuisine !== 'all') return { title: 'No matching restaurants', description: 'Try a different restaurant name or cuisine.' };
  return { title: 'No restaurants available', description: 'Please check again later.' };
}

export function sortRestaurants(stores, sortBy = 'recommendation') {
  const list = [...(stores || [])];
  const validDistance = store => Number.isFinite(store?.distanceKm) && store.distanceKm >= 0 ? store.distanceKm : Infinity;
  const validTime = store => {
    const match = String(store?.deliveryTime || '').match(/\d+/);
    return match ? Number(match[0]) : Infinity;
  };
  return list.sort((a,b) => {
    // Never promote a closed restaurant above one accepting orders.
    if (acceptsOnlineOrders(a) !== acceptsOnlineOrders(b)) return acceptsOnlineOrders(a) ? -1 : 1;
    if (sortBy === 'fastest') return validTime(a) - validTime(b);
    if (sortBy === 'distance') return validDistance(a) - validDistance(b);
    if (sortBy === 'rating') {
      if (verifiedRating(a) !== verifiedRating(b)) return verifiedRating(a) ? -1 : 1;
      if (verifiedRating(a) && verifiedRating(b)) return Number(b.rating) - Number(a.rating);
    }
    if (sortBy === 'recommendation') {
      const zoneA = a.isDeliverable === true ? 0 : 1;
      const zoneB = b.isDeliverable === true ? 0 : 1;
      if (zoneA !== zoneB) return zoneA - zoneB;
      return (Number(b.recommendationScore) || 0) - (Number(a.recommendationScore) || 0);
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}
