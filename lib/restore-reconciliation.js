/**
 * Operator-only offline reconciliation of a verified logical snapshot against a
 * RESTORED COPY. The caller supplies a read-only dbAll provider; no connections,
 * writes, credentials or live Turso operations exist here.
 */
import {snapshotHash,quoteIdentifier,encodeBackupValue} from './snapshots.js';
import {reconcileTenantOrderTotals} from './tenant-financial-reconciliation.js';

const canonical = row => JSON.stringify(Object.fromEntries(
  Object.entries(row).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>[key,encodeBackupValue(value)])
));
const stableRows = rows => rows.map(canonical).sort();

export async function reconcileRestoredSnapshot(snapshot, dbAll) {
  if(typeof dbAll!=='function')throw new TypeError('A read-only query provider is required');
  if(snapshot?.payload?.format!=='gastroflow-logical-backup'||
     snapshot.payload.version!==1||
     !Array.isArray(snapshot.payload.tables)||
     snapshot.sha256!==snapshotHash(snapshot.payload))
    throw new Error('Unsupported or corrupt logical snapshot');
  const tableNames=new Set();
  const tables=[];
  let recordsExpected=0,recordsRestored=0;
  let tenantFinancials={status:'orders_table_missing',ok:false,tenantCount:0,mismatchedTenantCount:0};
  for(const table of snapshot.payload.tables) {
    if(typeof table.name!=='string'||!table.name||tableNames.has(table.name)||
       !Array.isArray(table.rows))
      throw new Error('Invalid snapshot table manifest');
    tableNames.add(table.name);
    const restored=await dbAll(`SELECT * FROM ${quoteIdentifier(table.name)}`);
    if(!Array.isArray(restored))throw new Error('Read-only provider must return arrays');
    const expectedCount=table.rows.length;
    const restoredCount=restored.length;
    if(table.name.toLowerCase()==='orders')
      tenantFinancials=reconcileTenantOrderTotals(table.rows,restored);
    const matches=expectedCount===restoredCount&&
      JSON.stringify(stableRows(table.rows))===JSON.stringify(stableRows(restored));
    recordsExpected+=expectedCount;
    recordsRestored+=restoredCount;
    // No row values, emails, order IDs or per-record hashes leave this API.
    tables.push({name:table.name,expectedCount,restoredCount,matches});
  }
  return {
    format:'gastroflow-restore-reconciliation',
    version:1,
    ok:tables.every(table=>table.matches) && (tenantFinancials.status!=='checked'||tenantFinancials.ok),
    financialVerified:tenantFinancials.status==='checked'&&tenantFinancials.ok,
    tableCount:tables.length,
    recordsExpected,
    recordsRestored,
    tables,
    tenantFinancials,
    note:'Private offline snapshot comparison only. Financial gate is separate: missing orders or incompatible financial columns are NOT verified. Verify DB integrity and FK checks separately. Never publish customer rows.',
  };
}
