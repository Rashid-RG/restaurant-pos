import { describe, it, expect } from 'vitest';
import { calculateOrderSettlement } from '../lib/finance/order-settlement.js';
const order = overrides => ({
  tenantId:'restaurant-A', orderId:'order-1', foodCents:200000,
  deliveryCents:20000, serviceCents:3000, taxCents:0, discountCents:0,
  collectedCents:223000, refundedCents:0, platformCommissionCents:10000,
  driverEarnedCents:15000, driverPaidCents:0, platformPaidCents:0,
  restaurantPaidCents:0, ...overrides
});
describe('per-order settlement allocations', () => {
  it('separates collected revenue from driver earnings and merchant share', () => {
    const r=calculateOrderSettlement(order());
    expect(r.netCollectedCents).toBe(223000);
    expect(r.restaurantAllocationCents).toBe(198000);
    expect(r.outstanding).toEqual({driverCents:15000,platformCents:10000,restaurantCents:198000});
    expect(r.financialEvidenceVerified).toBe(false);
  });
  it('tracks refunds against collections without declaring provider success', () => {
    const r=calculateOrderSettlement(order({refundedCents:20000}));
    expect(r.netCollectedCents).toBe(203000);
    expect(r.restaurantAllocationCents).toBe(178000);
    expect(r.financialEvidenceVerified).toBe(false);
  });
  it('does not treat a payout approval as an actual payout', () => {
    const r=calculateOrderSettlement(order({driverPaidCents:5000}));
    expect(r.outstanding.driverCents).toBe(10000);
  });
  it('rejects over-refunds, invalid cents, and excess driver payouts', () => {
    expect(() => calculateOrderSettlement(order({refundedCents:223001}))).toThrow();
    expect(() => calculateOrderSettlement(order({foodCents:12.5}))).toThrow();
    expect(() => calculateOrderSettlement(order({driverPaidCents:15001}))).toThrow();
  });
  it('rejects payouts exceeding merchant or platform allocation', () => {
    expect(() => calculateOrderSettlement(order({restaurantPaidCents:198001}))).toThrow();
    expect(() => calculateOrderSettlement(order({platformPaidCents:10001}))).toThrow();
  });
  it('flags unfunded obligations rather than showing fictitious earnings', () => {
    const r=calculateOrderSettlement(order({refundedCents:220000}));
    expect(r.fundingShortfall).toBe(true);
    expect(r.restaurantAllocationCents).toBe(-22000);
  });
  it('requires tenant and order identity', () => {
    expect(() => calculateOrderSettlement(order({tenantId:''}))).toThrow();
    expect(() => calculateOrderSettlement(order({orderId:null}))).toThrow();
  });
});
