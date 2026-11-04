import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
process.env.DATABASE_FILE = path.join(os.tmpdir(), `platform_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'platform-integration-test-secret';
const { app,dbReady,dbRun,dbGet } = await import('../server.js');
const token = (id,tenant_id='default_tenant',extra={}) => jwt.sign({id,tenant_id,role:'owner',...extra},process.env.JWT_SECRET);
const auth = value => ({Authorization:`Bearer ${value}`});
const owner = () => auth(token('user_admin'));
const details = {name:'Independent Kitchen',subdomain:'independent-kitchen',ownerEmail:'owner@example.test',ownerPassword:'TestOwnerPassword!34892',plan:'basic'};
let restaurant;
let restaurantAuth;
beforeAll(async () => {
  await dbReady;
  await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('other-default-owner','other-owner','owner','default_tenant')");
},30000);
describe('One platform owner, independent restaurant owners', () => {
  it('identifies exactly the bootstrapped platform owner in fresh session metadata', async () => {
    expect((await request(app).get('/api/auth/me').set(owner())).body.user.isPlatformAdmin).toBe(true);
    expect((await request(app).get('/api/auth/me').set(auth(token('other-default-owner')))).body.user.isPlatformAdmin).toBe(false);
  });
  it('does not infer platform rights from default restaurant ownership or forged capability claims', async () => {
    const forged = auth(token('other-default-owner','default_tenant',{isPlatformAdmin:true}));
    for (const endpoint of ['/api/saas/tenants','/api/db/inspect','/api/marketplace/partner-earnings']) expect((await request(app).get(endpoint).set(forged)).status).toBe(403);
  });
  it('rejects unauthenticated platform requests', async () => expect((await request(app).get('/api/saas/tenants')).status).toBe(401));
  it('creates a separate owner, hashed credentials and a closed empty storefront', async () => {
    const response = await request(app).post('/api/saas/tenants').set(owner()).send(details);
    expect(response.status,response.text).toBe(201); restaurant=response.body.tenant;
    const user = await dbGet('SELECT * FROM users WHERE tenant_id = ?',[restaurant.id]);
    expect(user.role).toBe('owner');expect(user.pin).toMatch(/^\$2/);expect(user.passwordHash).not.toBe(details.ownerPassword);
    restaurantAuth = auth(token(user.id,restaurant.id));
    expect((await dbGet("SELECT value FROM settings WHERE tenant_id=? AND key='storeOpen'",[restaurant.id])).value).toBe('false');
    expect((await dbGet('SELECT COUNT(*) AS count FROM menu_items WHERE tenant_id=?',[restaurant.id])).count).toBe(0);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('never returns provisioned passwords in later restaurant lists', async () => {
    const response = await request(app).get('/api/saas/tenants').set(owner());
    expect(response.status).toBe(200);expect(response.body.some(row=>row.id===restaurant.id)).toBe(true);
    expect(response.text).not.toContain(details.ownerPassword);expect(response.text).not.toContain('temporaryPassword');
  });
  it('allows restaurant owner sign-in without granting platform authority', async () => {
    const response = await request(app).post('/api/auth/login').send({username:restaurant.staffUsername,password:details.ownerPassword});
    expect(response.status).toBe(200);expect(response.body.user.isPlatformAdmin).toBe(false);
    expect((await request(app).get('/api/saas/tenants').set(restaurantAuth)).status).toBe(403);
    expect((await request(app).patch('/api/saas/tenants/default_tenant').set(restaurantAuth).send({status:'suspended'})).status).toBe(403);
  });
  it('does not allow claiming the platform through provisioning fields', async () => {
    expect((await request(app).post('/api/saas/tenants').set(owner()).send({...details,subdomain:'claim-platform',isPlatformAdmin:true})).status).toBe(400);
  });
  it('rejects duplicate restaurant creation atomically', async () => {
    expect((await request(app).post('/api/saas/tenants').set(owner()).send(details)).status).toBe(409);
    expect((await dbGet('SELECT COUNT(*) AS count FROM tenants WHERE subdomain=?',[details.subdomain])).count).toBe(1);
  });
  it('suspends restaurant owners on both new login and existing JWT requests', async () => {
    expect((await request(app).patch(`/api/saas/tenants/${restaurant.id}`).set(owner()).send({status:'suspended'})).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({username:restaurant.staffUsername,password:details.ownerPassword})).status).toBe(403);
    expect((await request(app).get('/api/settings').set(restaurantAuth)).status).toBe(403);
    expect((await request(app).patch(`/api/saas/tenants/${restaurant.id}/status`).set(owner()).send({status:'active'})).status).toBe(200);
    expect((await request(app).get('/api/settings').set(restaurantAuth)).status).toBe(200);
  });
  it('keeps restaurant order and staff timeclock data separate even with spoofed tenant headers', async () => {
    await dbRun("INSERT INTO orders (id,total,status,tenant_id) VALUES ('platform-private-order',900,'pending','default_tenant')");
    await dbRun("INSERT INTO timeclock_entries (id,userId,username,clockIn) VALUES ('platform-private-clock','user_admin','admin',1)");
    const orders=await request(app).get('/api/orders').set(restaurantAuth).set('X-Tenant-ID','default_tenant');
    expect(orders.status).toBe(200);expect(orders.text).not.toContain('platform-private-order');
    const entries=await request(app).get('/api/timeclock/entries').set(restaurantAuth);
    expect(entries.status).toBe(200);expect(entries.text).not.toContain('platform-private-clock');
  });
  it('protects the platform workspace and retains restaurant records when deletion is requested', async () => {
    expect((await request(app).patch('/api/saas/tenants/default_tenant').set(owner()).send({status:'suspended'})).status).toBe(400);
    expect((await request(app).delete(`/api/saas/tenants/${restaurant.id}`).set(owner())).status).toBe(409);
    expect(await dbGet('SELECT id FROM tenants WHERE id=?',[restaurant.id])).toBeTruthy();
  });
  it('does not let a restaurant owner read cross-restaurant commission reports', async () => expect((await request(app).get('/api/marketplace/partner-earnings').set(restaurantAuth)).status).toBe(403));
});

it('isolates supplier contacts and rejects cross-restaurant stock and ingredient changes', async () => {
  await dbRun("INSERT INTO suppliers (id,name,email,tenant_id) VALUES ('private-supplier','Private Supplier','private@example.test','default_tenant')");
  await dbRun("INSERT INTO menu_items (id,name,stock,tenant_id) VALUES ('private-stock','Private Stock',20,'default_tenant')");
  await dbRun("INSERT INTO ingredients (id,name,unit,costPerUnit,stock,tenant_id) VALUES ('private-ingredient','Private Ingredient','kg',5,10,'default_tenant')");
  expect((await request(app).get('/api/inventory/suppliers').set(restaurantAuth)).text).not.toContain('private@example.test');
  expect((await request(app).post('/api/inventory/waste').set(restaurantAuth).send({menuItemId:'private-stock',quantity:3})).status).toBe(404);
  expect((await request(app).post('/api/ingredients').set(restaurantAuth).send({id:'private-ingredient',name:'Tampered',stock:0})).status).toBe(404);
  expect((await dbGet("SELECT stock FROM menu_items WHERE id='private-stock'")).stock).toBe(20);
});

it('revokes existing driver sessions when their restaurant is suspended', async () => {
  await dbRun('INSERT INTO drivers (id,name,phone,status,tenant_id) VALUES (?,?,?,?,?)',['partner-driver','Partner Driver','0779000001','active',restaurant.id]);
  const driverToken = jwt.sign({driverId:'partner-driver',role:'driver',tenant_id:restaurant.id},process.env.JWT_SECRET);
  await request(app).patch(`/api/saas/tenants/${restaurant.id}`).set(owner()).send({status:'suspended'});
  expect((await request(app).post('/api/public/driver/status').set(auth(driverToken)).send({orderId:'anything',status:'delivered'})).status).toBe(403);
  await request(app).patch(`/api/saas/tenants/${restaurant.id}`).set(owner()).send({status:'active'});
});
it('rejects recipes that reference another restaurant ingredient', async () => {
  await dbRun('INSERT INTO menu_items (id,name,tenant_id) VALUES (?,?,?)',['partner-menu','Partner Dish',restaurant.id]);
  expect((await request(app).post('/api/recipes').set(restaurantAuth).send({menuItemId:'partner-menu',ingredients:[{ingredientId:'private-ingredient',quantityRequired:1}]})).status).toBe(404);
  expect((await dbGet('SELECT COUNT(*) AS count FROM recipes WHERE menuItemId=?',['partner-menu'])).count).toBe(0);
});
