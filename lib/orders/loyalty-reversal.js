/**
 * Restore a customer's reserved loyalty points when an order is cancelled.
 * The caller must own the surrounding order-cancellation transaction; this
 * module does not begin or commit transactions.
 *
 * All order and customer queries are scoped to the explicit restaurant tenant.
 */
export function createReleaseOrderLoyalty({ dbGet, dbRun }) {
  if (typeof dbGet !== 'function' || typeof dbRun !== 'function') {
    throw new TypeError('Loyalty reversal requires database readers and writers');
  }
  return async function releaseOrderLoyalty(orderId, tenantId) {
    const order = await dbGet(
      'SELECT customerAccountId,loyaltyPointsReserved,loyaltyReversed FROM orders WHERE id=? AND tenant_id=?',
      [orderId,tenantId]
    );
    if (!order?.loyaltyPointsReserved || order.loyaltyReversed) return;
    const result = await dbRun(
      'UPDATE customer_accounts SET loyaltyPoints=loyaltyPoints+? WHERE id=? AND tenant_id=?',
      [order.loyaltyPointsReserved,order.customerAccountId,tenantId]
    );
    if (result.changes !== 1) throw Error('Loyalty account needs reconciliation before cancellation.');
    await dbRun(
      'UPDATE orders SET loyaltyReversed=1 WHERE id=? AND tenant_id=?',
      [orderId,tenantId]
    );
  };
}
