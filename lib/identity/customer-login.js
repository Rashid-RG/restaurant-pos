/**
 * Restaurant-scoped customer authentication lookup.
 *
 * A phone number can only resolve an account in the tenant selected by the
 * public-store route. Never fall back to accounts in another restaurant.
 * Password checks and session issuance remain in the calling route.
 */
export function createCustomerLoginLookup({ dbGet, normalizeLkPhone }) {
  if (typeof dbGet !== 'function' || typeof normalizeLkPhone !== 'function') {
    throw new TypeError('Customer login requires a database reader and phone normalizer');
  }
  return async function findCustomerForLogin(tenantId, phone) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('Restaurant tenant required for customer login');
    const cleanPhone = phone.replace(/[\s-]/g, '');
    return dbGet(
      'SELECT * FROM customer_accounts WHERE tenant_id=? AND (phone=? OR phone=?)',
      [tenantId, normalizeLkPhone(cleanPhone), cleanPhone]
    );
  };
}
