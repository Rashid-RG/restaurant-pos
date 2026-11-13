// Marketplace availability is server-authoritative. Missing or stale state is never "open".
export const acceptsOnlineOrders = (store) => store?.isOpen === true;

// Recommendation scores are relative browsing hints, not ratings or promises of availability.
export function recommendationScore({ distanceKm, maxDistanceKm, rating, ratingCount = 0, orderCount = 0, hasVerifiedPromotion = false, isNew = false, isOpen = false }) {
  if (isOpen !== true) return 0;
  const max = Number.isFinite(maxDistanceKm) && maxDistanceKm > 0 ? maxDistanceKm : null;
  const distance = Number.isFinite(distanceKm) && distanceKm >= 0 ? distanceKm : null;
  const proximity = max !== null && distance !== null ? (1 - Math.min(distance, max) / max) * 35 : 0;
  const verifiedRating = Number.isFinite(rating) && rating >= 1 && rating <= 5 && ratingCount > 0 ? rating : null;
  const quality = verifiedRating === null ? 0 : verifiedRating / 5 * 25;
  const history = Math.min(Math.max(0, Number(orderCount) || 0) * 10, 20);
  return Number((proximity + quality + history + (hasVerifiedPromotion ? 10 : 0) + (isNew ? 5 : 0) + 5).toFixed(1));
}

export function recommendedOpenStores(stores, hasLocation) {
  if (!hasLocation) return [];
  return (stores || []).filter(store => acceptsOnlineOrders(store) && Number.isFinite(store.distanceKm) && store.isDeliverable === true)
    .sort((a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0));
}
