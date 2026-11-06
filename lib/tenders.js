export function amountInCents(value, label = 'Amount') {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value))) throw new Error(`${label} must be a non-negative amount with at most two decimals.`);
  const number = Number(value), cents = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || number > 100000000 || Math.abs(number * 100 - cents) > 0.000001) throw new Error(`Invalid ${label.toLowerCase()}.`);
  return cents;
}

// Cash/card mean a staff-recorded tender; online payments require a gateway callback.
export function validateManualTender(total, method, supplied) {
  if (!['cash', 'card', 'split'].includes(method)) throw new Error('Use cash, external card terminal or a valid split tender. Online payments require gateway confirmation.');
  const due = amountInCents(total, 'Order total');
  const entries = supplied == null && method !== 'split' ? [{ method, amount: total }] : supplied;
  if (!Array.isArray(entries) || !entries.length || entries.length > 32 || (method === 'split' && entries.length < 2)) throw new Error('Provide valid tender entries.');
  const normalized = entries.map(entry => {
    if (!entry || !['cash', 'card'].includes(entry.method) || (method !== 'split' && entry.method !== method)) throw new Error('Invalid tender method.');
    const cents = amountInCents(entry.amount, 'Tender amount');
    if (due > 0 && cents === 0) throw new Error('Tender amounts must be positive.');
    return { method: entry.method, amount: cents / 100 };
  });
  if (normalized.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) !== due) throw new Error('Tender amounts must equal the server order total.');
  return normalized;
}

export function staffReceipt(order) {
  const items = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items || [];
  return { ...order, items: items.map(item => ({ ...item, price: item.unitPrice ?? item.price })) };
}
