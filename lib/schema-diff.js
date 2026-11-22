/**
 * Pure, metadata-only schema comparison for offline migration planning.
 * Consumes two inspectDatabaseSchema() results. Never executes SQL.
 * No data rows, credentials, or migration statements are accepted or emitted.
 */
const norm = value => String(value ?? '').toLowerCase();
const ordered = values => [...values].sort((a,b) => a.localeCompare(b));

function canonicalColumns(table) {
  return new Map((table.columns || []).map(column => [norm(column.name), {
    type:norm(column.type).replace(/\s+/g,' ').trim(),
    notNull: Boolean(column.notNull),
    primaryKeyPosition: Number(column.primaryKeyPosition || 0),
  }]));
}
function canonicalIndexes(table) {
  return new Map((table.indexes || []).map(index => [norm(index.name), {
    unique:Boolean(index.unique),
    partial:Boolean(index.partial),
    origin:norm(index.origin),
    columns:(index.columns || []).map(norm),
  }]));
}
function canonicalForeignKeys(table) {
  const groups = new Map();
  for (const key of table.foreignKeys || []) {
    const id = Number(key.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(key);
  }
  return [...groups.values()].map(rows => rows
    .sort((a,b) => Number(a.sequence || 0)-Number(b.sequence || 0))
    .map(key => [norm(key.from),norm(key.toTable),norm(key.toColumn),norm(key.onDelete)]))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function diffMap(previous,next,kind,tableName,changes) {
  for (const name of ordered(new Set([...previous.keys(),...next.keys()]))) {
    const before=previous.get(name), after=next.get(name);
    if (!before) changes.push({kind:kind+'_added',table:tableName,name,impact:'manual_review'});
    else if (!after) changes.push({kind:kind+'_removed',table:tableName,name,impact:'high_risk'});
    else if (JSON.stringify(before)!==JSON.stringify(after))
      changes.push({kind:kind+'_changed',table:tableName,name,impact:'high_risk'});
  }
}
function validate(inv) {
  if (inv?.format!=='gastroflow-schema-inventory'||inv.version!==1||!Array.isArray(inv.tables)) {
    throw new TypeError('Two version 1 GastroFlow schema inventories are required');
  }
  const names=inv.tables.map(t=>norm(t.name));
  if(names.some(n=>!n)||new Set(names).size!==names.length)
    throw new TypeError('Schema inventories must have unique table names');
}
export function compareDatabaseSchemas(before,after) {
  validate(before); validate(after);
  const oldTables=new Map(before.tables.map(t=>[norm(t.name),t]));
  const newTables=new Map(after.tables.map(t=>[norm(t.name),t]));
  const changes=[];
  for(const name of ordered(new Set([...oldTables.keys(),...newTables.keys()]))) {
    const prior=oldTables.get(name), current=newTables.get(name);
    if(!prior){changes.push({kind:'table_added',table:name,impact:'manual_review'});continue;}
    if(!current){changes.push({kind:'table_removed',table:name,impact:'high_risk'});continue;}
    diffMap(canonicalColumns(prior),canonicalColumns(current),'column',name,changes);
    diffMap(canonicalIndexes(prior),canonicalIndexes(current),'index',name,changes);
    if(JSON.stringify(canonicalForeignKeys(prior))!==JSON.stringify(canonicalForeignKeys(current)))
      changes.push({kind:'foreign_keys_changed',table:name,impact:'high_risk'});
    if(Boolean(prior.hasTenantColumn)!==Boolean(current.hasTenantColumn))
      changes.push({kind:'tenant_scope_changed',table:name,impact:'high_risk'});
    const previousGlobal=new Set((prior.review?.globalUniqueIndexCandidates||[]).map(norm));
    const nextGlobal=new Set((current.review?.globalUniqueIndexCandidates||[]).map(norm));
    if(JSON.stringify(ordered(previousGlobal))!==JSON.stringify(ordered(nextGlobal)))
      changes.push({kind:'global_unique_candidates_changed',table:name,impact:'manual_review'});
  }
  return {
    format:'gastroflow-schema-diff',
    version:1,
    changed:changes.length>0,
    highRiskCount:changes.filter(c=>c.impact==='high_risk').length,
    changes,
    approvalRequired:changes.length>0,
    note:'Schema-only comparison. Does not prove record safety, query performance, tenant isolation or reversibility. No SQL is produced or executed.',
  };
}
