// GastroDriver onboarding proof is bound to a restaurant and purpose.
// This module deliberately does not authorize a driver session.
export const DRIVER_SIGNUP_PURPOSE = 'driver_signup';

export function driverTenantSelector(req) {
  const query = req?.query || {};
  const headers = req?.headers || {};
  const chosen = query.tenantId || query.tenant || headers['x-tenant-id'] || headers['x-tenant-subdomain'];
  return typeof chosen === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(chosen.trim()) ? chosen.trim() : null;
}

export function normalizeDriverEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function summarizeDriverCashOrders(rows) {
  const result = { currency: 'LKR', deliveredCodOrders: 0, cashReceivedCents: 0, cashHandoverPendingCents: 0, cashHandedOverCents: 0 };
  for (const order of rows || []) {
    if (order?.status !== 'delivered' || !['cod','cash'].includes(String(order.paymentMethod || '').toLowerCase())) continue;
    const amount = Number(order.total);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid delivered cash total');
    const cents = Math.round(amount * 100);
    result.deliveredCodOrders++;
    result.cashReceivedCents += cents;
    if (Number(order.cashCollected) === 1) result.cashHandedOverCents += cents;
    else result.cashHandoverPendingCents += cents;
  }
  return result;
}

export function verifiedLicenceExpiry(value, now=Date.now()) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const expiry=Date.parse(value+'T23:59:59.999Z');
  if(!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0,10)!==value || expiry<now) return null;
  return expiry;
}
export function needsLicenceReview(driver, now=Date.now()) {
  if(Number(driver?.licenseReviewRequired)!==1) return false; // Preserve pre-existing rider service.
  const expiry=Number(driver?.licenseVerifiedUntil);
  return !Number.isFinite(expiry) || expiry<now;
}

/**
 * Sri Lanka DMT class policy. A motorcycle with unknown engine capacity needs
 * full class A; restricted A1 licences require separate engine-capacity evidence.
 * No automatic conclusion about suspension/revocation is made here.
 */
export function requiredLicenceClass(vehicleType) {
  return vehicleType === 'Motorbike' ? 'A'
    : vehicleType === 'TukTuk' ? 'B1'
    : vehicleType === 'Car' ? 'B'
    : vehicleType === 'Bicycle' ? null
    : undefined;
}

export function managerLicenceClassMatches(vehicleType, reviewedClass) {
  const required = requiredLicenceClass(vehicleType);
  return required === null ? reviewedClass == null || reviewedClass === ''
    : required !== undefined && reviewedClass === required;
}

/**
 * Optional provider machine extraction can substantiate a manager's class
 * check, but absence of the optional field does not magically validate it.
 */
export function providerLicenceClassMatches(verification, vehicleType) {
  const required = requiredLicenceClass(vehicleType);
  if (required === undefined) return false;
  if (required === null) return true;
  const data = verification?.additionalVerifiedData;
  if (!data || typeof data !== 'object') return null;
  const categories = data.driversLicenseCategory;
  const list = data.driversLicenseCategories;
  if (categories && typeof categories === 'object' && Object.keys(categories).length) {
    return categories[required] === true;
  }
  if (Array.isArray(list) && list.length) {
    return list.includes(required);
  }
  return null; // extraction unavailable: manager review required, never auto-verified
}
