import crypto from 'node:crypto';
export const quoteIdentifier = value => '"' + String(value).replaceAll('"','""') + '"';
export const encodeBackupValue = value => value instanceof Uint8Array ? { $blob:Buffer.from(value).toString('base64') } : value;
export const decodeBackupValue = value => value&&typeof value==='object'&&typeof value.$blob==='string' ? Buffer.from(value.$blob,'base64') : value;
export const snapshotHash = payload => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
export async function captureSnapshot({dbAll,dbRun}) {
 let open=false;
 try {
  await dbRun('BEGIN TRANSACTION');open=true;
  const schema=await dbAll("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index','trigger','view') ORDER BY type,name");
  const tables=[];
  for(const table of schema.filter(row=>row.type==='table')) {
   const rows=await dbAll(`SELECT * FROM ${quoteIdentifier(table.name)}`);
   tables.push({name:table.name,rows:rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,encodeBackupValue(value)])))});
  }
  const payload={format:'gastroflow-logical-backup',version:1,createdAt:Date.now(),schema,tables};
  await dbRun('COMMIT');open=false;
  return {payload,sha256:snapshotHash(payload)};
 }catch(error){if(open)await dbRun('ROLLBACK');throw error}
}
