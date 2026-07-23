/**
 * tests/enterprise_features.test.js
 *
 * Test suite verifying the 5 commercial enterprise modules:
 * 1. ESC/POS receipt generation
 * 2. PickMe & UberEats aggregator webhook normalization & order ingestion
 * 3. Bulk offline order queue sync & deduplication
 * 4. Automated low-stock purchase order alerts
 * 5. Table QR code URL generation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import { buildEscPosReceipt } from '../lib/printer.js';
import { normalizePickMeOrder, normalizeUberEatsOrder } from '../lib/aggregators.js';

const TMP_DB = path.join(os.tmpdir(), `gastroflow_ent_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.JWT_SECRET = 'test_jwt_secret_enterprise';

const { app, dbReady } = await import('../server.js');
const request = (await import('supertest')).default;

beforeAll(async () => {
  await dbReady;
}, 30000);

describe('ESC/POS Thermal Printing Engine', () => {
  it('generates a binary ESC/POS thermal receipt buffer containing restaurant details', () => {
    const buffer = buildEscPosReceipt({
      restaurantName: 'GastroFlow Bistro',
      orderId: 'ord_1001',
      invoiceNumber: 1,
      items: [{ menuItemId: 'm1', name: 'Kottu Roti', price: 1200, quantity: 2 }],
      subtotal: 2400,
      total: 2400,
      paperWidth: 80
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(50);
    const text = buffer.toString('binary');
    expect(text).toContain('GASTROFLOW BISTRO');
    expect(text).toContain('Kottu Roti');
    expect(text).toContain('2400.00');
  });
});

describe('Aggregator Webhook Integration (PickMe & UberEats)', () => {
  it('normalizes PickMe order payload correctly', () => {
    const rawPickMe = {
      order_id: 'PM9988',
      customer: { name: 'Sunil Perera', phone: '0771112223' },
      items: [{ item_id: 'i1', name: 'Chicken Kottu', unit_price: 1500, quantity: 1 }],
      pricing: { subtotal: 1500, delivery_fee: 250, total: 1750 },
      delivery_info: { address: 'Colpetty, Colombo' }
    };

    const normalized = normalizePickMeOrder(rawPickMe, 'tenant_test');
    expect(normalized.orderId).toBe('pickme_PM9988');
    expect(normalized.source).toBe('pickme');
    expect(normalized.total).toBe(1750);
    expect(normalized.customerName).toBe('Sunil Perera');
  });

  it('ingests a PickMe webhook into GastroFlow orders and prevents duplicate replays', async () => {
    const menu = await request(app).get('/api/public/menu');
    const item = menu.body.items[0];

    const rawPickMe = {
      order_id: `PM_${Date.now()}`,
      customer: { name: 'Nimal Jay', phone: '0773334445' },
      items: [{ item_id: item.id, name: item.name, unit_price: item.price, quantity: 2 }],
      pricing: { subtotal: item.price * 2, delivery_fee: 200, total: (item.price * 2) + 200 }
    };

    const res1 = await request(app)
      .post('/api/public/webhooks/aggregators/pickme')
      .send(rawPickMe);
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.orderId).toBe(`pickme_${rawPickMe.order_id}`);

    // Replay duplicate webhook
    const res2 = await request(app)
      .post('/api/public/webhooks/aggregators/pickme')
      .send(rawPickMe);
    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBe(true);
  });
});

describe('Offline Sales Bulk Sync & Deduplication', () => {
  let token;
  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  it('ingests bulk offline sales and skips duplicates', async () => {
    const offlineId = `off_${Date.now()}`;
    const payload = {
      orders: [
        { offlineId, orderType: 'dine_in', total: 1800, paymentMethod: 'cash', createdAt: Date.now() }
      ]
    };

    const sync1 = await request(app)
      .post('/api/orders/offline-sync')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(sync1.status).toBe(200);
    expect(sync1.body.syncedCount).toBe(1);

    // Syncing same queue again skips duplicates
    const sync2 = await request(app)
      .post('/api/orders/offline-sync')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(sync2.status).toBe(200);
    expect(sync2.body.syncedCount).toBe(0);
  });
});

describe('Table QR Code Generator & Low-Stock Alerts', () => {
  let token;
  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  it('resolves table QR code URL', async () => {
    const res = await request(app).get('/api/tables/table1/qr?tenant=default_tenant');
    expect(res.status).toBe(200);
    expect(res.body.qrUrl).toContain('table=1');
  });

  it('queries purchase orders for low-stock ingredients', async () => {
    const res = await request(app)
      .get('/api/inventory/purchase-orders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.lowStockIngredients)).toBe(true);
  });
});
