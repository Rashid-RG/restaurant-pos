import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { testCheckoutProof } from './checkout-proof-fixture.js';

// Real HTTP routes with isolated test database: no production store is modified.
process.env.DATABASE_FILE = path.join(os.tmpdir(), `gastroflow_store_isolation_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'online-store-isolation-staff-test-secret';
process.env.CUSTOMER_JWT_SECRET = 'online-store-isolation-customer-test-secret';
process.env.PAYHERE_ENABLED = 'false';
const { app, dbReady, dbRun, dbGet } = await import('../server.js');

const tenantA = 'tenant_online_test_A';
const tenantB = 'tenant_online_test_B';
let orderAccessA = null;
const token = (owner, tenantId) => jwt.sign({ id: owner, role: 'owner', tenant_id: tenantId }, process.env.JWT_SECRET);
const auth = (owner, tenantId) => ({ Authorization: `Bearer ${token(owner, tenantId)}` });
const storeState = async tenantId => request(app).get('/api/public/menu').query({ tenantId });
const checkout = async (tenantId, menuItemId) => request(app)
  .post('/api/public/orders')
  .set('X-Tenant-Id', tenantId)
  .send({ checkoutProof: await testCheckoutProof(dbRun, tenantId, '0771234567'), items: [{ menuItemId, quantity: 1 }], orderType: 'takeaway', customerName: 'Store Isolation QA', customerPhone: '0771234567', paymentMethod: 'cash' });

beforeAll(async () => {
  await dbReady;
  for (const [tid, suffix] of [[tenantA, 'A'], [tenantB, 'B']]) {
    await dbRun('INSERT INTO tenants(id,name,subdomain,ownerEmail,status) VALUES(?,?,?,?,?)',
      [tid, `QA Online Store ${suffix}`, `qa-online-${suffix.toLowerCase()}`, `qa-${suffix.toLowerCase()}@example.test`, 'active']);
    await dbRun('INSERT INTO users(id,username,role,tenant_id) VALUES(?,?,?,?)',
      [`qa_store_owner_${suffix}`, `qa_store_owner_${suffix}`, 'owner', tid]);
    await dbRun('INSERT INTO menu_items(id,name,price,stock,tenant_id,isAvailable) VALUES(?,?,?,?,?,1)',
      [`qa_store_item_${suffix}`, `Tenant ${suffix} food`, 500, 25, tid]);
  }
}, 30000);

describe('Online storefront SaaS tenant isolation', () => {
  it('new unconfigured stores are not publicly open for orders', async () => {
    const [a,b] = await Promise.all([storeState(tenantA), storeState(tenantB)]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.tenantId).toBe(tenantA); expect(b.body.tenantId).toBe(tenantB);
    expect(a.body.storeOpen).toBe(false); expect(b.body.storeOpen).toBe(false);
    expect(a.body.items.map(item => item.name)).toEqual(['Tenant A food']);
    expect(b.body.items.map(item => item.name)).toEqual(['Tenant B food']);
    const listing = await request(app).get('/api/public/restaurants');
    expect(listing.status).toBe(200);
    expect(listing.body.find(r => r.id === tenantA).isOpen).toBe(false);
    expect(listing.body.find(r => r.id === tenantB).isOpen).toBe(false);
  });

  it('rejects forged expectedTenantId before editing settings', async () => {
    const response = await request(app).post('/api/settings')
      .set(auth('qa_store_owner_A', tenantA))
      .send({key:'storeOpen',value:'true',expectedTenantId:tenantB});
    expect(response.status).toBe(409);
    expect((await storeState(tenantA)).body.storeOpen).toBe(false);
    expect((await storeState(tenantB)).body.storeOpen).toBe(false);
  });

  it('opening A never opens B and public availability agrees with POS state', async () => {
    const response = await request(app).post('/api/settings')
      .set(auth('qa_store_owner_A', tenantA))
      .send({key:'storeOpen',value:'true',expectedTenantId:tenantA});
    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(tenantA);
    expect((await storeState(tenantA)).body.storeOpen).toBe(true);
    expect((await storeState(tenantB)).body.storeOpen).toBe(false);
    const stores = (await request(app).get('/api/public/restaurants')).body;
    expect(stores.find(store => store.id === tenantA).isOpen).toBe(true);
    expect(stores.find(store => store.id === tenantB).isOpen).toBe(false);
  });

  it('honors pickup pauses across discovery, slots and checkout for only the selected restaurant', async () => {
    const toggle = value => request(app).post('/api/settings').set(auth('qa_store_owner_A', tenantA))
      .send({key:'onlinePickupEnabled',value});
    expect((await toggle('false')).status).toBe(200);
    try {
      const listing = (await request(app).get('/api/public/restaurants')).body;
      expect(listing.find(row => row.id === tenantA).pickupEnabled).toBe(false);
      expect(listing.find(row => row.id === tenantB).pickupEnabled).toBe(true);
      const slots = await request(app).get('/api/public/schedule/slots').query({tenantId:tenantA,type:'takeaway'});
      expect(slots.status).toBe(409);
      const order = await checkout(tenantA,'qa_store_item_A');
      expect(order.body.code).toBe('ORDER_MODE_PAUSED');
    } finally { await toggle('true'); }
  });

  it('asks for fresh consent when fees change with unchanged item prices', async () => {
    const result = await request(app).post('/api/public/orders').set('X-Tenant-Id',tenantA).send({
      items:[{menuItemId:'qa_store_item_A',quantity:1}],orderType:'takeaway',customerName:'Test buyer',
      customerPhone:'0771234567',paymentMethod:'cash',expectedSubtotal:500,expectedTotal:1,
      checkoutProof:await testCheckoutProof(dbRun,tenantA,'0771234567')
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('ORDER_TOTAL_CHANGED');
    expect((await dbGet('SELECT COUNT(*) AS count FROM orders WHERE tenant_id=?',[tenantA])).count).toBe(0);
  });

  it('A accepts its own real customer orders while B stays closed', async () => {
    const a = await checkout(tenantA, 'qa_store_item_A');
    expect(a.status, a.text).toBe(201);
    orderAccessA = a.body.trackingToken;
    expect(orderAccessA).toBeTruthy();
    expect((await dbGet('SELECT tenant_id FROM orders WHERE id=?',[a.body.orderId])).tenant_id).toBe(tenantA);
    const b = await checkout(tenantB, 'qa_store_item_B');
    expect(b.status, b.text).toBe(409);
    expect((await dbGet('SELECT COUNT(*) AS count FROM orders WHERE tenant_id=?',[tenantB])).count).toBe(0);
  });

  it('customer receipts name the correct tenant and cannot read another tenant order', async () => {
    const row = await dbGet('SELECT id FROM orders WHERE tenant_id=? ORDER BY timestamp DESC LIMIT 1', [tenantA]);
    expect(row?.id).toBeTruthy();
    const own = await request(app).get('/api/public/orders/' + encodeURIComponent(row.id))
      .query({tenantId: tenantA}).set('X-Order-Tracking', orderAccessA);
    expect(own.status, own.text).toBe(200);
    expect(own.body.tenantId).toBe(tenantA);
    expect(own.body.storeName).toBe('QA Online Store A');
    expect(own.body.items[0].name).toBe('Tenant A food');
    const other = await request(app).get('/api/public/orders/' + encodeURIComponent(row.id))
      .query({tenantId: tenantB}).set('X-Order-Tracking', orderAccessA);
    expect(other.status).toBe(404);
    expect(other.body.items).toBeUndefined();
  });

  it('fails closed on forged menu items and missing tenant IDs', async () => {
    expect((await checkout(tenantA, 'qa_store_item_B')).status).toBeGreaterThanOrEqual(400);
    const unknown = await storeState('tenant_unknown_online_store');
    expect(unknown.status).toBe(404);
  });

  it('does not calculate delivery based on another restaurant location', async () => {
    const fee = await request(app).get('/api/public/delivery-fee')
      .query({tenantId:tenantA,lat:6.9271,lng:79.8612,subtotal:500});
    expect(fee.status).toBe(422);
    expect(fee.body.code).toBe('STORE_DELIVERY_LOCATION_MISSING');
    const delivery = await request(app).post('/api/public/orders').set('X-Tenant-Id',tenantA)
      .send({items:[{menuItemId:'qa_store_item_A',quantity:1}],orderType:'delivery',customerName:'QA Customer',customerPhone:'0771234567',deliveryAddress:'12 Main Street, Colombo, Sri Lanka',deliveryLat:6.9271,deliveryLng:79.8612,paymentMethod:'cash'});
    expect(delivery.status).toBe(422);
  });

  it('keeps simultaneous customer checkout, stock and private receipt access isolated across two open stores', async () => {
    const opened=await request(app).post('/api/settings')
      .set(auth('qa_store_owner_B',tenantB))
      .send({key:'storeOpen',value:'true',expectedTenantId:tenantB});
    expect(opened.status,opened.text).toBe(200);
    try {
      const before=await Promise.all([tenantA,tenantB].map(async tid=>({
        tenant:tid,
        orders:(await dbGet('SELECT COUNT(*) AS n FROM orders WHERE tenant_id=?',[tid])).n,
        stock:(await dbGet('SELECT stock FROM menu_items WHERE id=? AND tenant_id=?',[tid===tenantA?'qa_store_item_A':'qa_store_item_B',tid])).stock
      })));
      const attempts=[
        ...Array.from({length:3},()=>checkout(tenantA,'qa_store_item_A')),
        ...Array.from({length:3},()=>checkout(tenantB,'qa_store_item_B'))
      ];
      const responses=await Promise.all(attempts);
      for(const response of responses)expect(response.status,response.text).toBe(201);
      const ids=responses.map(x=>x.body.orderId);
      expect(new Set(ids).size).toBe(6);
      for(let i=0;i<responses.length;i++){
        const tid=i<3?tenantA:tenantB;
        const other=i<3?tenantB:tenantA;
        const {orderId,trackingToken}=responses[i].body;
        expect((await dbGet('SELECT tenant_id FROM orders WHERE id=?',[orderId])).tenant_id).toBe(tid);
        const own=await request(app).get('/api/public/orders/'+encodeURIComponent(orderId))
          .query({tenantId:tid}).set('X-Order-Tracking',trackingToken);
        expect(own.status,own.text).toBe(200);
        expect(own.body.tenantId).toBe(tid);
        const foreign=await request(app).get('/api/public/orders/'+encodeURIComponent(orderId))
          .query({tenantId:other}).set('X-Order-Tracking',trackingToken);
        expect(foreign.status).toBe(404);
      }
      for(const b of before){
        expect((await dbGet('SELECT COUNT(*) AS n FROM orders WHERE tenant_id=?',[b.tenant])).n).toBe(b.orders+3);
        expect((await dbGet('SELECT stock FROM menu_items WHERE id=? AND tenant_id=?',
          [b.tenant===tenantA?'qa_store_item_A':'qa_store_item_B',b.tenant])).stock).toBe(b.stock-3);
      }
    }finally{
      const closed=await request(app).post('/api/settings')
        .set(auth('qa_store_owner_B',tenantB))
        .send({key:'storeOpen',value:'false',expectedTenantId:tenantB});
      expect(closed.status,closed.text).toBe(200);
    }
  });

  it('closing A again is immediately consistent across the directory and menu', async () => {
    const response = await request(app).post('/api/settings')
      .set(auth('qa_store_owner_A', tenantA))
      .send({key:'storeOpen',value:'false',expectedTenantId:tenantA});
    expect(response.status).toBe(200);
    const [menuA, menuB, listing] = await Promise.all([
      storeState(tenantA),storeState(tenantB),request(app).get('/api/public/restaurants')
    ]);
    expect(menuA.body.storeOpen).toBe(false); expect(menuB.body.storeOpen).toBe(false);
    expect(listing.body.find(store=>store.id===tenantA).isOpen).toBe(false);
    expect((await checkout(tenantA,'qa_store_item_A')).status).toBe(409);
  });
});
