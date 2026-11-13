import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { validateProductionConfig } from '../lib/runtime-config.js';
import { testCheckoutProof } from './checkout-proof-fixture.js';
import { createDatabaseGate } from '../lib/database-gate.js';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `gastroflow_hardening_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'regression_staff_secret';
process.env.CUSTOMER_JWT_SECRET = 'regression_customer_secret';
process.env.PAYHERE_MERCHANT_ID = 'TESTMERCHANT';
process.env.PAYHERE_MERCHANT_SECRET = 'regression_merchant_secret';
const { app, dbReady, dbRun, dbGet } = await import('../server.js');
const token = (id, role = 'owner', tenant_id = 'default_tenant') => jwt.sign({ id, role, tenant_id }, process.env.JWT_SECRET);
const admin = () => token('user_admin');
const bOwner = () => token('tenant_b_owner', 'owner', 'tenant_B');
const cashier = () => token('user_cashier', 'cashier');
const auth = value => ({ Authorization: `Bearer ${value}` });
const signedPayment = (order, overrides = {}) => {
  const body = { merchant_id: 'TESTMERCHANT', order_id: order.orderId, payhere_amount: Number(order.total).toFixed(2), payhere_currency: 'LKR', status_code: '2', ...overrides };
  const md5 = value => crypto.createHash('md5').update(value).digest('hex').toUpperCase();
  body.md5sig = md5(body.merchant_id + body.order_id + body.payhere_amount + body.payhere_currency + body.status_code + md5(process.env.PAYHERE_MERCHANT_SECRET));
  return body;
};
async function order(items = [{ menuItemId: 'security_item', quantity: 1 }], extra = {}) {
  const checkoutProof = await testCheckoutProof(dbRun, 'default_tenant', extra.customerPhone || '0770000000');
  return request(app).post('/api/public/orders').send({ items, customerName: 'Regression Tester', customerPhone: '0770000000', orderType: 'takeaway', ...extra, checkoutProof });
}
beforeAll(async () => {
  await dbReady;
  await dbRun("INSERT INTO tenants (id,name,subdomain,ownerEmail,status) VALUES ('tenant_B','Tenant B','tenant-b','b@example.test','active')");
  await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('tenant_b_owner','b-owner','owner','tenant_B')");
  await dbRun("INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('security_item','Security Item',100,100,'default_tenant',1), ('private_b_item','B Secret',999,20,'tenant_B',1)");
  await dbRun("INSERT INTO orders (id,total,status,tenant_id) VALUES ('private_b_order',999,'pending','tenant_B')");
}, 30000);

describe('Production environment validation', () => {
  const env = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), CUSTOMER_JWT_SECRET: 'b'.repeat(48), ADMIN_USERNAME: 'operator', ADMIN_PASSWORD: 'RandomAndUnique!73149', ADMIN_PIN: '649273', CORS_ORIGIN: 'https://pos.example.test', PAYHERE_MERCHANT_ID: '1223344', PAYHERE_MERCHANT_SECRET: 'merchant-secret', PAYHERE_NOTIFY_URL: 'https://pos.example.test/api/payments/payhere/webhook' };
  it('accepts explicit production configuration', () => expect(() => validateProductionConfig(env)).not.toThrow());
  it.each(['JWT_SECRET', 'CUSTOMER_JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_PIN', 'CORS_ORIGIN', 'PAYHERE_MERCHANT_ID', 'PAYHERE_MERCHANT_SECRET', 'PAYHERE_NOTIFY_URL'])('rejects a missing %s', key => expect(() => validateProductionConfig({ ...env, [key]: '' })).toThrow());
  it('rejects sample secrets', () => expect(() => validateProductionConfig({ ...env, JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_STRING' })).toThrow());
  it('allows explicit cash-only production without gateway credentials', () => {
    expect(() => validateProductionConfig({ ...env, PAYHERE_ENABLED: 'false', PAYHERE_MERCHANT_ID: '', PAYHERE_MERCHANT_SECRET: '', PAYHERE_NOTIFY_URL: '' })).not.toThrow();
  });
  it('rejects ambiguous payment enablement values', () => expect(() => validateProductionConfig({ ...env, PAYHERE_ENABLED: 'no' })).toThrow(/PAYHERE_ENABLED/));
  it('rejects shared staff and customer secrets', () => expect(() => validateProductionConfig({ ...env, CUSTOMER_JWT_SECRET: env.JWT_SECRET })).toThrow());
  it('rejects unvalidated pooled Postgres transactions', () => expect(() => validateProductionConfig({ ...env, DATABASE_URL: 'postgres://localhost/db' })).toThrow(/PostgreSQL/));
});

describe('Actual HTTP authorization and tenant isolation', () => {
  it('rejects a driver JWT on a staff endpoint', async () => {
    const driver = jwt.sign({ driverId: 'drv_1', role: 'driver', tenant_id: 'default_tenant' }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/orders').set(auth(driver))).status).toBe(403);
  });
  it('rejects a driver token on both staff event streams', async () => {
    const driver = jwt.sign({ driverId: 'drv_1', role: 'driver', tenant_id: 'default_tenant' }, process.env.JWT_SECRET);
    for (const path of ['/api/stream/pos', '/api/events']) expect((await request(app).get(`${path}?token=${driver}`)).status).toBe(403);
  });
  it('rejects a customer JWT on a staff endpoint even with the staff signing key', async () => {
    const customer = jwt.sign({ id: 'user_admin', type: 'customer' }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/settings').set(auth(customer))).status).toBe(403);
  });
  it('revokes a deleted staff account', async () => expect((await request(app).get('/api/settings').set(auth(token('deleted')))).status).toBe(403));
  it('does not let an owner of tenant B manage the platform', async () => {
    expect((await request(app).get('/api/saas/tenants').set(auth(bOwner()))).status).toBe(403);
    expect((await request(app).patch('/api/saas/tenants/default_tenant/status').set(auth(bOwner())).send({ status: 'suspended' })).status).toBe(403);
  });
  it('does not let a cashier edit menu items through an earlier generic route', async () => {
    expect((await request(app).post('/api/menu_items').set(auth(cashier())).send({ id: 'security_item', name: 'Tampered', price: 1 })).status).toBe(403);
  });
  it('does not allow overwriting another tenant item by globally unique ID', async () => {
    expect((await request(app).post('/api/menu_items').set(auth(admin())).send({ id: 'private_b_item', name: 'Tampered', price: 1 })).status).toBe(404);
    expect((await dbGet('SELECT tenant_id FROM menu_items WHERE id = ?', ['private_b_item'])).tenant_id).toBe('tenant_B');
  });
  it('rejects cross-tenant order mutations', async () => {
    expect((await request(app).post('/api/orders').set(auth(admin())).send({ id: 'private_b_order', status: 'paid' })).status).toBe(404);
    expect((await request(app).post('/api/orders/private_b_order/accept').set(auth(admin())).send({})).status).toBe(404);
    expect((await dbGet('SELECT status FROM orders WHERE id = ?', ['private_b_order'])).status).toBe('pending');
  });
  it('rejects cross-tenant items at actual public checkout', async () => {
    const res = await order([{ menuItemId: 'private_b_item', quantity: 1 }]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.orderId).toBeUndefined();
  });
  it('never copies another tenant customer into the requesting CRM', async () => {
    await dbRun("INSERT INTO customer_accounts (id,name,phone,email,passwordHash,createdAt,tenant_id) VALUES ('private_account_b','Private B','0715555555','private-b@example.test','not-a-login-fixture',0,'tenant_B')");
    const res = await request(app).get('/api/customers').set(auth(admin()));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Private B');
    expect((await dbGet("SELECT COUNT(*) AS c FROM customers WHERE id='private_account_b' AND tenant_id='default_tenant'")).c).toBe(0);
  });
  it('does not expose staff PINs', async () => {
    const res = await request(app).get('/api/users').set(auth(admin()));
    expect(res.status).toBe(200);
    expect(res.body.every(user => !('pin' in user) && !('passwordHash' in user))).toBe(true);
  });
  it('prevents a manager creating an owner', async () => {
    const manager = token('user_manager', 'manager');
    expect((await request(app).post('/api/users').set(auth(manager)).send({ username: 'escalated', role: 'owner', password: 'AnActualPassword!5' })).status).toBe(403);
  });
  it('rejects a negative refund', async () => {
    expect((await request(app).post('/api/orders/x/refund').set(auth(admin())).send({ refundAmount: -100, reason: 'test' })).status).toBe(400);
  });
});

describe('Payment validation on both callback URLs', () => {
  it.each(['/api/payments/payhere/webhook','/api/public/payment/payhere/notify'])('%s rejects a signed amount mismatch', async url => {
    const placed = (await order()).body;
    const res = await request(app).post(url).type('form').send(signedPayment(placed, { payhere_amount: '1.00' }));
    expect(res.status).toBe(400);
    expect((await dbGet('SELECT status FROM orders WHERE id = ?', [placed.orderId])).status).toBe('pending');
  });
  it('rejects another merchant and wrong currency even with valid checksums', async () => {
    const placed = (await order()).body;
    for (const overrides of [{ merchant_id: 'WRONG' }, { payhere_currency: 'USD' }]) {
      expect((await request(app).post('/api/payments/payhere/webhook').send(signedPayment(placed, overrides))).status).toBe(400);
    }
  });
  it('settles concurrent callbacks idempotently and accepts form-encoded notifications', async () => {
    const placed = (await order()).body;
    const body = signedPayment(placed);
    const replies = await Promise.all([request(app).post('/api/payments/payhere/webhook').type('form').send(body), request(app).post('/api/public/payment/payhere/notify').type('form').send(body)]);
    expect(replies.map(r => r.status)).toEqual([200,200]);
    const record = await dbGet('SELECT status,paymentStatus,invoiceNumber FROM orders WHERE id = ?', [placed.orderId]);
    expect(record.status).toBe('pending');
    expect(record.paymentStatus).toBe('paid');
    expect(record.invoiceNumber).toBeTruthy();
    const counter = await dbGet('SELECT lastNumber FROM invoice_counter WHERE id=1');
    expect(counter.lastNumber).toBe(1);
  });
  it('does not grant loyalty discounts without an authenticated balance', async () => expect((await order(undefined, { loyaltyPointsToRedeem: 100000 })).status).toBe(400));
  it('rejects negative, zero and fractional quantities', async () => {
    for (const quantity of [-1, 0, 0.5]) expect((await order([{ menuItemId: 'security_item', quantity }])).status).toBe(400);
  });
  it('does not oversell when two checkouts race for the last item', async () => {
    await dbRun("INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('last_item','Last Item',100,1,'default_tenant',1)");
    const results = await Promise.all([order([{ menuItemId: 'last_item', quantity: 1 }]), order([{ menuItemId: 'last_item', quantity: 1 }])]);
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect((await dbGet("SELECT stock FROM menu_items WHERE id='last_item'")).stock).toBe(0);
  });
});

describe('Database transaction ownership', () => {
  it('prevents other contexts reading or writing uncommitted work', async () => {
    const gate = createDatabaseGate();
    const events = [];
    let unblock;
    const wait = new Promise(resolve => { unblock = resolve; });
    const first = gate.withContext(async () => {
      await gate.run('BEGIN', async () => events.push('begin'));
      await wait;
      await gate.run('COMMIT', async () => events.push('commit'));
    });
    // Wait until the first transaction has acquired the gate.
    while (!events.length) await new Promise(resolve => setImmediate(resolve));
    const second = gate.withContext(() => gate.run('SELECT', async () => events.push('read')));
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual(['begin']);
    unblock();
    await Promise.all([first, second]);
    expect(events).toEqual(['begin','commit','read']);
  });
});


describe('Cash-only deployment isolation', () => {
  it('disables gateway routes and advertises their unavailability', async () => {
    const original = process.env.PAYHERE_ENABLED;
    process.env.PAYHERE_ENABLED = 'false';
    try {
      for (const path of ['/api/payments/payhere/checkout','/api/payments/payhere/webhook','/api/payments/payhere/dev-simulate','/api/public/payment/payhere/hash','/api/public/payment/payhere/notify']) expect((await request(app).post(path).send({})).status).toBe(503);
      expect((await request(app).get('/api/public/menu')).body.payhereEnabled).toBe(false);
      expect((await request(app).get('/api/settings').set(auth(admin()))).body.payhereEnabled).toBe(false);
      expect((await order(undefined, { paymentMethod: 'payhere' })).status).toBe(503);
    } finally {
      if (original === undefined) delete process.env.PAYHERE_ENABLED;
      else process.env.PAYHERE_ENABLED = original;
    }
  });
});
