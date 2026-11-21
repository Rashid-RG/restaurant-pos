// Aggregated platform diagnostics only. Never return raw rider GPS or customer positions.
export const LOCATION_FRESH_MS = 30_000;
export const LOCATION_MAX_ACCURACY_METERS = 150;

export function classifyLocationSignal(updatedAt, accuracyMeters, now) {
  if (updatedAt === null || updatedAt === undefined || !Number.isFinite(Number(updatedAt)) || Number(updatedAt) <= 0) return 'missing';
  const age = Number(now) - Number(updatedAt);
  if (!Number.isFinite(age) || age < 0 || age > LOCATION_FRESH_MS) return 'stale';
  if (accuracyMeters === null || accuracyMeters === undefined ||
      !Number.isFinite(Number(accuracyMeters)) || Number(accuracyMeters) <= 0 ||
      Number(accuracyMeters) > LOCATION_MAX_ACCURACY_METERS) return 'poorAccuracy';
  return 'fresh';
}

// All four categories are exclusive, including orders with no assigned rider/location.
// Keep order scope limited to active delivery trips and join on the assigned rider.
export const locationActivitySql = `SELECT o.tenant_id AS id, COUNT(*) AS trips,
  SUM(CASE WHEN dl.updatedAt BETWEEN ? AND ? AND dl.accuracyMeters > 0 AND dl.accuracyMeters <= 150 THEN 1 ELSE 0 END) AS fresh,
  SUM(CASE WHEN dl.updatedAt IS NULL THEN 1 ELSE 0 END) AS missing,
  SUM(CASE WHEN dl.updatedAt IS NOT NULL AND (dl.updatedAt < ? OR dl.updatedAt > ?) THEN 1 ELSE 0 END) AS stale,
  SUM(CASE WHEN dl.updatedAt BETWEEN ? AND ? AND (dl.accuracyMeters IS NULL OR dl.accuracyMeters <= 0 OR dl.accuracyMeters > 150) THEN 1 ELSE 0 END) AS poorAccuracy
  FROM orders o LEFT JOIN driver_locations dl ON dl.orderId=o.id AND dl.driverName=o.driverId
  WHERE o.status IN ('picked_up','out_for_delivery','arrived') AND (o.orderType='delivery' OR o.diningType='delivery')
  GROUP BY o.tenant_id`;

export const locationActivityParams = now => [
  now - LOCATION_FRESH_MS, now, now - LOCATION_FRESH_MS, now,
  now - LOCATION_FRESH_MS, now
];

export function normalizeLocationActivity(row = {}) {
  const trips = Math.max(0, Number(row.trips) || 0);
  const fresh = Math.max(0, Number(row.fresh) || 0);
  const missing = Math.max(0, Number(row.missing) || 0);
  const stale = Math.max(0, Number(row.stale) || 0);
  const poorAccuracy = Math.max(0, Number(row.poorAccuracy) || 0);
  return {trips, fresh, missing, stale, poorAccuracy};
}
