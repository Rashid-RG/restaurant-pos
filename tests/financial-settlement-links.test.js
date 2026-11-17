import {describe,expect,it} from 'vitest';
import {reviewSettlementRelationships} from '../lib/financial-settlement-links.js';
const fixture=()=>new Map(Object.entries({
 orders:[{id:'secret-order-A',tenant_id:'tenant-A'},{id:'secret-order-B',tenant_id:'tenant-B'}],
 manual_payments:[{id:'payment-A',orderId:'secret-order-A',tenant_id:'tenant-A',amountCents:1000}],
 manual_refunds:[{id:'refund-A',orderId:'secret-order-A',paymentId:'payment-A',tenant_id:'tenant-A',settled:1,amountCents:250}],
 refund_transactions:[{id:'refund-A',orderId:'secret-order-A',tenant_id:'tenant-A',amountCents:250}],
 shifts:[{id:'shift-A',tenant_id:'tenant-A'}],
 cash_movements:[{id:'movement-A',tenant_id:'tenant-A',shiftId:'shift-A'}],
}));
describe('restored settlement relationship audit',()=>{
 it('accepts consistent multi-restaurant payment, refund and shift references',()=>{
  const result=reviewSettlementRelationships(fixture());
  expect(result).toMatchObject({status:'checked',verified:true,relationshipWarnings:0,missingTableCount:0});
  expect(result.checkedRecords).toBe(6);
  for(const secret of ['tenant-A','secret-order-A','refund-A'])expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('detects cross-tenant payment, refund and cash shift links without exposing IDs',()=>{
  const tables=fixture();
  tables.get('manual_payments')[0].tenant_id='tenant-B';
  tables.get('manual_refunds')[0].orderId='secret-order-B';
  tables.get('cash_movements')[0].tenant_id='tenant-B';
  const result=reviewSettlementRelationships(tables);
  expect(result.verified).toBe(false);
  expect(result.relationshipWarnings).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(result)).not.toContain('tenant-B');
 });
 it('does not require a transaction for an unsettled manual refund',()=>{
  const tables=fixture();
  tables.get('manual_refunds')[0].settled=0;
  tables.set('refund_transactions',[]);
  const result=reviewSettlementRelationships(tables);
  expect(result.verified).toBe(true);
 });
 it('marks missing tables and missing columns as incomplete rather than passing',()=>{
  const tables=fixture();
  tables.delete('manual_payments');
  expect(reviewSettlementRelationships(tables)).toMatchObject({status:'tables_missing',verified:false,missingTableCount:1});
  const malformed=fixture();
  delete malformed.get('manual_payments')[0].orderId;
  expect(reviewSettlementRelationships(malformed)).toMatchObject({status:'unsupported_columns',verified:false});
  expect(()=>reviewSettlementRelationships([])).toThrow(/map/);
 });
});
