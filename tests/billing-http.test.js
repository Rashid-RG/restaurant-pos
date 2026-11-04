import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `billing-http-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'billing-http-regression-secret';
const { app, dbReady, dbRun, dbGet } = await import('../server.js');
const auth = (id = 'user_admin', role = 'owner') => ({ Authorization: `Bearer ${jwt.sign({ id, role, tenant_id: 'default_tenant' }, process.env.JWT_SECRET)}` });
async function ticket(extra = {}) {
  const id = crypto.randomUUID();
  const result = await request(app).post('/api/orders').set(auth()).send({ id, diningType: 'takeaway', items: [{ id: 'billing_item', quantity: 1 }], ...extra });
  expect(result.status).toBe(200);
  return result.body;
}
const pay = (o, extra = {}, headers = auth()) => request(app).post('/api/orders').set(headers).send({ id: o.id, status: 'paid', paymentMethod: 'cash', ...extra });
const refund = (o, amount, refundId = crypto.randomUUID()) => request(app).post(`/api/orders/${o.id}/refund`).set(auth()).send({ refundAmount: amount, reason: 'Customer request', refundId });

beforeAll(async () => {
  await dbReady;
  await dbRun("INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('billing_item','Billing Item',100,1000,'default_tenant',1),('decimal_item','Decimal Item',199.99,1000,'default_tenant',1)");
  await dbRun("INSERT INTO modifiers (id,menuItemId,name,priceDelta,tenant_id) VALUES ('billing_extra','billing_item','Extra',25,'default_tenant')");
  await dbRun("INSERT INTO customers (id,name,points,totalSpent,orderCount,tenant_id) VALUES ('billing_customer','Billing Customer',0,0,0,'default_tenant')");
  for (const key of ['taxRate','serviceChargeRate']) await dbRun('UPDATE settings SET value=0 WHERE key=? AND tenant_id=?', [key,'default_tenant']);
}, 30000);

describe('Billing through real staff endpoints', () => {
  it('prices modifiers and delivery fees on the server and returns the saved receipt', async () => {
    const o = await ticket({ diningType: 'delivery', deliveryFee: 50, items: [{ id: 'billing_item', quantity: 2, price: 1, selectedModifiers: [{ id: 'billing_extra', priceDelta: 0 }] }], subtotal: 1, total: 1 });
    expect(o.subtotal).toBe(250); expect(o.deliveryFee).toBe(50); expect(o.total).toBe(300); expect(o.items[0].price).toBe(125);
    const settled = await pay(o, { paymentSplit: [{ method: 'cash', amount: 300 }] });
    expect(settled.status).toBe(200); expect(settled.body.total).toBe(300); expect(settled.body.items[0].price).toBe(125);
  });
  it.each([
    { paymentMethod: 'split', paymentSplit: [{ method: 'cash', amount: 1 },{ method: 'card', amount: 1 }] },
    { paymentMethod: 'split', paymentSplit: [{ method: 'cash', amount: -1 },{ method: 'card', amount: 101 }] },
    { paymentMethod: 'split', paymentSplit: [{ method: 'payhere', amount: 50 },{ method: 'cash', amount: 50 }] },
    { paymentMethod: 'cash', paymentSplit: [{ method: 'card', amount: 100 }] },
    { paymentMethod: 'cash', paymentSplit: [{ method: 'cash', amount: 99.999 }] },
    { paymentMethod: 'bitcoin' },
    { tip: 100 }
  ])('rejects invalid settlement intent (%#)', async invalid => {
    const o = await ticket();
    expect((await pay(o, invalid)).status).toBe(400);
    const saved = await dbGet('SELECT status,invoiceNumber FROM orders WHERE id=?', [o.id]);
    expect(saved.status).toBe('pending'); expect(saved.invoiceNumber).toBeFalsy();
  });
  it('settles exact mixed tender and cent-balanced portions', async () => {
    const o = await ticket();
    const result = await pay(o, { paymentMethod: 'split', paymentSplit: [{ method: 'cash', amount: 33.34 },{ method: 'card', amount: 33.33 },{ method: 'cash', amount: 33.33 }] });
    expect(result.status).toBe(200); expect(JSON.parse(result.body.paymentSplit).reduce((s,x) => s + Math.round(x.amount * 100),0)).toBe(10000);
  });
  it('does not permit kitchen settlement or gateway-payment bypass', async () => {
    const o = await ticket();
    expect((await pay(o, {}, auth('user_kitchen','kitchen'))).status).toBe(403);
    await dbRun("UPDATE orders SET paymentMethod='payhere' WHERE id=?", [o.id]);
    expect((await pay(o)).status).toBe(409);
  });
  it('applies concurrent settlement once without duplicate loyalty or invoices', async () => {
    const o = await ticket({ customerId: 'billing_customer' });
    const counter = await dbGet('SELECT lastNumber FROM invoice_counter WHERE id=1');
    const customer = await dbGet("SELECT points,totalSpent,orderCount FROM customers WHERE id='billing_customer'");
    const results = await Promise.all([pay(o),pay(o)]);
    expect(results.map(r => r.status)).toEqual([200,200]); expect(results[0].body.invoiceNumber).toBe(results[1].body.invoiceNumber);
    expect((await dbGet('SELECT lastNumber FROM invoice_counter WHERE id=1')).lastNumber).toBe(counter.lastNumber + 1);
    const after = await dbGet("SELECT points,totalSpent,orderCount FROM customers WHERE id='billing_customer'");
    expect(after).toEqual({ points: customer.points + 10, totalSpent: customer.totalSpent + 100, orderCount: customer.orderCount + 1 });
  });
  it('protects paid pending orders from cancellation, repricing and rejection', async () => {
    const o = await ticket();
    await dbRun("UPDATE orders SET paymentStatus='paid' WHERE id=?", [o.id]);
    expect((await request(app).post('/api/orders').set(auth()).send({ id: o.id, status: 'cancelled' })).status).toBe(409);
    expect((await request(app).put(`/api/orders/${o.id}/modify`).set(auth()).send({ items: [{ id: 'billing_item', quantity: 2 }] })).status).toBe(409);
    expect((await request(app).post(`/api/orders/${o.id}/reject`).set(auth()).send({ reason: 'Unavailable' })).status).toBe(409);
  });
  it('records a refund once and rejects reuse with a changed amount', async () => {
    const o = await ticket(); await pay(o); const id = crypto.randomUUID();
    const replies = await Promise.all([refund(o,40,id),refund(o,40,id)]);
    expect(replies.map(r => r.status)).toEqual([200,200]);
    expect((await dbGet('SELECT refundedAmount FROM orders WHERE id=?',[o.id])).refundedAmount).toBe(40);
    expect((await dbGet('SELECT COUNT(*) AS c FROM refund_transactions WHERE orderId=?',[o.id])).c).toBe(1);
    expect((await refund(o,50,id)).status).toBe(409);
  });
  it('prevents concurrent refunds exceeding the remaining balance without automatic food restocking', async () => {
    const o = await ticket(); await pay(o);
    const stock = await dbGet("SELECT stock FROM menu_items WHERE id='billing_item'");
    const results = await Promise.all([refund(o,60),refund(o,60)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);
    expect((await dbGet('SELECT refundedAmount FROM orders WHERE id=?',[o.id])).refundedAmount).toBe(60);
    expect((await refund(o,40)).status).toBe(200);
    expect(await dbGet("SELECT stock FROM menu_items WHERE id='billing_item'")).toEqual(stock);
  });
  it('makes displayed invoice components reconcile to the rounded total', async () => {
    await dbRun("UPDATE settings SET value='10' WHERE key='serviceChargeRate' AND tenant_id='default_tenant'");
    await dbRun("UPDATE settings SET value='8' WHERE key='taxRate' AND tenant_id='default_tenant'");
    try {
      const o = await ticket({ items: [{ id: 'decimal_item', quantity: 3 }] });
      const sum = o.subtotal - o.discount + o.serviceCharge + o.tax + o.tip + o.deliveryFee + o.roundedAmount;
      expect(Math.round(sum * 100)).toBe(Math.round(o.total * 100));
      expect(o).toMatchObject({ subtotal: 599.97, serviceCharge: 60, tax: 52.8, roundedAmount: 0.23, total: 713 });
    } finally {
      await dbRun("UPDATE settings SET value=0 WHERE key IN ('serviceChargeRate','taxRate') AND tenant_id='default_tenant'");
    }
  });
  it('restores item stock only once when rejection is retried concurrently', async () => {
    const before = await dbGet("SELECT stock FROM menu_items WHERE id='billing_item'");
    const o = await ticket();
    const reject = () => request(app).post(`/api/orders/${o.id}/reject`).set(auth()).send({ reason: 'Unavailable' });
    expect((await Promise.all([reject(),reject()])).map(r=>r.status)).toEqual([200,200]);
    expect(await dbGet("SELECT stock FROM menu_items WHERE id='billing_item'")).toEqual(before);
  });
  it('blocks the unvalidated proportional table merge instead of silently repricing bills', async () => {
    expect((await request(app).post('/api/tables/merge').set(auth()).send({ sourceTableId: 'a', targetTableId: 'b' })).status).toBe(503);
  });
  it('reconciles the current cashier cash, split tenders and refunds while preserving an actual zero count', async () => {
    await dbRun('UPDATE orders SET paymentTimestamp=0');
    const opened = await request(app).post('/api/shifts/open').set(auth()).send({ startFloat: 100 });
    expect(opened.status).toBe(200);
    const cash = await ticket(); await pay(cash);
    const split = await ticket(); await pay(split, { paymentMethod: 'split', paymentSplit: [{ method: 'cash', amount: 40 },{ method: 'card', amount: 60 }] });
    const foreign = await ticket(); await pay(foreign, {}, auth('user_cashier','cashier'));
    expect((await refund(cash,30)).status).toBe(200);
    const closed = await request(app).post('/api/shifts/close').set(auth()).send({ actualCash: 0 });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ expectedCash: 210, actualCash: 0, discrepancy: -210 });
    const saved = await dbGet('SELECT actualCash,expectedCash FROM shifts WHERE id=?',[opened.body.id]);
    expect(saved).toEqual({ actualCash: 0, expectedCash: 210 });
  });
});
