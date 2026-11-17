import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// An independent database — never test against staging or production data.
process.env.DATABASE_FILE = path.join(os.tmpdir(), `gastroflow_pos_url_auth_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'pos-tenant-url-auth-test-secret';
process.env.CUSTOMER_JWT_SECRET = 'pos-tenant-url-auth-customer-secret';
process.env.PAYHERE_ENABLED = 'false';

const { app, dbReady, dbRun, dbGet } = await import('../server.js');
const tenantA = 'tenant_pos_link_test_a';
const tenantB = 'tenant_pos_link_test_b';
const usernameA = 'pos_url_staff_a';
const usernameB = 'pos_url_staff_b';
const passwordA = 'correct-password-for-a';
const passwordB = 'correct-password-for-b';
let loginA;
let loginB;

beforeAll(async () => {
  await dbReady;
  const hashA = await bcrypt.hash(passwordA, 6);
  const hashB = await bcrypt.hash(passwordB, 6);
  for (const [id, sub, email] of [
    [tenantA, 'pos-link-test-a', 'pos-owner-a@example.test'],
    [tenantB, 'pos-link-test-b', 'pos-owner-b@example.test']
  ]) {
    await dbRun('INSERT INTO tenants(id,name,subdomain,ownerEmail,status) VALUES(?,?,?,?,?)',
      [id, id, sub, email, 'active']);
  }
  await dbRun('INSERT INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',
    ['pos_user_a', usernameA, hashA, 'manager', tenantA]);
  await dbRun('INSERT INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',
    ['pos_user_b', usernameB, hashB, 'manager', tenantB]);
  await dbRun('INSERT INTO menu_items(id,name,price,stock,tenant_id,isAvailable) VALUES(?,?,?,?,?,1)',
    ['pos_resource_a','Private menu A',125,10,tenantA]);
  await dbRun('INSERT INTO menu_items(id,name,price,stock,tenant_id,isAvailable) VALUES(?,?,?,?,?,1)',
    ['pos_resource_b','Private menu B',250,20,tenantB]);
  // Reuse valid sign-ins; the production 5-attempt/IP rate limit is intentional.
  loginA = await login(usernameA, passwordA, 'pos-link-test-a');
  loginB = await login(usernameB, passwordB, tenantB);
}, 30000);

const login = (username, password, expectedTenantId) =>
  request(app).post('/api/auth/login').send({username,password,expectedTenantId});

describe('POS URL restaurant identity isolation', () => {
  it('allows only matching shop credentials (canonical IDs and aliases)', () => {
    expect(loginA.status, loginA.text).toBe(200);
    expect(loginA.body.user.tenant_id).toBe(tenantA);
    expect(loginA.body.token).toBeTruthy();
    expect(loginB.status, loginB.text).toBe(200);
    expect(loginB.body.user.tenant_id).toBe(tenantB);
    expect(loginB.body.token).toBeTruthy();
  });

  it('isolates real authenticated staff and menu API lists for each restaurant',async()=>{
    for(const [login,own,other,ownUsername,otherUsername] of [
      [loginA,'pos_resource_a','pos_resource_b',usernameA,usernameB],
      [loginB,'pos_resource_b','pos_resource_a',usernameB,usernameA]
    ]){
      const headers={Authorization:`Bearer ${login.body.token}`};
      const staff=await request(app).get('/api/users').set(headers);
      expect(staff.status,staff.text).toBe(200);
      expect(staff.body.some(user=>user.username===ownUsername)).toBe(true);
      expect(staff.body.some(user=>user.username===otherUsername)).toBe(false);
      const menu=await request(app).get('/api/menu_items').set(headers);
      expect(menu.status,menu.text).toBe(200);
      expect(menu.body.some(item=>item.id===own)).toBe(true);
      expect(menu.body.some(item=>item.id===other)).toBe(false);
    }
  });

  it('blocks a cross-restaurant menu overwrite before the original record changes',async()=>{
    const original=await dbGet('SELECT name,price,tenant_id FROM menu_items WHERE id=?',['pos_resource_b']);
    const response=await request(app).post('/api/menu_items')
      .set('Authorization',`Bearer ${loginA.body.token}`)
      .send({id:'pos_resource_b',name:'Injected by A',price:0,category:'test'});
    expect(response.status).toBe(404);
    expect(await dbGet('SELECT name,price,tenant_id FROM menu_items WHERE id=?',['pos_resource_b']))
      .toEqual(original);
  });

  it('X-report selects only the requesting restaurant open shift',async()=>{
    const now=Date.now();
    // A deliberately conflicting userId exercises the critical tenant guard:
    // historical/invalid foreign shift records must never become shop A reports.
    await dbRun("INSERT INTO shifts(id,userId,username,startTime,startFloat,status,tenant_id) VALUES(?,?,?,?,?,?,?)",
      ['qa_shift_foreign','pos_user_a','WRONG SHOP',now-20000,999,'open',tenantB]);
    await dbRun("INSERT INTO shifts(id,userId,username,startTime,startFloat,status,tenant_id) VALUES(?,?,?,?,?,?,?)",
      ['qa_shift_own','pos_user_a',usernameA,now-10000,50,'open',tenantA]);
    await dbRun("INSERT INTO orders(id,total,subtotal,status,timestamp,paymentMethod,tenant_id,cashierId) VALUES(?,?,?,?,?,?,?,?)",
      ['qa_financial_order_a',125,125,'paid',now-8000,'cash',tenantA,'pos_user_a']);
    await dbRun("INSERT INTO orders(id,total,subtotal,status,timestamp,paymentMethod,tenant_id) VALUES(?,?,?,?,?,?,?)",
      ['qa_financial_order_b',9999,9999,'paid',now-8000,'cash',tenantB]);
    const result=await request(app).get('/api/reports/x-report')
      .set('Authorization',`Bearer ${loginA.body.token}`);
    expect(result.status,result.text).toBe(200);
    expect(result.body.shiftId).toBe('qa_shift_own');
    expect(result.body.cashier).toBe(usernameA);
    expect(result.body.startFloat).toBe(50);
    expect(result.body.grossSales).toBe(125);
    expect(result.body.totalOrders).toBe(1);
  });

  it('VAT and COGS reports never include another restaurants financial or menu rows',async()=>{
    const headers={Authorization:`Bearer ${loginA.body.token}`};
    const [vat,cogs]=await Promise.all([
      request(app).get('/api/reports/vat').set(headers),
      request(app).get('/api/reports/cogs').set(headers)
    ]);
    expect(vat.status,vat.text).toBe(200);
    expect(vat.body.invoiceCount).toBe(1);
    expect(vat.body.taxableSales).toBe(125);
    expect(cogs.status,cogs.text).toBe(200);
    expect(cogs.body.some(item=>item.id==='pos_resource_a')).toBe(true);
    expect(cogs.body.some(item=>item.id==='pos_resource_b')).toBe(false);
  });

  it('cashier shift and cash movement cannot select an open shift from another restaurant',async()=>{
    const headers={Authorization:`Bearer ${loginA.body.token}`};
    // A and B deliberately have an open shift referencing the same user ID.
    // Only A's own shift may be selected, used or closed.
    const active=await request(app).get('/api/shifts/active').set(headers);
    expect(active.status,active.text).toBe(200);
    expect(active.body.id).toBe('qa_shift_own');
    expect(active.body.tenant_id).toBe(tenantA);

    const duplicateOpen=await request(app).post('/api/shifts/open').set(headers)
      .send({startFloat:0});
    expect(duplicateOpen.status).toBe(400);

    const movement=await request(app).post('/api/cash-movements').set(headers)
      .send({type:'cash_in',amount:10,reason:'Two-tenant integration test'});
    expect(movement.status,movement.text).toBe(200);
    const savedMovement=await dbGet('SELECT shiftId,tenant_id FROM cash_movements WHERE id=?',[movement.body.id]);
    expect(savedMovement).toEqual({shiftId:'qa_shift_own',tenant_id:tenantA});

    const close=await request(app).post('/api/shifts/close').set(headers)
      .send({actualCash:185,notes:'Two-tenant integration test'});
    expect(close.status,close.text).toBe(200);
    expect(close.body.id).toBe('qa_shift_own');
    expect(close.body.tenant_id).toBe(tenantA);
    expect(close.body.expectedCash).toBe(185);
    expect(close.body.status).toBe('closed');
    const foreign=await dbGet('SELECT status,tenant_id,expectedCash FROM shifts WHERE id=?',['qa_shift_foreign']);
    expect(foreign.status).toBe('open');
    expect(foreign.tenant_id).toBe(tenantB);
    expect(foreign.expectedCash).toBeNull();
    const after=await request(app).get('/api/shifts/active').set(headers);
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });

  it('driver COD list and handover cannot access another restaurant receipts', async()=>{
    const headers={Authorization:`Bearer ${loginA.body.token}`};
    for(const [id,tid,driver,amount] of [
      ['qa_cod_a',tenantA,'qa_driver_a',220],
      ['qa_cod_b',tenantB,'qa_driver_b',950]
    ]) await dbRun(
      "INSERT INTO orders(id,tenant_id,driverId,total,status,paymentMethod,timestamp,cashCollected) VALUES(?,?,?,?,?,?,?,0)",
      [id,tid,driver,amount,'delivered','cod',Date.now()]
    );
    const list=await request(app).get('/api/driver/cash-reconciliation').set(headers);
    expect(list.status,list.text).toBe(200);
    expect(list.body.uncollectedOrders.some(x=>x.id==='qa_cod_a')).toBe(true);
    expect(list.body.uncollectedOrders.some(x=>x.id==='qa_cod_b')).toBe(false);

    const foreign=await request(app).post('/api/driver/cash-reconciliation/handover')
      .set(headers).send({driverId:'qa_driver_b',orderIds:['qa_cod_b'],amountHandedOver:950});
    expect(foreign.status).toBe(409);
    expect((await dbGet('SELECT cashCollected FROM orders WHERE id=?',['qa_cod_b'])).cashCollected).toBe(0);

    const incorrect=await request(app).post('/api/driver/cash-reconciliation/handover')
      .set(headers).send({driverId:'qa_driver_a',orderIds:['qa_cod_a'],amountHandedOver:50});
    expect(incorrect.status).toBe(409);
    expect((await dbGet('SELECT cashCollected FROM orders WHERE id=?',['qa_cod_a'])).cashCollected).toBe(0);

    const accepted=await request(app).post('/api/driver/cash-reconciliation/handover')
      .set(headers).send({driverId:'qa_driver_a',orderIds:['qa_cod_a'],amountHandedOver:220});
    expect(accepted.status,accepted.text).toBe(200);
    expect((await dbGet('SELECT cashCollected FROM orders WHERE id=?',['qa_cod_a'])).cashCollected).toBe(1);
    expect((await dbGet('SELECT cashCollected FROM orders WHERE id=?',['qa_cod_b'])).cashCollected).toBe(0);

    const replay=await request(app).post('/api/driver/cash-reconciliation/handover')
      .set(headers).send({driverId:'qa_driver_a',orderIds:['qa_cod_a'],amountHandedOver:220});
    expect(replay.status).toBe(409);
  });

  it('restaurant A cannot transfer a table into or out of restaurant B',async()=>{
    const headers={Authorization:`Bearer ${loginA.body.token}`};
    for(const [id,tid,order] of [
      ['qa_table_a',tenantA,'qa_financial_order_a'],
      ['qa_table_b',tenantB,'qa_financial_order_b'],
      ['qa_table_a_empty',tenantA,null]
    ]) await dbRun(
      "INSERT INTO tables(id,number,status,currentOrderId,tenant_id) VALUES(?,?,?,?,?)",
      [id,id,order?'occupied':'free',order,tid]
    );
    const transfer=await request(app).post('/api/tables/transfer')
      .set(headers).send({fromTableId:'qa_table_a',toTableId:'qa_table_b'});
    expect(transfer.status).toBe(404);
    expect((await dbGet('SELECT currentOrderId FROM tables WHERE id=?',['qa_table_b'])).currentOrderId)
      .toBe('qa_financial_order_b');
    expect((await dbGet('SELECT tableId FROM orders WHERE id=?',['qa_financial_order_b'])).tableId)
      .toBeNull();
    const deleteForeign=await request(app).delete('/api/tables/qa_table_b').set(headers);
    expect(deleteForeign.status).toBe(404);
    expect(await dbGet('SELECT id FROM tables WHERE id=?',['qa_table_b'])).toBeTruthy();
    const saved=await request(app).post('/api/tables')
      .set(headers).send({id:'qa_table_b',number:'injected',capacity:2,status:'free'});
    expect(saved.status).toBe(404);
    expect((await dbGet('SELECT tenant_id FROM tables WHERE id=?',['qa_table_b'])).tenant_id).toBe(tenantB);
  });

  it('staff ETA updates and public ETA capacity stay within the selected restaurant',async()=>{
    const headers={Authorization:`Bearer ${loginA.body.token}`};
    await dbRun('INSERT INTO orders(id,tenant_id,status,timestamp,etaMinutes) VALUES(?,?,?,?,?)',
      ['qa_pending_a',tenantA,'pending',Date.now(),null]);
    await dbRun('INSERT INTO orders(id,tenant_id,status,timestamp,etaMinutes) VALUES(?,?,?,?,?)',
      ['qa_pending_b',tenantB,'pending',Date.now(),null]);

    const wrong=await request(app).post('/api/orders/qa_pending_b/eta')
      .set(headers).send({etaMinutes:90});
    expect(wrong.status).toBe(404);
    expect((await dbGet('SELECT etaMinutes FROM orders WHERE id=?',['qa_pending_b'])).etaMinutes).toBeNull();

    const own=await request(app).post('/api/orders/qa_pending_a/eta')
      .set(headers).send({etaMinutes:25});
    expect(own.status,own.text).toBe(200);
    expect((await dbGet('SELECT etaMinutes FROM orders WHERE id=?',['qa_pending_a'])).etaMinutes).toBe(25);

    const trackingSecret=process.env.CUSTOMER_JWT_SECRET;
    const jwt=(await import('jsonwebtoken')).default;
    const tracking=jwt.sign({type:'order_tracking',orderId:'qa_pending_b',tenantId:tenantB},trackingSecret,{algorithm:'HS256',expiresIn:'7d'});
    const b=await request(app).get('/api/public/orders/qa_pending_b/eta')
      .query({tenantId:tenantB}).set('X-Order-Tracking',tracking);
    expect(b.status,b.text).toBe(200);
    expect(b.body.maxItemPrep).toBe(15);
    expect(b.body.kitchenLoadBuffer).toBe(0); // Only one pending order in tenant B.
    expect(b.body.estimatedMinutes).toBeGreaterThanOrEqual(15);
    const cross=await request(app).get('/api/public/orders/qa_pending_b/eta')
      .query({tenantId:tenantA}).set('X-Order-Tracking',tracking);
    expect(cross.status).toBe(404);
  });

  it('rejects Shop B credentials on Shop A POS URL', async () => {
    const response = await login(usernameB,passwordB,tenantA);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
    expect(response.body.token).toBeUndefined();
  });

  it('rejects Shop A credentials on Shop B POS URL', async () => {
    const response = await login(usernameA,passwordA,tenantB);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
    expect(response.body.token).toBeUndefined();
  });

  it('rejects unknown restaurant selectors despite valid staff credentials', async () => {
    const response = await login(usernameA,passwordA,'tenant_nonexistent_pos_link');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
  });

  it('rejects a saved Shop B session when opened on Shop A URL', async () => {
    const response = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${loginB.body.token}`)
      .set('X-Expected-Tenant-Id', tenantA);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
  });

  it('accepts saved sessions only for their own canonical shop or alias', async () => {
    const response = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${loginA.body.token}`)
      .set('X-Expected-Tenant-Id', 'pos-link-test-a');
    expect(response.status, response.text).toBe(200);
    expect(response.body.user.tenant_id).toBe(tenantA);
  });
});
