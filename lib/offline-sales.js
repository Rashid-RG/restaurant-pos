import crypto from 'node:crypto';
import { resolveAndCalculateBill, allocateInvoiceNumber } from './billing.js';

// Reconcile a batch atomically. Cash received offline must equal current trusted
// server pricing; discrepancies are retained on the device for human review.
export async function reconcileOfflineSales({ dbGet, dbRun, tenantId, userId }, orders) {
  if (!Array.isArray(orders) || !orders.length || orders.length > 100) throw new Error('Provide between 1 and 100 offline sales.');
  const syncedIds = [];
  let syncedCount = 0;
  await dbRun('BEGIN TRANSACTION');
  try {
    for (const order of orders) {
      if (!/^off_[\w-]{1,120}$/.test(order.offlineId || '') || order.paymentMethod !== 'cash') throw new Error('Only identified offline cash sales can be reconciled.');
      if (order.tenant_id && order.tenant_id !== tenantId) throw new Error('Offline sale belongs to another restaurant.');
      const existing = await dbGet('SELECT tenant_id, source FROM orders WHERE id = ?', [order.offlineId]);
      if (existing) {
        if (existing.tenant_id !== tenantId || existing.source !== 'offline') throw new Error('Offline identifier conflicts with an existing record.');
        syncedIds.push(order.offlineId);
        continue;
      }
      const bill = await resolveAndCalculateBill({ dbGet, tenantId }, order.items, null, 0, 0, 0, null, 0);
      if (!Number.isFinite(Number(order.total)) || Math.round(Number(order.total) * 100) !== Math.round(bill.total * 100)) throw new Error('Offline amount differs from current pricing. Manual reconciliation is required.');
      const invoice = await allocateInvoiceNumber({ dbGet, dbRun });
      const timestamp = Number(order.createdAt);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > Date.now() + 60000) throw new Error('Invalid offline sale timestamp.');
      await dbRun(`INSERT INTO orders (id, orderType, diningType, total, subtotal, tax, serviceCharge, discount, tip, status, paymentStatus, paymentMethod, cashierId, timestamp, paymentTimestamp, tenant_id, source, items, invoiceNumber)
        VALUES (?,?,?,?,?,?,?,?,?,'paid','paid','cash',?,?,?,?, 'offline',?,?)`,
      [order.offlineId, order.orderType || 'takeaway', order.orderType || 'takeaway', bill.total, bill.subtotal, bill.tax, bill.serviceCharge, 0, 0, userId, timestamp, timestamp, tenantId, JSON.stringify(bill.resolvedItems), invoice]);
      for (const item of bill.resolvedItems) {
        const reserved = await dbRun('UPDATE menu_items SET stock=stock-? WHERE id=? AND tenant_id=? AND (stock IS NULL OR stock>=?)', [item.quantity, item.id, tenantId, item.quantity]);
        if (reserved.changes !== 1) throw new Error('Insufficient stock for offline reconciliation.');
        await dbRun('INSERT INTO order_items (id,orderId,menuItemId,name,price,quantity,notes,tenant_id) VALUES (?,?,?,?,?,?,?,?)', [crypto.randomUUID(), order.offlineId, item.id, item.name, item.unitPrice, item.quantity, item.notes, tenantId]);
      }
      syncedIds.push(order.offlineId);
      syncedCount++;
    }
    await dbRun('COMMIT');
    return { ok: true, syncedCount, syncedIds };
  } catch (error) { await dbRun('ROLLBACK'); throw error; }
}
