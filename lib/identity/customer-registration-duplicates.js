/**
 * Customer registration uniqueness preflight.
 *
 * Only an account already owned by this restaurant can block a new account
 * at the application layer. Some legacy customer_accounts tables additionally
 * have a database-wide UNIQUE(email) constraint; those collisions must be
 * handled at insert time without editing the schema or exposing another
 * restaurant's account.
 */
export function createCustomerRegistrationDuplicates({ dbGet }) {
  if (typeof dbGet !== 'function') throw new TypeError('Registration requires a database reader');

  return async function findCustomerRegistrationDuplicate({ tenantId, phone, normalizedPhone, originalPhone, email }) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('Restaurant tenant required for registration');
    const existingPhone = await dbGet(
      'SELECT id FROM customer_accounts WHERE tenant_id=? AND (phone=? OR phone=? OR phone=?)',
      [tenantId, phone, normalizedPhone, originalPhone]
    );
    if (existingPhone) return 'phone';
    if (email) {
      const existingEmail = await dbGet(
        'SELECT id FROM customer_accounts WHERE tenant_id=? AND LOWER(email)=LOWER(?)',
        [tenantId, email]
      );
      if (existingEmail) return 'email';
    }
    return null;
  };
}

/**
 * A legacy global email constraint may still prevent reuse across stores.
 * Signal a generic conflict instead of reporting a storage error or revealing
 * which restaurant holds the address. No schema migration is attempted.
 */
export function isCustomerRegistrationUniqueConflict(error) {
  const message = String(error?.message || '');
  return /(?:UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|duplicate key value violates unique constraint|constraint failed:\s*customer_accounts\.email|unique constraint.*customer_accounts)/i.test(message)
    && /customer_accounts|email|phone/i.test(message);
}
