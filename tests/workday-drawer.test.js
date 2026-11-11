import {describe,it,expect} from 'vitest';
import {shiftDrawerTotals,dayWindow} from '../lib/drawer-reconciliation.js';
describe('Workday cash drawer accounting',()=>{
  it('separates opening float and physical cash from card receipts',()=>{
    const report=shiftDrawerTotals({
      opening:5000,
      legacySales:[{paymentMethod:'cash',total:35000},{paymentMethod:'card',total:20000}],
      refundsCents:0,
      movements:[{type:'cash_out',amount:2000}]
    });
    expect(report).toMatchObject({opening:5000,cashSales:35000,nonCashReceipts:20000,cashMovements:-2000,expectedCash:38000});
  });
  it('counts split payments, manual receipts, refunds and cash movements exactly once',()=>{
    const report=shiftDrawerTotals({
      opening:1200,
      legacySales:[{paymentMethod:'split',paymentSplit:JSON.stringify([{method:'cash',amount:150},{method:'card',amount:50}])}],
      receipts:[{method:'cash',amountCents:2500},{method:'bank',amountCents:1000}],
      refundsCents:1000,manualRefundsCents:500,
      movements:[{type:'cash_in',amount:50},{type:'cash_out',amount:20}]
    });
    expect(report).toMatchObject({cashSales:175,nonCashReceipts:60,cashRefunds:15,cashMovements:30,expectedCash:1390});
  });
  it('uses restaurant-local calendar boundaries',()=>{
    const [start,end]=dayWindow('2026-11-11','Asia/Colombo');
    expect(start).toBe(Date.parse('2026-11-10T18:30:00Z'));
    expect(end).toBe(Date.parse('2026-11-11T18:30:00Z'));
  });
});
