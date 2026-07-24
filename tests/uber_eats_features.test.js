import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';

const TMP_DB = path.join(os.tmpdir(), `gastroflow_ue_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.JWT_SECRET = 'test_jwt_secret_uber_eats';
process.env.PAYHERE_MERCHANT_SECRET = 'test_merchant_secret';
process.env.PAYHERE_MERCHANT_ID = 'TESTMERCHANT';

const { app, dbReady, dbGet, dbRun, calculateOrderETA } = await import('../server.js');
const request = (await import('supertest')).default;

describe('Uber Eats-Grade Features Integration Tests', () => {
  const testOrderId = `test_ord_ue_${Date.now()}`;
  let testDriverId = 'drv_01';

  beforeAll(async () => {
    await dbReady;

    // Fetch a seeded driver from DB
    const driverRow = await dbGet('SELECT * FROM drivers LIMIT 1');
    if (driverRow) testDriverId = driverRow.id;

    // Insert order into DB directly so foreign key constraints on orderId are satisfied
    await dbRun(
      `INSERT OR REPLACE INTO orders 
       (id, tenant_id, customerName, customerPhone, diningType, total, status, timestamp) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [testOrderId, 'default_tenant', 'Uber Eats Tester', '+94760130922', 'delivery', 1500, 'pending', Date.now()]
    );
  }, 30000);

  it('calculates dynamic delivery ETA correctly', async () => {
    const etaData = await calculateOrderETA(testOrderId, 'default_tenant');
    expect(etaData).toBeDefined();
    expect(etaData.estimatedMinutes).toBeGreaterThanOrEqual(15);
    expect(etaData.estimatedDeliveryTime).toBeGreaterThan(Date.now());

    const res = await request(app).get(`/api/public/orders/${testOrderId}/eta`);
    expect(res.status).toBe(200);
    expect(res.body.estimatedMinutes).toBeGreaterThanOrEqual(15);
  });

  it('provides smart cart recommendation upsells', async () => {
    const res = await request(app).get('/api/public/cart-upsell');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('assigns multi-order delivery batch to driver and retrieves active batch', async () => {
    const assignRes = await request(app)
      .post('/api/public/driver/assign-batch')
      .send({ driverId: testDriverId, orderIds: [testOrderId] });
    
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.success).toBe(true);

    const batchRes = await request(app).get(`/api/driver/active-batch?driverId=${testDriverId}`);
    expect(batchRes.status).toBe(200);
    expect(batchRes.body.orders.length).toBeGreaterThanOrEqual(1);
    expect(batchRes.body.orders[0].id).toBe(testOrderId);
  });

  it('sends and retrieves live in-app driver-customer chat messages', async () => {
    // Send customer message
    const sendRes = await request(app)
      .post(`/api/orders/${testOrderId}/driver-chat`)
      .send({
        senderType: 'customer',
        senderName: 'Uber Eats Tester',
        message: 'Please leave the food at the front door.'
      });

    expect(sendRes.status).toBe(201);
    expect(sendRes.body.success).toBe(true);

    // Retrieve chat messages
    const getRes = await request(app).get(`/api/orders/${testOrderId}/driver-chat`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.length).toBeGreaterThanOrEqual(1);
    expect(getRes.body[0].message).toBe('Please leave the food at the front door.');
  });
});
