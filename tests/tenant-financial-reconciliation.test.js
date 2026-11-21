import {describe,expect,it} from 'vitest';
import {reconcileTenantOrderTotals} from '../lib/tenant-financial-reconciliation.js';

describe('private tenant financial reconciliation',()=>{
 it('matches tenant counts and money totals irrespective of row order',()=>{
  const before=[
   {id:'private-1',tenant_id:'shop-A',total:1200.25},
   {id:'private-2',tenant_id:'shop-B',total:'40.50'},
   {id:'private-3',tenant_id:'shop-A',total:0.75},
  ];
  const restored=[...before].reverse();
  expect(reconcileTenantOrderTotals(before,restored)).toEqual({
   status:'checked',ok:true,tenantCount:2,mismatchedTenantCount:0,
  });
 });
 it('flags mismatched sums even if the number of orders has not changed',()=>{
  const before=[{tenant_id:'shop-A',total:100},{tenant_id:'shop-B',total:'200.01'}];
  const restored=[{tenant_id:'shop-A',total:100},{tenant_id:'shop-B',total:200}];
  const result=reconcileTenantOrderTotals(before,restored);
  expect(result).toEqual({status:'checked',ok:false,tenantCount:2,mismatchedTenantCount:1});
  expect(JSON.stringify(result)).not.toContain('shop-B');
  expect(JSON.stringify(result)).not.toContain('200');
 });
 it('does not silently treat missing columns or imprecise amounts as verified',()=>{
  expect(reconcileTenantOrderTotals([{tenant_id:'a',amount:100}],[{tenant_id:'a',amount:100}]).status).toBe('unsupported_columns');
  expect(reconcileTenantOrderTotals([{tenant_id:'a',total:'1.234'}],[{tenant_id:'a',total:'1.234'}]).status).toBe('invalid_amount_or_tenant');
  expect(reconcileTenantOrderTotals([{tenant_id:'a',total:null}],[{tenant_id:'a',total:null}]).ok).toBe(false);
  expect(()=>reconcileTenantOrderTotals(null,[])).toThrow(/arrays/);
 });
});
