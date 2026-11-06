import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `delivery-proof-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'delivery-proof-test-secret';
const { app, dbReady, dbRun, dbGet } = await import('../server.js');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO5cAAAAASUVORK5CYII=';
const driverToken = (id = 'proof_driver', tenant_id = 'default_tenant') => jwt.sign({ driverId: id, role: 'driver', tenant_id }, process.env.JWT_SECRET);
const auth = token => ({ Authorization: `Bearer ${token}` });
const staff = role => auth(jwt.sign({ id: role === 'cashier' ? 'user_cashier' : 'user_admin', role, tenant_id: 'default_tenant' }, process.env.JWT_SECRET));
async function delivery(overrides = {}) {
  const o = { id: crypto.randomUUID(), status: 'out_for_delivery', tenant_id: 'default_tenant', driverId: 'proof_driver', paymentMethod: 'cod', paymentStatus: 'pending', ...overrides };
  await dbRun('INSERT INTO orders (id,status,tenant_id,driverId,paymentMethod,paymentStatus,diningType,total,source,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)', [o.id,o.status,o.tenant_id,o.driverId,o.paymentMethod,o.paymentStatus,'delivery',100,'online',Date.now()]);
  return o;
}
const complete = (o, extra = {}, token = driverToken()) => request(app).post('/api/public/driver/status').set(auth(token)).send({ orderId: o.id, status: 'delivered', signature: png, cashReceived: true, ...extra });

beforeAll(async () => {
  await dbReady;
  await dbRun("INSERT INTO tenants (id,name,subdomain,ownerEmail,status) VALUES ('tenant_B','Other Kitchen','proof-other','owner@example.test','active')");
  for (const [id, tenant] of [['proof_driver', 'default_tenant'], ['other_driver', 'default_tenant'], ['foreign_driver', 'tenant_B']]) {
    await dbRun('INSERT INTO drivers (id,name,phone,status,tenant_id) VALUES (?,?,?,?,?)', [id,id,id,'active',tenant]);
  }
}, 30000);

describe('Delivery evidence and completion', () => {
  it('requires authentication and the assigned tenant-bound driver', async () => {
    const o = await delivery();
    expect((await request(app).post('/api/public/driver/status').send({ orderId: o.id, status: 'delivered' })).status).toBe(401);
    expect((await complete(o, {}, driverToken('other_driver'))).status).toBe(404);
    expect((await complete(o, {}, driverToken('foreign_driver', 'tenant_B'))).status).toBe(404);
    expect((await dbGet('SELECT status FROM orders WHERE id=?', [o.id])).status).toBe('out_for_delivery');
  });
  it('does not complete without evidence or cash confirmation', async () => {
    const o = await delivery();
    expect((await complete(o, { signature: null })).status).toBe(400);
    expect((await complete(o, { cashReceived: false })).status).toBe(400);
    expect((await dbGet('SELECT status,paymentStatus FROM orders WHERE id=?', [o.id]))).toEqual({ status: 'out_for_delivery', paymentStatus: 'pending' });
    expect(await dbGet('SELECT orderId FROM delivery_proofs WHERE orderId=?', [o.id])).toBeUndefined();
  });
  it.each([
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,aGVsbG8=',
    'https://example.test/proof.png',
    'data:image/jpeg;base64,' + 'A'.repeat(710000)
  ])('rejects unsafe or oversized image evidence (%#)', async image => {
    const o = await delivery();
    expect((await complete(o, { signature: image })).status).toBe(400);
    expect((await dbGet('SELECT status FROM orders WHERE id=?', [o.id])).status).toBe('out_for_delivery');
  });
  it('does not accept kitchen, terminal or unverified payment states', async () => {
    for (const status of ['pending', 'preparing', 'ready', 'cancelled', 'rejected']) {
      expect((await complete(await delivery({ status }))).status).toBe(409);
    }
    const o = await delivery({ paymentMethod: 'payhere' });
    expect((await complete(o)).status).toBe(409);
    expect((await request(app).post('/api/public/driver/status').set(auth(driverToken())).send({ orderId: o.id, status: 'preparing' })).status).toBe(400);
  });
  it('commits evidence, COD settlement and invoice exactly once under concurrent retry', async () => {
    const o = await delivery();
    const results = await Promise.all([complete(o), complete(o)]);
    expect(results.map(r => r.status)).toEqual([200,200]);
    expect(results[0].body.proof).toEqual(results[1].body.proof);
    const saved = await dbGet('SELECT * FROM delivery_proofs WHERE orderId=?', [o.id]);
    expect(saved.signature).toBe(png); expect(saved.signatureHash).toHaveLength(64);
    expect(saved.driverId).toBe('proof_driver'); expect(saved.cashReceived).toBe(1);
    const settled = await dbGet('SELECT status,paymentStatus,invoiceNumber FROM orders WHERE id=?', [o.id]);
    expect(settled.status).toBe('delivered'); expect(settled.paymentStatus).toBe('paid'); expect(settled.invoiceNumber).toBeGreaterThan(0);
    const before = await dbGet('SELECT * FROM invoice_counter');
    expect((await complete(o, { signature: null })).body.alreadySaved).toBe(true);
    expect(await dbGet('SELECT * FROM invoice_counter')).toEqual(before);
    expect((await dbGet('SELECT signature FROM delivery_proofs WHERE orderId=?', [o.id])).signature).toBe(png);
  });
  it('does not recollect prepaid cash at delivery', async () => {
    const o = await delivery();
    await dbRun("UPDATE orders SET paymentStatus='paid',invoiceNumber=999999 WHERE id=?", [o.id]);
    const result=await complete(o,{cashReceived:false});
    expect(result.status,result.text).toBe(200);
    expect((await dbGet('SELECT cashReceived FROM delivery_proofs WHERE orderId=?',[o.id])).cashReceived).toBe(0);
    expect((await dbGet('SELECT invoiceNumber FROM orders WHERE id=?',[o.id])).invoiceNumber).toBe(999999);
  });
  it('keeps evidence private and permits assigned driver and restaurant manager review', async () => {
    const o = await delivery(); await complete(o);
    const url = `/api/public/driver/orders/${o.id}/proof`;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set(auth(driverToken('other_driver')))).status).toBe(404);
    expect((await request(app).get(url).set(auth(driverToken('foreign_driver', 'tenant_B')))).status).toBe(404);
    const mine = await request(app).get(url).set(auth(driverToken()));
    expect(mine.body.signature).toBe(png); expect(mine.headers['cache-control']).toContain('no-store');
    expect((await request(app).get(`/api/orders/${o.id}/delivery-proof`).set(staff('owner'))).body.signature).toBe(png);
    expect((await request(app).get(`/api/orders/${o.id}/delivery-proof`).set(staff('cashier'))).status).toBe(403);
    expect(JSON.stringify((await request(app).get(`/api/public/orders/${o.id}`)).body)).not.toContain('base64');
    const history = await request(app).get('/api/public/driver/orders').set(auth(driverToken()));
    expect(history.body.completed.find(row => row.id === o.id).proofSavedAt).toBeGreaterThan(0);
    expect(JSON.stringify(history.body)).not.toContain('base64');
  });
  it('accepts photo-only evidence for a verified prepaid order', async () => {
    const o = await delivery({ paymentMethod: 'payhere', paymentStatus: 'paid' });
    const result = await complete(o, { signature: null, deliveryPhoto: png, cashReceived: false });
    expect(result.status).toBe(200);
    expect((await dbGet('SELECT deliveryPhoto,signature FROM delivery_proofs WHERE orderId=?', [o.id]))).toEqual({ deliveryPhoto: png, signature: null });
  });
  it('rolls back delivery and proof if settlement fails, then supports a safe retry', async () => {
    const o = await delivery();
    await dbRun(`CREATE TRIGGER fail_delivery_settlement BEFORE UPDATE OF paymentStatus ON orders WHEN NEW.id = '${o.id}' BEGIN SELECT RAISE(ABORT, 'simulated settlement failure'); END`);
    try {
      expect((await complete(o)).status).toBe(500);
      expect((await dbGet('SELECT status,paymentStatus FROM orders WHERE id=?', [o.id]))).toEqual({ status: 'out_for_delivery', paymentStatus: 'pending' });
      expect(await dbGet('SELECT orderId FROM delivery_proofs WHERE orderId=?', [o.id])).toBeUndefined();
    } finally { await dbRun('DROP TRIGGER fail_delivery_settlement'); }
    expect((await complete(o)).status).toBe(200);
  });
});
