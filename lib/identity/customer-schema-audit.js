/**
 * Read-only customer account schema inventory.
 *
 * IMPORTANT: never modify a live POS/Turso database from this helper.
 * Query only SQLite metadata (PRAGMA table_info, index_list, index_info).
 * No customer rows, email addresses, names, or phone numbers are returned.
 *
 * SQLite's automatically generated UNIQUE(email) index survives later
 * CREATE TABLE IF NOT EXISTS declarations. A tenant-scoped preflight cannot
 * override such a legacy database constraint.
 */
export async function inspectCustomerAccountSchema(dbAll) {
  if (typeof dbAll !== 'function') throw new TypeError('A read-only database query provider is required');
  const columns = await dbAll('PRAGMA table_info(customer_accounts)');
  if (!Array.isArray(columns) || columns.length === 0) {
    return { status: 'missing_table', tenantColumnPresent: false, legacyGlobalEmailUnique: false, tenantEmailUnique: false, emailNotNull: false };
  }
  const names = new Set(columns.map(column => String(column.name || '').toLowerCase()));
  const indexes = await dbAll('PRAGMA index_list(customer_accounts)');
  let legacyGlobalEmailUnique = false;
  let tenantEmailUnique = false;
  for (const index of indexes || []) {
    if (!index?.unique || !index?.name) continue;
    // Double quotes are doubled to quote an identifier; names originate
    // only from SQLite's own PRAGMA index_list response.
    const quoted = String(index.name).replace(/"/g, '""');
    const info = await dbAll(`PRAGMA index_info("${quoted}")`);
    const fields = (info || []).map(part => String(part.name || '').toLowerCase());
    if (fields.length === 1 && fields[0] === 'email') legacyGlobalEmailUnique = true;
    if (fields.length === 2 && fields.includes('tenant_id') && fields.includes('email')) tenantEmailUnique = true;
  }
  return {
    status: legacyGlobalEmailUnique ? 'legacy_global_email_unique' : tenantEmailUnique ? 'tenant_email_unique' : 'no_detected_email_unique_index',
    tenantColumnPresent: names.has('tenant_id'),
    legacyGlobalEmailUnique,
    tenantEmailUnique,
    emailNotNull: columns.some(column => String(column.name).toLowerCase() === 'email' && Boolean(column.notnull))
  };
}
