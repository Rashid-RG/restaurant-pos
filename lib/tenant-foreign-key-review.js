/**
 * Offline, metadata-only foreign-key relationship review.
 * Pure advisory: an ID-only foreign key is not proof of cross-tenant access,
 * and an FK cannot replace request-level tenant authorization.
 */
const normalize = value => String(value ?? '').toLowerCase();

export function reviewTenantForeignKeys(inventory) {
  if (inventory?.format !== 'gastroflow-schema-inventory' || !Array.isArray(inventory.tables)) {
    throw new TypeError('A GastroFlow schema inventory is required');
  }
  const byName = new Map(inventory.tables.map(table => [normalize(table.name), table]));
  const findings = [];
  for (const child of inventory.tables) {
    const groups = new Map();
    for (const fk of child.foreignKeys || []) {
      const id = Number(fk.id);
      if (!Number.isInteger(id) || id < 0) throw new TypeError('Foreign key id must be a non-negative integer');
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(fk);
    }
    for (const [constraintId, rows] of groups) {
      rows.sort((a,b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
      const parentName = rows[0]?.toTable;
      const parent = byName.get(normalize(parentName));
      const childTenantScoped = child.hasTenantColumn === true;
      const parentTenantScoped = parent?.hasTenantColumn === true;
      const tenantPair = rows.some(row => normalize(row.from) === 'tenant_id' && normalize(row.toColumn) === 'tenant_id');
      let status;
      if (!parent) status = 'parent_not_in_inventory';
      else if (!childTenantScoped || !parentTenantScoped) status = 'global_or_unscoped_table_review';
      else if (tenantPair) status = 'tenant_pair_in_foreign_key';
      else status = 'tenant_pair_missing_manual_review';
      findings.push({
        childTable: child.name,
        parentTable: parentName,
        constraintId,
        columns: rows.map(row => ({from:row.from,to:row.toColumn})),
        status,
      });
    }
  }
  const counts = {
    total: findings.length,
    tenantPairMissing: findings.filter(x => x.status === 'tenant_pair_missing_manual_review').length,
    tenantPairPresent: findings.filter(x => x.status === 'tenant_pair_in_foreign_key').length,
  };
  return {
    format:'gastroflow-tenant-foreign-key-review',
    version:1,
    counts,
    findings,
    note:'Advisory schema-only review. Missing tenant pairs are not proof of leaked records. Check server authorization, parent ID uniqueness, actual schema, and clone-only migration rehearsals before any change.',
  };
}
