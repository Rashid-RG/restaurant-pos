import { dateAtRestaurant, shiftCalendarDate } from './restaurant-time.js';

const number = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Gross sold items based on confirmed orders. Prices exclude order-level
 * discounts, tax, tips, refunds and service charges. Never treat this as net revenue.
 * The orders argument must already be tenant-scoped by the authenticated API.
 */
export function summarizeSoldItems(orders, { timeZone, from, to, menuItems = [] } = {}) {
  const menuById = new Map(menuItems.map(item => [String(item.id), item]));
  const records = new Map();
  let paidOrderCount = 0;
  let grossItemSales = 0;
  let unitsSold = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    if (order?.paymentStatus !== 'paid' && order?.status !== 'paid') continue;
    const date = dateAtRestaurant(order.paymentTimestamp || order.timestamp, timeZone);
    if (!date || (from && date < from) || (to && date > to)) continue;
    let items = order.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    if (!Array.isArray(items) || items.length === 0) continue;
    paidOrderCount++;
    for (const item of items) {
      if (!item) continue;
      const quantity = number(item.quantity ?? item.qty ?? 0);
      if (quantity <= 0) continue;
      const id = item.menuItemId || item.menuItem?.id || item.id;
      const catalog = id ? menuById.get(String(id)) : null;
      const name = String(item.name || catalog?.name || 'Unknown item');
      const key = id ? 'id:' + id : 'name:' + name.toLocaleLowerCase();
      const unitPrice = number(item.unitPrice ?? item.price);
      const lineGross = quantity * unitPrice;
      const existing = records.get(key) || {
        key, name, category: String(catalog?.category || item.category || 'Uncategorized'),
        quantity: 0, gross: 0, orderIds: new Set()
      };
      existing.quantity += quantity;
      existing.gross += lineGross;
      existing.orderIds.add(order.id);
      records.set(key, existing);
      grossItemSales += lineGross;
      unitsSold += quantity;
    }
  }
  const rows = [...records.values()].map(({ orderIds, ...row }) => ({
    ...row, orders: orderIds.size
  })).sort((a, b) => b.quantity - a.quantity || b.gross - a.gross || a.name.localeCompare(b.name));
  return { rows, paidOrderCount, grossItemSales, unitsSold };
}

export function soldItemsPeriod(mode, today, from, to) {
  if (mode === 'all') return { from: '', to: '' };
  if (mode === 'today') return { from: today, to: today };
  if (mode === 'week') return { from: shiftCalendarDate(today, -6), to: today };
  if (mode === 'month') return { from: today.slice(0, 7) + '-01', to: today };
  return { from, to };
}
