/**
 * tests/integration.test.js — HTTP integration tests (supertest against the real app).
 *
 * Covers the highest-blast-radius paths that unit tests can't: auth, the PayHere
 * payment webhook (signature required, amount asserted, idempotent settlement,
 * gapless invoice numbers), and driver auth.
 *
 * The env below MUST be set before importing server.js (it reads them at load).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

const TMP_DB = path.join(os.tmpdir(), `gastroflow_it_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.JWT_SECRET = 'test_jwt_secret_integration';
process.env.PAYHERE_MERCHANT_SECRET = 'test_merchant_secret';
process.env.PAYHERE_MERCHANT_ID = 'TESTMERCHANT';
// NODE_ENV stays undefined (not 'production') so fail-fast + dev-simulate guard behave for tests.

const { app, dbReady } = await import('../server.js');
const request = (await import('supertest')).default;

// Reproduce the server's PayHere webhook signature exactly.
function payhereSig({ merchant_id, order_id, payhere_amount, payhere_currency, status_code }) {
  const localMd5Secret = crypto.createHash('md5').update(process.env.PAYHERE_MERCHANT_SECRET).digest('hex').toUpperCase();
  const src = `${merchant_id || ''}${order_id || ''}${payhere_amount || ''}${payhere_currency || ''}${status_code || ''}${localMd5Secret}`;
  return crypto.createHash('md5').update(src).digest('hex').toUpperCase();
}

async function createOnlineOrder() {
  const menu = await request(app).get('/api/public/menu');
  const item = menu.body.items[0];
  const res = await request(app).post('/api/public/orders').send({
    items: [{ menuItemId: item.id, quantity: 2 }],
    orderType: 'takeaway',
    customerName: 'IT Tester',
    customerPhone: '0770000000'
  });
  return res.body; // { orderId, total, ... }
}

beforeAll(async () => {
  await dbReady; // wait for tables + seeding (health returns 200 before this completes)
}, 30000);

describe('Auth', () => {
  it('logs in the seeded admin and returns a role-bearing token', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects a protected route without a token', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });
});

describe('PayHere webhook — signature, amount, idempotency', () => {
  it('rejects a webhook with a missing signature (no free orders)', async () => {
    const order = await createOnlineOrder();
    const res = await request(app).post('/api/payments/payhere/webhook').send({
      merchant_id: 'TESTMERCHANT', order_id: order.orderId,
      payhere_amount: Number(order.total).toFixed(2), payhere_currency: 'LKR', status_code: '2'
      // md5sig omitted
    });
    expect(res.status).toBe(400);
  });

  it('rejects a webhook with a wrong signature', async () => {
    const order = await createOnlineOrder();
    const res = await request(app).post('/api/payments/payhere/webhook').send({
      merchant_id: 'TESTMERCHANT', order_id: order.orderId,
      payhere_amount: Number(order.total).toFixed(2), payhere_currency: 'LKR', status_code: '2',
      md5sig: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF'
    });
    expect(res.status).toBe(400);
  });

  it('rejects a correct signature but tampered amount', async () => {
    const order = await createOnlineOrder();
    const bogusAmount = (Number(order.total) + 1000).toFixed(2);
    const payload = {
      merchant_id: 'TESTMERCHANT', order_id: order.orderId,
      payhere_amount: bogusAmount, payhere_currency: 'LKR', status_code: '2'
    };
    const res = await request(app).post('/api/payments/payhere/webhook')
      .send({ ...payload, md5sig: payhereSig(payload) });
    expect(res.status).toBe(400);
  });

  it('settles a valid webhook, assigns a gapless invoice, and is idempotent on replay', async () => {
    const orderA = await createOnlineOrder();
    const orderB = await createOnlineOrder();

    const settle = async (order) => {
      const payload = {
        merchant_id: 'TESTMERCHANT', order_id: order.orderId,
        payhere_amount: Number(order.total).toFixed(2), payhere_currency: 'LKR', status_code: '2'
      };
      return request(app).post('/api/payments/payhere/webhook').send({ ...payload, md5sig: payhereSig(payload) });
    };

    expect((await settle(orderA)).status).toBe(200);
    expect((await settle(orderB)).status).toBe(200);

    const a1 = await request(app).get(`/api/public/orders/${orderA.orderId}`);
    const b1 = await request(app).get(`/api/public/orders/${orderB.orderId}`);
    expect(a1.body.status).toBe('paid');
    expect(b1.body.status).toBe('paid');
    expect(a1.body.invoiceNumber).toBeTruthy();
    expect(b1.body.invoiceNumber).toBeTruthy();
    // Gapless + sequential: B settled right after A → consecutive numbers.
    expect(b1.body.invoiceNumber).toBe(a1.body.invoiceNumber + 1);

    // Replay A's webhook — must stay paid with the SAME invoice number (idempotent).
    expect((await settle(orderA)).status).toBe(200);
    const a2 = await request(app).get(`/api/public/orders/${orderA.orderId}`);
    expect(a2.body.status).toBe('paid');
    expect(a2.body.invoiceNumber).toBe(a1.body.invoiceNumber);
  });
});

describe('Driver auth (integration)', () => {
  it('logs in a seeded driver and rejects unauthenticated actions', async () => {
    const login = await request(app).post('/api/driver/auth/login').send({ phone: '0771234567', password: 'driver123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const noAuth = await request(app).post('/api/public/driver/assign').send({ orderId: 'x' });
    expect(noAuth.status).toBe(401);

    const withAuth = await request(app).get('/api/public/driver/orders').set('Authorization', `Bearer ${login.body.token}`);
    expect(withAuth.status).toBe(200);
  });
});

describe('Zod validation on write routes', () => {
  it('rejects an order with no items (400 Validation Error)', async () => {
    const res = await request(app).post('/api/public/orders').send({
      items: [], orderType: 'takeaway', customerName: 'X', customerPhone: '0770000000'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it('rejects an order missing customer contact', async () => {
    const menu = await request(app).get('/api/public/menu');
    const res = await request(app).post('/api/public/orders').send({
      items: [{ menuItemId: menu.body.items[0].id, quantity: 1 }], orderType: 'takeaway'
      // customerName / customerPhone missing
    });
    expect(res.status).toBe(400);
  });

  it('rejects driver login with a missing password', async () => {
    const res = await request(app).post('/api/driver/auth/login').send({ phone: '0771234567' });
    expect(res.status).toBe(400);
  });

  it('rejects driver registration with a too-short password', async () => {
    const res = await request(app).post('/api/public/drivers/register').send({
      name: 'Test Rider', phone: '0712223334', password: '123'
    });
    expect(res.status).toBe(400);
  });
});

describe('SaaS plan limits + usage metering', () => {
  let token;
  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  it('lists available plans publicly', async () => {
    const res = await request(app).get('/api/saas/plans');
    expect(res.status).toBe(200);
    expect(res.body.map(p => p.id)).toEqual(['basic', 'pro', 'enterprise']);
  });

  it('reports the tenant plan + live usage', async () => {
    const res = await request(app).get('/api/saas/usage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.usage.users).toBeGreaterThanOrEqual(3); // seeded admin/manager/cashier…
    expect(res.body.limits).toHaveProperty('maxUsers');
  });

  it('enforces the seat limit after downgrading to basic, then allows again on pro', async () => {
    // Downgrade default_tenant to basic (maxUsers 3); it already has ≥3 seeded users.
    const patch = await request(app).patch('/api/saas/tenants/default_tenant')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'basic' });
    expect(patch.status).toBe(200);
    expect(patch.body.plan).toBe('basic');

    const blocked = await request(app).post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: `seat_${Date.now()}`, role: 'cashier', pin: '9999' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('plan_limit');

    // Restore to pro → creation allowed again (leaves state clean for other tests).
    await request(app).patch('/api/saas/tenants/default_tenant')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    const ok = await request(app).post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: `seat_ok_${Date.now()}`, role: 'cashier', pin: '9999' });
    expect(ok.status).toBe(200);
  });
});
