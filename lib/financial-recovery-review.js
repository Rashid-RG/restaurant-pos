/**
 * Offline accounting recovery assessment for GastroFlow's actual ledger tables.
 * Pure function; accepts in-memory tables captured from a verified snapshot and
 * a restored local copy. Never queries Turso, prints totals, or mutates records.
 * A clean comparison is NOT a complete financial audit.
 */
const DESCRIPTORS=[
  {name:'manual_payments',columns:['amountCents'],integer:true},
  {name:'manual_refunds',columns:['amountCents'],integer:true},
  {name:'refund_transactions',columns:['amountCents'],integer:true},
  {name:'cash_movements',columns:['amount'],integer:false},
  {name:'shifts',columns:['startFloat','endFloat','actualCash','expectedCash'],integer:false,nullable:true},
];
const INTEGER=/^-?(?:0|[1-9]\d*)$/;
const DECIMAL=/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function valueCents(value,integer,nullable) {
  if(value===null && nullable)return 0n;
  if(typeof value!=='number'&&typeof value!=='string'&&typeof value!=='bigint')return null;
  if(typeof value==='number'&&!Number.isFinite(value))return null;
  const raw=String(value);
  if(!(integer?INTEGER:DECIMAL).test(raw))return null;
  // SQLite INTEGER and JS Number conversions above 2^53 cannot be trusted.
  // Callers may supply decimal strings or bigint for larger exact values.
  if(typeof value==='number'&&!Number.isSafeInteger(value)&&integer)return null;
  if(typeof value==='number'&&Math.abs(value)>Number.MAX_SAFE_INTEGER/100&&!integer)return null;
  if(integer)return BigInt(raw);
  const neg=raw.startsWith('-');
  const [whole,fraction='']=(neg?raw.slice(1):raw).split('.');
  return (neg?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}

function summarize(rows,spec) {
  const groups=new Map();
  for(const row of rows){
    if(!row||typeof row!=='object'||row.tenant_id==null||String(row.tenant_id)==='')return null;
    const amounts=[];
    for(const field of spec.columns){
      if(!Object.hasOwn(row,field))return null;
      const cents=valueCents(row[field],spec.integer,spec.nullable);
      if(cents===null)return null;
      amounts.push(cents);
    }
    const name=String(row.tenant_id);
    const old=groups.get(name)||{count:0,sums:spec.columns.map(()=>0n)};
    groups.set(name,{count:old.count+1,sums:old.sums.map((amount,i)=>amount+amounts[i])});
  }
  return groups;
}
function compareLedger(before,after,spec) {
  if(!before||!after)return {status:'table_missing',verified:false,tenantGroups:0,mismatchedTenantGroups:0};
  if(before.length===0&&after.length===0)return {status:'empty',verified:true,tenantGroups:0,mismatchedTenantGroups:0};
  const a=summarize(before,spec),b=summarize(after,spec);
  if(!a||!b)return {status:'unsupported_columns_or_amounts',verified:false,tenantGroups:0,mismatchedTenantGroups:0};
  let mismatched=0;
  const keys=new Set([...a.keys(),...b.keys()]);
  for(const key of keys){
    const left=a.get(key),right=b.get(key);
    if(!left||!right||left.count!==right.count||left.sums.some((n,i)=>n!==right.sums[i]))mismatched++;
  }
  return {status:'checked',verified:mismatched===0,tenantGroups:keys.size,mismatchedTenantGroups:mismatched};
}
function evaluateInvoices(ordersBefore,ordersAfter,counterBefore,counterAfter) {
  if(!ordersBefore||!ordersAfter||!counterBefore||!counterAfter)
    return {status:'table_missing',verified:false,duplicateInvoices:0};
  const collect=orders=>{
    const unique=new Set();
    let duplicate=0,max=0n;
    for(const row of orders){
      if(!Object.hasOwn(row,'invoiceNumber'))return null;
      const n=row.invoiceNumber;
      if(n===null||n==='')continue;
      const val=valueCents(n,true,false);
      if(val===null||val<=0n)return null;
      if(unique.has(val.toString()))duplicate++;
      unique.add(val.toString());
      if(val>max)max=val;
    }
    return {unique,duplicate,max};
  };
  const a=collect(ordersBefore),b=collect(ordersAfter);
  if(!a||!b||counterBefore.length!==1||counterAfter.length!==1)
    return {status:'invalid_invoice_data',verified:false,duplicateInvoices:0};
  const counterValue=row=>row?.id===1||row?.id==='1' ? valueCents(row.lastNumber,true,false):null;
  const beforeCounter=counterValue(counterBefore[0]),afterCounter=counterValue(counterAfter[0]);
  if(beforeCounter===null||afterCounter===null||beforeCounter<a.max||afterCounter<b.max||beforeCounter<0n||afterCounter<0n)
    return {status:'invalid_invoice_counter',verified:false,duplicateInvoices:b.duplicate};
  const identical=a.unique.size===b.unique.size&&[...a.unique].every(number=>b.unique.has(number));
  return {
    status:'checked',
    verified:identical&&beforeCounter===afterCounter&&a.duplicate===0&&b.duplicate===0,
    duplicateInvoices:b.duplicate,
    invoiceCount:b.unique.size,
    counterMatches:beforeCounter===afterCounter,
  };
}
/** Full table rows remain private inside this process; returned values are aggregates only. */
export function assessRestoredFinancialLedgers(expectedTables,restoredTables) {
  if(!(expectedTables instanceof Map)||!(restoredTables instanceof Map))
    throw new TypeError('Expected and restored tables must be Maps');
  const ledgers={};
  for(const spec of DESCRIPTORS){
    ledgers[spec.name]=compareLedger(expectedTables.get(spec.name),restoredTables.get(spec.name),spec);
  }
  const invoices=evaluateInvoices(expectedTables.get('orders'),restoredTables.get('orders'),
    expectedTables.get('invoice_counter'),restoredTables.get('invoice_counter'));
  const verified=Object.values(ledgers).every(ledger=>ledger.verified)&&invoices.verified;
  return {
    format:'gastroflow-financial-recovery-review',version:1,
    verified,ledgers,invoices,
    note:'All ledger categories must be present and verified for a full pass. Rows and financial totals are never included. Refund tables may reflect related events; do not sum them together.',
  };
}
