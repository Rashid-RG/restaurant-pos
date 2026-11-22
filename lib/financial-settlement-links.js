/**
 * Read-only cross-table settlement relationship audit for an offline restored DB.
 * No SQL and no IDs or amounts in the output. Findings are counts only.
 * Historic data may require investigation before interpreting a warning as a bug.
 */
const REQUIRED=['orders','manual_payments','manual_refunds','refund_transactions','shifts','cash_movements'];
const id=x=>x==null?null:String(x);
const reference=(rows,field)=>{
  const map=new Map();let duplicate=0;
  for(const row of rows){
    const value=id(row?.[field]);
    if(value===null||value===''){duplicate++;continue;}
    if(map.has(value))duplicate++;
    else map.set(value,row);
  }
  return {map,duplicate};
};
const sameTenant=(a,b)=>a&&b&&id(a.tenant_id)!==null&&id(a.tenant_id)===id(b.tenant_id);
export function reviewSettlementRelationships(tables) {
  if(!(tables instanceof Map))throw new TypeError('A map of restored tables is required');
  const missing=REQUIRED.filter(name=>!Array.isArray(tables.get(name)));
  if(missing.length)return {status:'tables_missing',verified:false,checkedRecords:0,relationshipWarnings:0,missingTableCount:missing.length};
  const requiredFields={
    orders:['id','tenant_id'],
    manual_payments:['id','orderId','tenant_id','amountCents'],
    manual_refunds:['id','orderId','paymentId','tenant_id','settled','amountCents'],
    refund_transactions:['id','orderId','tenant_id','amountCents'],
    shifts:['id','tenant_id'],
    cash_movements:['id','tenant_id','shiftId'],
  };
  for(const [name,fields] of Object.entries(requiredFields)) {
    if(tables.get(name).some(row=>!row||fields.some(field=>!Object.hasOwn(row,field))))
      return {status:'unsupported_columns',verified:false,checkedRecords:0,relationshipWarnings:0,missingTableCount:0};
  }
  const refs={
    orders:reference(tables.get('orders'),'id'),
    payments:reference(tables.get('manual_payments'),'id'),
    manualRefunds:reference(tables.get('manual_refunds'),'id'),
    transactions:reference(tables.get('refund_transactions'),'id'),
    shifts:reference(tables.get('shifts'),'id'),
    movements:reference(tables.get('cash_movements'),'id'),
  };
  const duplicateReferenceCount=Object.values(refs).reduce((sum,entry)=>sum+entry.duplicate,0);
  const orders=refs.orders.map,payments=refs.payments.map,transactions=refs.transactions.map,shifts=refs.shifts.map;
  let checkedRecords=0,relationshipWarnings=duplicateReferenceCount;
  const check=condition=>{checkedRecords++;if(!condition)relationshipWarnings++;};
  for(const payment of tables.get('manual_payments')){
    const order=orders.get(id(payment.orderId));
    check(sameTenant(payment,order));
  }
  for(const refund of tables.get('manual_refunds')){
    const order=orders.get(id(refund.orderId)),payment=payments.get(id(refund.paymentId));
    check(sameTenant(refund,order));
    check(sameTenant(refund,payment)&&id(refund.orderId)===id(payment?.orderId));
    // A settled manual refund writes a corresponding refund_transactions row
    // using the same ID; unsettled manual bank refunds do not.
    const transaction=transactions.get(id(refund.id));
    if(refund.settled===1||refund.settled==='1'||refund.settled===true)
      check(sameTenant(refund,transaction)&&id(refund.orderId)===id(transaction?.orderId)&&
        String(refund.amountCents)===String(transaction?.amountCents));
  }
  for(const refund of tables.get('refund_transactions')){
    check(sameTenant(refund,orders.get(id(refund.orderId))));
  }
  for(const movement of tables.get('cash_movements')){
    if(movement.shiftId!=null&&id(movement.shiftId)!=='')
      check(sameTenant(movement,shifts.get(id(movement.shiftId))));
  }
  return {status:'checked',verified:relationshipWarnings===0,checkedRecords,relationshipWarnings,duplicateReferenceCount,missingTableCount:0,
    note:'Offline relationship checks only; do not assume every legacy record has fully normalized references.'};
}
