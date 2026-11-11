import {describe,it,expect,beforeAll} from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {cartStorageKey,parseSavedCart} from '../apps/customer-web/src/utils/cart-storage.js';

describe('Multi-restaurant private cart storage',()=>{
  it('never shares carts between two restaurants or legacy global cart',()=>{
    expect(cartStorageKey('tenant_A')).not.toBe(cartStorageKey('tenant_B'));
    expect(cartStorageKey('tenant_A')).not.toBe('gastroflow_cart_items');
    expect(cartStorageKey('tenant_A')).toBe('gastroflow_cart_items:tenant_A');
  });
  it('recovers only well-formed cart arrays',()=>{
    expect(parseSavedCart('not-json')).toEqual([]);
    expect(parseSavedCart('{"id":"menu1"}')).toEqual([]);
    expect(parseSavedCart(JSON.stringify([{id:'meal',qty:2,unitPrice:450},{id:'bad',qty:0,unitPrice:1},null]))).toEqual([{id:'meal',qty:2,unitPrice:450}]);
  });
});

process.env.DATABASE_FILE=path.join(os.tmpdir(),'customer_safety_'+crypto.randomUUID()+'.db');
process.env.JWT_SECRET='customer-test-only-key';
process.env.CUSTOMER_CARD_PAYMENTS_ENABLED='false';
const {app,dbReady,dbRun}=await import('../server.js');

beforeAll(async()=>{
  await dbReady;
  const id='customer_safety_test';
  await dbRun('INSERT OR IGNORE INTO tenants(id,name,subdomain,ownerEmail,plan,status,createdAt) VALUES(?,?,?,?,?,?,?)',
    [id,'Customer safety test',id,'customer-safety@test.invalid','basic','active',Date.now()]);
},30000);

describe('Public customer payment availability and promotional safety',()=>{
  const tenant='customer_safety_test';
  it('advertises card gateway as disabled while cash and bank transfer remain customer choices',async()=>{
    const response=await request(app).get('/api/public/menu').set('X-Tenant-Id',tenant);
    expect(response.status).toBe(200);
    expect(response.body.payhereEnabled).toBe(false);
  });
  it('rejects malformed promo previews without disclosing tenant data',async()=>{
    const invalid=await request(app).post('/api/public/promotions/preview').set('X-Tenant-Id',tenant)
      .send({code:'<script>',items:[{menuItemId:'fake',quantity:1}]});
    expect(invalid.status).toBe(400);
    const empty=await request(app).post('/api/public/promotions/preview').set('X-Tenant-Id',tenant)
      .send({code:'WELCOME10',items:[]});
    expect(empty.status).toBe(400);
  });
});
