/**
 * Operator-only offline reconciliation of a verified logical snapshot against a
 * RESTORED COPY. The caller supplies a read-only dbAll provider; no connections,
 * writes, credentials or live Turso operations exist here.
 */
import {snapshotHash,quoteIdentifier,encodeBackupValue} from './snapshots.js';

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
  for(const table of snapshot.payload.tables) {
    if(typeof table.name!=='string'||!table.name||tableNames.has(table.name)||
       !Array.isArray(table.rows))
      throw new Error('Invalid snapshot table manifest');
    tableNames.add(table.name);
    const restored=await dbAll(`SELECT * FROM ${quoteIdentifier(table.name)}`);
    if(!Array.isArray(restored))throw new Error('Read-only provider must return arrays');
    const expectedCount=table.rows.length;
    const restoredCount=restored.length;
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
    ok:tables.every(table=>table.matches),
    tableCount:tables.length,
    recordsExpected,
    recordsRestored,
    tables,
    note:'Private offline snapshot comparison only; verify DB integrity and FK checks separately. Never publish customer rows.',
  };
}
