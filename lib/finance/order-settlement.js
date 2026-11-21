/**
 * Financial allocation preview for one tenant-owned order.
 * All values are integer cents; no database writes or payment-provider calls.
 * Captured money, approved liabilities and confirmed external payouts are
 * deliberately distinct. A quote or approval never proves collection.
 */
export function calculateOrderSettlement(input) {
  const tenantId = input?.tenantId, orderId = input?.orderId;
  if (typeof tenantId !== 'string' || !tenantId.trim() ||
      typeof orderId !== 'string' || !orderId.trim()) {
    throw new TypeError('A tenant ID and order ID are required');
  }
  const fields = [
    'foodCents','deliveryCents','serviceCents','taxCents','discountCents',
    'refundedCents','collectedCents','platformCommissionCents',
    'driverEarnedCents','driverPaidCents','restaurantPaidCents','platformPaidCents'
  ];
  const values = {};
  for (const field of fields) {
    const value = input[field] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(field + ' must be a non-negative integer number of cents');
    }
    values[field] = value;
  }
  const {
    foodCents, deliveryCents, serviceCents, taxCents, discountCents,
    refundedCents, collectedCents, platformCommissionCents,
    driverEarnedCents, driverPaidCents, restaurantPaidCents, platformPaidCents
  } = values;
  const preDiscountCents = foodCents + deliveryCents + serviceCents + taxCents;
  if (!Number.isSafeInteger(preDiscountCents) || discountCents > preDiscountCents)
    throw new RangeError('Discount exceeds the order charges');
  const billedCents = preDiscountCents - discountCents;
  if (!Number.isSafeInteger(billedCents) || collectedCents > billedCents ||
      refundedCents > collectedCents)
    throw new RangeError('Collected and refunded amounts are inconsistent with the bill');
  if (driverPaidCents > driverEarnedCents)
    throw new RangeError('A driver payout cannot exceed approved earnings');
  const netCollectedCents = collectedCents - refundedCents;
  // Allocation liabilities can be greater than receipts (e.g. a merchant-funded
  // refund). Flag rather than fabricate a funded settlement.
  const restaurantAllocationCents = netCollectedCents - platformCommissionCents - driverEarnedCents;
  const platformOutstandingCents = platformCommissionCents - platformPaidCents;
  const driverOutstandingCents = driverEarnedCents - driverPaidCents;
  const restaurantOutstandingCents = Math.max(0, restaurantAllocationCents) - restaurantPaidCents;
  if (platformOutstandingCents < 0 || restaurantOutstandingCents < 0)
    throw new RangeError('Recorded payouts exceed the allocated balance');
  if (![restaurantAllocationCents, restaurantOutstandingCents].every(Number.isSafeInteger))
    throw new RangeError('Allocation exceeds supported integer precision');
  return Object.freeze({
    tenantId, orderId, currency: 'LKR', billedCents, collectedCents,
    refundedCents, netCollectedCents, platformCommissionCents,
    driverEarnedCents, restaurantAllocationCents,
    payouts: Object.freeze({ driverPaidCents, platformPaidCents, restaurantPaidCents }),
    outstanding: Object.freeze({
      driverCents: driverOutstandingCents,
      platformCents: platformOutstandingCents,
      restaurantCents: restaurantOutstandingCents
    }),
    fullyCollected: collectedCents === billedCents,
    fullyAllocated: platformOutstandingCents === 0 && driverOutstandingCents === 0 &&
      restaurantOutstandingCents === 0,
    fundingShortfall: restaurantAllocationCents < 0,
    // True only for arithmetic reconciliation. Provider, bank and manual
    // settlement evidence must be verified separately.
    financialEvidenceVerified: false
  });
}
