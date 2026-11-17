/**
 * Privacy-preserving offline order-total reconciliation for an isolated restore.
 * Does not query databases or expose tenant IDs, amounts, or customer records.
 * Only audits orders with tenant_id and total columns.
 */
function toMinorUnits(value) {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  const text=String(value);
  const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if(!match)return null;
  return (match[1]==='-'?-1n:1n)*
    (BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0')));
}
function totals(rows) {
  const groups=new Map();
  for(const row of rows) {
    if (!row || (typeof row.tenant_id!=='string' && typeof row.tenant_id!=='number') ||
        String(row.tenant_id).length===0)return null;
    const amount=toMinorUnits(row.total);
    if(amount===null)return null;
    const tenant=String(row.tenant_id);
    const previous=groups.get(tenant)||{count:0,total:0n};
    groups.set(tenant,{count:previous.count+1,total:previous.total+amount});
  }
  return groups;
}
export function reconcileTenantOrderTotals(expectedRows,restoredRows) {
  if(!Array.isArray(expectedRows)||!Array.isArray(restoredRows))
    throw new TypeError('Expected and restored order rows must be arrays');
  const supported=rows=>rows.every(row=>row && Object.hasOwn(row,'tenant_id') && Object.hasOwn(row,'total'));
  if(!supported(expectedRows)||!supported(restoredRows))
    return {status:'unsupported_columns',ok:false,tenantCount:0,mismatchedTenantCount:0};
  const expected=totals(expectedRows),actual=totals(restoredRows);
  if(!expected||!actual)
    return {status:'invalid_amount_or_tenant',ok:false,tenantCount:0,mismatchedTenantCount:0};
  let mismatchedTenantCount=0;
  for(const name of new Set([...expected.keys(),...actual.keys()])) {
    const a=expected.get(name),b=actual.get(name);
    if(!a||!b||a.count!==b.count||a.total!==b.total)mismatchedTenantCount++;
  }
  return {status:'checked',ok:mismatchedTenantCount===0,
    tenantCount:new Set([...expected.keys(),...actual.keys()]).size,
    mismatchedTenantCount};
}
