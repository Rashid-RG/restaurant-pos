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
