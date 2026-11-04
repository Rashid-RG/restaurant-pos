import crypto from 'node:crypto';

export function verifyPayhereNotification(body, env = process.env) {
  const keys = ['merchant_id', 'order_id', 'payhere_amount', 'payhere_currency', 'status_code', 'md5sig'];
  if (keys.some(key => typeof body?.[key] !== 'string' || !body[key])) return false;
  if (!env.PAYHERE_MERCHANT_SECRET || body.merchant_id !== env.PAYHERE_MERCHANT_ID || body.payhere_currency !== 'LKR') return false;
  if (!/^\d+(?:\.\d{1,2})?$/.test(body.payhere_amount) || !Number.isFinite(Number(body.payhere_amount))) return false;
  if (!/^[a-f\d]{32}$/i.test(body.md5sig)) return false;
  const md5 = value => crypto.createHash('md5').update(value).digest('hex').toUpperCase();
  const expected = md5(keys.slice(0, 5).map(key => body[key]).join('') + md5(env.PAYHERE_MERCHANT_SECRET));
  return crypto.timingSafeEqual(Buffer.from(body.md5sig.toUpperCase()), Buffer.from(expected));
}

export function paymentAmountMatches(total, amount) {
  return Number.isFinite(Number(total)) && Number.isFinite(Number(amount)) &&
    Math.round(Number(total) * 100) === Math.round(Number(amount) * 100);
}
