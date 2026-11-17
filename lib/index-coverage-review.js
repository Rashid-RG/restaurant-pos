/**
 * Advisory index review for an already captured GastroFlow schema inventory.
 * Pure function. No SQL execution, migrations, or live database access.
 * A suggested index is NOT approval to create one: EXPLAIN QUERY PLAN and
 * real workload timing on an isolated copy are required first.
 */
const WATCH = Object.freeze([
  {table:'orders', columns:['tenant_id','timestamp'], reason:'Restaurant-local sales/history lookups, ordered by timestamp'},
  {table:'orders', columns:['tenant_id','status'], reason:'Restaurant-local pending/ready order filtering'},
  {table:'manual_payments', columns:['tenant_id','actorId','createdAt'], reason:'Cashier shift payment ledger by restaurant and period'},
  {table:'timeclock_entries', columns:['userId','clockOut'], reason:'Active staff shift lookup'},
]);

const normalize = value => String(value ?? '').toLowerCase();
const isPrefix = (whole, prefix) => prefix.every((part, i) => normalize(whole[i]) === normalize(part));

export function reviewIndexCoverage(inventory) {
  if (inventory?.format !== 'gastroflow-schema-inventory' || !Array.isArray(inventory.tables)) {
    throw new TypeError('A GastroFlow schema inventory is required');
  }
  const findings = [];
  for (const spec of WATCH) {
    const table = inventory.tables.find(t => normalize(t.name) === normalize(spec.table));
    if (!table) {
      findings.push({table:spec.table, columns:spec.columns, status:'table_not_present', reason:spec.reason});
      continue;
    }
    const available = new Set((table.columns || []).map(c => normalize(c.name)));
    if (!spec.columns.every(column => available.has(normalize(column)))) {
      findings.push({table:spec.table, columns:spec.columns, status:'columns_not_present', reason:spec.reason});
      continue;
    }
    const covering = (table.indexes || []).filter(index =>
      !index.partial && Array.isArray(index.columns) && isPrefix(index.columns,spec.columns)
    );
    findings.push({
      table:spec.table, columns:spec.columns,
      status:covering.length ? 'covered' : 'review_candidate',
      coveringIndexes:covering.map(i => i.name), reason:spec.reason,
    });
  }
  // The same left-most key prefix may serve several access patterns. Flag
  // duplicates for manual review, not automatic deletion; uniqueness, collations,
  // partial predicates, sort order, expression keys, and workload still matter.
  const duplicatePrefixes = [];
  for (const table of inventory.tables) {
    const eligible = (table.indexes || []).filter(i => !i.partial && !i.unique &&
      Array.isArray(i.columns) && i.columns.length > 0 && i.columns.every(Boolean));
    for (let i=0;i<eligible.length;i++) for(let j=i+1;j<eligible.length;j++) {
      const first=eligible[i],second=eligible[j];
      if (isPrefix(first.columns,second.columns) || isPrefix(second.columns,first.columns)) {
        duplicatePrefixes.push({table:table.name,indexes:[first.name,second.name],status:'manual_review_only'});
      }
    }
  }
  return {format:'gastroflow-index-review',version:1,findings,duplicatePrefixes,
    note:'Advisory only. Do not add or delete an index without restored-copy EXPLAIN QUERY PLAN, workload benchmarks and migration approval.'};
}
