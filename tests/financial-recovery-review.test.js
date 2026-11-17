import {describe,expect,it} from 'vitest';
import {assessRestoredFinancialLedgers} from '../lib/financial-recovery-review.js';

const fixture=()=>new Map(Object.entries({
  orders:[
    {id:'hidden-A',tenant_id:'tenant-A',invoiceNumber:1},
    {id:'hidden-B',tenant_id:'tenant-B',invoiceNumber:2},
  ],
  invoice_counter:[{id:1,lastNumber:2}],
  manual_payments:[
    {tenant_id:'tenant-A',amountCents:120025},
    {tenant_id:'tenant-B',amountCents:9500},
  ],
  manual_refunds:[{tenant_id:'tenant-A',amountCents:1000}],
  refund_transactions:[{tenant_id:'tenant-A',amountCents:1000}],
  cash_movements:[{tenant_id:'tenant-A',amount:20.25}],
  shifts:[{tenant_id:'tenant-A',startFloat:200,endFloat:null,actualCash:201.5,expectedCash:205.25}],
}));
describe('offline financial ledger and invoice recovery assessment',()=>{
 it('checks payments, both refunds, cash movements, shifts and invoices without revealing money',()=>{
  const before=fixture();
  const after=new Map([...fixture()].map(([table,rows])=>[table,[...rows].reverse()]));
  const report=assessRestoredFinancialLedgers(before,after);
  expect(report.verified).toBe(true);
  expect(report.ledgers.manual_payments).toMatchObject({status:'checked',verified:true,tenantGroups:2});
  expect(report.ledgers.shifts.verified).toBe(true);
  expect(report.invoices).toMatchObject({status:'checked',verified:true,invoiceCount:2,duplicateInvoices:0,counterMatches:true});
  const printed=JSON.stringify(report);
  for(const secret of ['tenant-A','tenant-B','hidden-A','120025','205.25'])expect(printed).not.toContain(secret);
 });
 it('detects mismatched refund and cash amounts but keeps reports private',()=>{
  const a=fixture(),b=fixture();
  b.set('manual_refunds',[{tenant_id:'tenant-A',amountCents:1100}]);
  b.set('cash_movements',[{tenant_id:'tenant-A',amount:20.20}]);
  const r=assessRestoredFinancialLedgers(a,b);
  expect(r.verified).toBe(false);
  expect(r.ledgers.manual_refunds.mismatchedTenantGroups).toBe(1);
  expect(r.ledgers.cash_movements.mismatchedTenantGroups).toBe(1);
  expect(JSON.stringify(r)).not.toContain('tenant-A');
 });
 it('detects invoice number reuse and discrepancies with the global counter',()=>{
  const a=fixture(),b=fixture();
  b.set('orders',[
    {id:'hidden-A',tenant_id:'tenant-A',invoiceNumber:1},
    {id:'hidden-B',tenant_id:'tenant-B',invoiceNumber:1},
  ]);
  const duplicated=assessRestoredFinancialLedgers(a,b);
  expect(duplicated.invoices.duplicateInvoices).toBe(1);
  expect(duplicated.invoices.verified).toBe(false);
  b.set('orders',a.get('orders'));
  b.set('invoice_counter',[{id:1,lastNumber:3}]);
  const counter=assessRestoredFinancialLedgers(a,b);
  expect(counter.invoices.counterMatches).toBe(false);
  expect(counter.verified).toBe(false);
 });
 it('does not claim a full pass for absent ledgers, unsafe cents, or missing columns',()=>{
  const a=fixture(),b=fixture();
  b.delete('manual_refunds');
  expect(assessRestoredFinancialLedgers(a,b).ledgers.manual_refunds.status).toBe('table_missing');
  b.set('manual_refunds',[{tenant_id:'tenant-A',amountCents:1000}]);
  b.set('manual_payments',[{tenant_id:'tenant-A',amountCents:1.5}]);
  expect(assessRestoredFinancialLedgers(a,b).ledgers.manual_payments.status).toBe('unsupported_columns_or_amounts');
  b.set('manual_payments',[{tenant_id:'tenant-A'}]);
  expect(assessRestoredFinancialLedgers(a,b).verified).toBe(false);
  expect(()=>assessRestoredFinancialLedgers([],new Map())).toThrow(/Maps/);
 });
 it('does not treat an empty ledger as a missing table',()=>{
  const a=fixture(),b=fixture();
  a.set('manual_refunds',[]);b.set('manual_refunds',[]);
  expect(assessRestoredFinancialLedgers(a,b).ledgers.manual_refunds).toMatchObject({status:'empty',verified:true});
 });
});
