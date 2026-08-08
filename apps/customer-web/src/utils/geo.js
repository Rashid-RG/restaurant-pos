/**
 * Smart AI & Automated Geocoding & Distance Resolver Engine for GastroFlow
 * Supports 100% free OpenStreetMap Nominatim Geocoding + Haversine Geodesic Distance Matrix
 */

export const SRI_LANKA_TOWNS = {
  'Colombo 03, Western': { lat: 6.9147, lng: 79.8517 },
  'Colombo 01, Western': { lat: 6.9344, lng: 79.8428 },
  'Colombo 07, Western': { lat: 6.9080, lng: 79.8660 },
  'Dehiwala, Western': { lat: 6.8511, lng: 79.8650 },
  'Nugegoda, Western': { lat: 6.8724, lng: 79.8872 },
  'Battaramulla, Western': { lat: 6.8973, lng: 79.9220 },
  'Kotte, Western': { lat: 6.8906, lng: 79.9015 },
  'Negombo, Western': { lat: 7.2083, lng: 79.8358 },
  'Galgamuwa, North Western': { lat: 7.9861, lng: 80.2921 },
  'Kurunegala, North Western': { lat: 7.4863, lng: 80.3647 },
  'Puttalam, North Western': { lat: 8.0362, lng: 79.8283 },
  'Chilaw, North Western': { lat: 7.5758, lng: 79.7953 },
  'Anuradhapura, North Central': { lat: 8.3114, lng: 80.4037 },
  'Polonnaruwa, North Central': { lat: 7.9403, lng: 81.0188 },
  'Kandy City, Central': { lat: 7.2906, lng: 80.6337 },
  'Matale, Central': { lat: 7.4675, lng: 80.6234 },
  'Nuwara Eliya, Central': { lat: 6.9497, lng: 80.7891 },
  'Galle Fort, Southern': { lat: 6.0535, lng: 80.2210 },
  'Matara, Southern': { lat: 5.9549, lng: 80.5550 },
  'Hambantota, Southern': { lat: 6.1247, lng: 81.1185 },
  'Jaffna City, Northern': { lat: 9.6615, lng: 80.0255 },
  'Vavuniya, Northern': { lat: 8.7514, lng: 80.4971 },
  'Mannar, Northern': { lat: 8.9810, lng: 79.9044 },
  'Trincomalee, Eastern': { lat: 8.5874, lng: 81.2152 },
  'Batticaloa, Eastern': { lat: 7.7310, lng: 81.6747 },
  'Badulla, Uva': { lat: 6.9934, lng: 81.0550 },
  'Bandarawela, Uva': { lat: 6.8324, lng: 80.9856 },
  'Ratnapura, Sabaragamuwa': { lat: 6.6828, lng: 80.3992 },
  'Kegalle, Sabaragamuwa': { lat: 7.2513, lng: 80.3464 }
};

/**
 * Calculates accurate geodesic distance (in kilometers) between 2 coordinates.
 */
export function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

/**
 * Resolves coordinates for any address string via cache, Sri Lanka dictionary, or OpenStreetMap geocoding.
 */
export async function resolveAddressToCoords(address) {
  if (!address || typeof address !== 'string') return null;
  const cleanAddr = address.trim();
  if (SRI_LANKA_TOWNS[cleanAddr]) return SRI_LANKA_TOWNS[cleanAddr];

  const lower = cleanAddr.toLowerCase();
  for (const [key, coords] of Object.entries(SRI_LANKA_TOWNS)) {
    const cityName = key.split(',')[0].toLowerCase().trim();
    if (lower.includes(cityName) || cityName.includes(lower)) {
      return coords;
    }
  }

  // Check local cache
  const cacheKey = `gastroflow_geo_cache_${lower.replace(/[^a-z0-9]/g, '_')}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  // Perform live OpenStreetMap Nominatim geocoding search for Sri Lanka
  try {
    const query = encodeURIComponent(cleanAddr);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=lk&limit=1`);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        localStorage.setItem(cacheKey, JSON.stringify(coords));
        return coords;
      }
    }
  } catch (err) {
    console.warn('Geocoding lookup warning:', err.message);
  }

  return null;
}

/**
 * Evaluates delivery proximity, dynamic fees, and ETA between user & store.
 */
export function evaluateStoreProximity(userLat, userLng, storeLat, storeLng, maxRadiusKm = 15) {
  if (userLat == null || userLng == null || storeLat == null || storeLng == null) {
    return {
      distanceKm: null,
      isDeliverable: true,
      deliveryFee: 150,
      deliveryTime: '20-35 min',
      status: 'unknown'
    };
  }

  const distanceKm = calculateHaversineDistanceKm(userLat, userLng, storeLat, storeLng);
  const isDeliverable = distanceKm <= maxRadiusKm;

  // Dynamic fee calculation: LKR 80 base + LKR 20 per km
  const baseFee = 80;
  const distFee = Math.round(distanceKm * 20);
  const hour = new Date().getHours();
  const isRushHour = (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21);
  const rawFee = isDeliverable ? Math.round((baseFee + distFee) * (isRushHour ? 1.3 : 1.0)) : null;

  const minEta = Math.round(15 + distanceKm * 2.5);
  const maxEta = Math.round(25 + distanceKm * 3.5);

  return {
    distanceKm,
    isDeliverable,
    deliveryFee: rawFee,
    feeBreakdown: isDeliverable ? { base: baseFee, distFee, isRushHour, total: rawFee } : null,
    deliveryTime: isDeliverable ? `${minEta}-${maxEta} min` : 'Out of Delivery Range',
    status: isDeliverable ? 'in_range' : 'out_of_range'
  };
}
