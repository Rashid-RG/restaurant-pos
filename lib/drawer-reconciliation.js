import { restaurantDayBounds } from '../src/utils/restaurant-time.js';

export function moneyFromCents(value) {
  return Math.round(Number(value || 0)) / 100;
}

export function shiftDrawerTotals({ opening = 0, legacySales = [], receipts = [], refundsCents = 0, manualRefundsCents = 0, movements = [] }) {
  const cents = value => Math.round(Number(value || 0) * 100);
  let cashSalesCents = 0;
  let nonCashSalesCents = 0;
  for (const order of legacySales) {
    let tender = [{method:order.paymentMethod,amount:order.total}];
    if (order.paymentMethod === 'split') {
      try { tender = JSON.parse(order.paymentSplit || '[]'); } catch { tender = []; }
    }
    if (!Array.isArray(tender)) tender = [];
    for (const part of tender) {
      const amount = cents(part.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (part.method === 'cash') cashSalesCents += amount;
      else nonCashSalesCents += amount;
    }
  }
  for (const receipt of receipts) {
    const amount = Number(receipt.amountCents) || 0;
    if (receipt.method === 'cash') cashSalesCents += amount;
    else nonCashSalesCents += amount;
  }
  const cashMovementsCents = movements.reduce((sum, movement) => sum + (movement.type === 'cash_in' ? 1 : -1) * cents(movement.amount), 0);
  const refundTotal = Number(refundsCents || 0) + Number(manualRefundsCents || 0);
  const expectedCents = cents(opening) + cashSalesCents + cashMovementsCents - refundTotal;
  return {
    opening:moneyFromCents(cents(opening)),
    cashSales:moneyFromCents(cashSalesCents),
    nonCashReceipts:moneyFromCents(nonCashSalesCents),
    cashRefunds:moneyFromCents(refundTotal),
    cashMovements:moneyFromCents(cashMovementsCents),
    expectedCash:moneyFromCents(expectedCents)
  };
}

export function dayWindow(date, timeZone) {
  return restaurantDayBounds(date, timeZone);
}
