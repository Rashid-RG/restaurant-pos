import {beforeAll,it,expect} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { testCheckoutProof } from './checkout-proof-fixture.js';
process.env.DATABASE_FILE=path.join(os.tmpdir(),`order-safety-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='safety-staff-test';process.env.CUSTOMER_JWT_SECRET='safety-customer-test';
const {app,dbReady,dbRun,dbGet}=await import('../server.js');
const staff=(tenant='safe_A',id=tenant+'_owner')=>({Authorization:'Bearer '+jwt.sign({id,role:'owner',tenant_id:tenant},process.env.JWT_SECRET)});
const customer=id=>({Authorization:'Bearer '+jwt.sign({id,type:'customer',sessionVersion:crypto.createHmac('sha256',process.env.CUSTOMER_JWT_SECRET).update('fixture').digest('hex').slice(0,24)},process.env.CUSTOMER_JWT_SECRET)});
const driver=(id='safe_driver',tenant='safe_A')=>({Authorization:'Bearer '+jwt.sign({driverId:id,role:'driver',name:'Forged Name',tenant_id:tenant},process.env.JWT_SECRET)});
const stock=()=>dbGet("SELECT stock FROM menu_items WHERE id='safe_item'");
const ingredient=()=>dbGet("SELECT stock FROM ingredients WHERE id='safe_ingredient'");
const publicOrder=async()=>request(app).post('/api/public/orders?tenant=safe_A').send({checkoutProof:await testCheckoutProof(dbRun,'safe_A','0770000000'),customerName:'Safety Customer',customerPhone:'0770000000',orderType:'takeaway',paymentMethod:'cash',items:[{id:'safe_item',quantity:2}]});
const ticket=async()=>{const id=crypto.randomUUID();const response=await request(app).post('/api/orders').set(staff()).send({id,diningType:'takeaway',items:[{id:'safe_item',quantity:2}]});expect(response.status,response.text).toBe(200);return id;};
beforeAll(async()=>{
 await dbReady;
 for(const tenant of ['safe_A','safe_B']){
  await dbRun('INSERT INTO tenants (id,name,subdomain,status,plan,ownerEmail) VALUES (?,?,?,?,?,?)',[tenant,tenant,tenant,'active','basic','owner@example.test']);
  await dbRun('INSERT INTO users (id,username,role,tenant_id) VALUES (?,?,?,?)',[tenant+'_owner',tenant+'_owner','owner',tenant]);
  for(const key of ['taxRate','serviceChargeRate'])await dbRun('INSERT INTO settings (key,value,tenant_id) VALUES (?,0,?)',[key,tenant]);
  await dbRun("INSERT INTO settings (key,value,tenant_id) VALUES ('storeOpen','true',?)",[tenant]);
 }
 await dbRun("INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('safe_item','Safe Item',100,1000,'safe_A',1),('foreign_item','Other Item',100,1000,'safe_B',1)");
 await dbRun("INSERT INTO ingredients (id,name,stock,unit,costPerUnit,tenant_id) VALUES ('safe_ingredient','Rice',1000,'kg',10,'safe_A'),('foreign_ingredient','Rice',1000,'kg',10,'safe_B')");
 await dbRun("INSERT INTO recipes (id,menuItemId,ingredientId,quantityRequired,tenant_id) VALUES ('safe_recipe','safe_item','safe_ingredient',0.5,'safe_A')");
 for(const id of ['safe_customer','other_customer'])await dbRun('INSERT INTO customer_accounts (id,name,email,phone,tenant_id,passwordHash) VALUES (?,?,?,?,?,?)',[id,id,id+'@test.invalid','0770000000','safe_A','fixture']);
 await dbRun("INSERT INTO drivers (id,name,phone,status,tenant_id) VALUES ('safe_driver','Verified Driver','0770000001','available','safe_A'),('foreign_driver','Other Driver','0770000002','available','safe_B')");
},30000);
it('reserves both menu and recipe stock and reverses the saved recipe once across concurrent cancellation',async()=>{
 const before=await stock(),raw=await ingredient(),created=await publicOrder();expect(created.status,created.text).toBe(201);
 expect((await stock()).stock).toBe(before.stock-2);expect((await ingredient()).stock).toBe(raw.stock-1);
 const endpoint=`/api/public/orders/${created.body.orderId}/cancel?tenant=safe_A`;
 expect((await request(app).post(endpoint)).status).toBe(401);
 expect((await request(app).post(endpoint.replace('safe_A','safe_B')).set('X-Order-Tracking',created.body.trackingToken)).status).toBe(404);
 await dbRun("UPDATE recipes SET quantityRequired=5 WHERE id='safe_recipe'");
 const cancel=()=>request(app).post(endpoint).set('X-Order-Tracking',created.body.trackingToken);
 expect((await Promise.all([cancel(),cancel()])).map(r=>r.status)).toEqual([200,200]);
 expect(await stock()).toEqual(before);expect(await ingredient()).toEqual(raw);
 await dbRun("UPDATE recipes SET quantityRequired=0.5 WHERE id='safe_recipe'");
});
it('rolls back an entire order if recipe ingredients run out',async()=>{
 const before=await stock();await dbRun("UPDATE ingredients SET stock=0 WHERE id='safe_ingredient'");const result=await publicOrder();expect(result.status).toBe(500);expect(await stock()).toEqual(before);
 await dbRun("UPDATE ingredients SET stock=1000 WHERE id='safe_ingredient'");
});
it('reconciles stock across counter edits and rejects without manufacturing ingredients',async()=>{
 const before=await stock(),raw=await ingredient(),id=await ticket();
 const edit=await request(app).put(`/api/orders/${id}/modify`).set(staff()).send({items:[{id:'safe_item',quantity:3}]});expect(edit.status,edit.text).toBe(200);
 expect((await stock()).stock).toBe(before.stock-3);expect((await ingredient()).stock).toBe(raw.stock-1.5);
 const reject=()=>request(app).post(`/api/orders/${id}/reject`).set(staff()).send({reason:'Test cancellation'});expect((await Promise.all([reject(),reject()])).map(r=>r.status)).toEqual([200,200]);expect(await stock()).toEqual(before);expect(await ingredient()).toEqual(raw);
});
it('retains legacy orders for reconciliation instead of inventing recipe reservations',async()=>{
 await dbRun("INSERT INTO orders (id,status,tenant_id) VALUES ('legacy-safe','pending','safe_A')");
 expect((await request(app).post('/api/orders/legacy-safe/reject').set(staff()).send({reason:'Cannot determine prior stock'})).status).toBe(500);
 expect((await dbGet("SELECT status FROM orders WHERE id='legacy-safe'")).status).toBe('pending');
});
it('requires private order ownership for feedback and validates rating bounds',async()=>{
 const created=await publicOrder(),body={orderId:created.body.orderId,rating:5,comment:'Good'};
 expect((await request(app).post('/api/public/feedback?tenant=safe_A').send(body)).status).toBe(401);
 expect((await request(app).post('/api/public/feedback?tenant=safe_A').set('X-Order-Tracking',created.body.trackingToken).send({...body,rating:6})).status).toBe(400);
 expect((await request(app).post('/api/public/feedback?tenant=safe_A').set('X-Order-Tracking',created.body.trackingToken).send(body)).status).toBe(200);
});
it('binds dispatch to the restaurant and preserves kitchen state',async()=>{
 const id=await ticket();
 expect((await request(app).post('/api/delivery/assign').send({orderId:id,driverId:'safe_driver'})).status).toBe(401);
 expect((await request(app).post('/api/delivery/assign').set(staff()).send({orderId:id,driverId:'foreign_driver'})).status).toBe(404);
 expect((await request(app).post('/api/delivery/assign').set(staff()).send({orderId:id,driverId:'safe_driver'})).status).toBe(200);
 expect((await dbGet('SELECT status FROM orders WHERE id=?',[id])).status).toBe('pending');
 await dbRun('UPDATE orders SET customerAccountId=? WHERE id=?',['safe_customer',id]);
 const endpoint=`/api/orders/${id}/driver-chat`;
 expect((await request(app).get(endpoint).set(staff('safe_B'))).status).toBe(404);
 expect((await request(app).get(endpoint).set(customer('other_customer'))).status).toBe(404);
 expect((await request(app).get(endpoint).set(customer('safe_customer'))).status).toBe(200);
 const reply=await request(app).post(endpoint).set(driver()).send({message:'Arriving soon',senderType:'staff',senderName:'Forged'});expect(reply.status,reply.text).toBe(201);
 expect((await dbGet('SELECT senderType,senderName FROM driver_customer_chats WHERE id=?',[reply.body.messageId]))).toEqual({senderType:'driver',senderName:'Verified Driver'});
 await dbRun("UPDATE drivers SET status='suspended' WHERE id='safe_driver'");expect((await request(app).get(endpoint).set(driver())).status).toBe(403);
 await dbRun("UPDATE drivers SET status='available' WHERE id='safe_driver'");
});
it('rejects deleted customer and staff credentials in private order chat',async()=>{
 const id=await ticket();await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('removed_staff','removed_staff','owner','safe_A')");
 const endpoint=`/api/orders/${id}/driver-chat`;expect((await request(app).get(endpoint).set(staff('safe_A','removed_staff'))).status).toBe(200);
 await dbRun("DELETE FROM users WHERE id='removed_staff'");expect((await request(app).get(endpoint).set(staff('safe_A','removed_staff'))).status).toBe(403);
 await dbRun("UPDATE orders SET customerAccountId='other_customer' WHERE id=?",[id]);await dbRun("DELETE FROM customer_accounts WHERE id='other_customer'");expect((await request(app).get(endpoint).set(customer('other_customer'))).status).toBe(403);
});
it('uses private hosts and tenant-bound invitations and claims group checkout once',async()=>{
 expect((await request(app).get('/api/public/group-cart/arbitrary?tenant=safe_A')).status).toBe(404);
 const created=await request(app).post('/api/public/group-cart?tenant=safe_A').send({});expect(created.status,created.text).toBe(201);const {id,hostToken}=created.body;
 expect((await request(app).get(`/api/public/group-cart/${id}?tenant=safe_B`)).status).toBe(404);
 const participant=crypto.randomBytes(32).toString('hex'),item={participantName:'Guest',itemId:'safe_item',quantity:2};
 const update=await request(app).post(`/api/public/group-cart/${id}/items?tenant=safe_A`).set('X-Group-Participant',participant).send(item);expect(update.status,update.text).toBe(200);
 expect((await request(app).post(`/api/public/group-cart/${id}/items?tenant=safe_A`).set('X-Group-Participant',participant).send({...item,itemId:'foreign_item'})).status).toBe(400);
 const endpoint=`/api/public/group-cart/${id}/checkout?tenant=safe_A`,body={customerName:'Host',customerPhone:'0770000000',orderType:'takeaway',paymentMethod:'cash',items:[{id:'foreign_item',quantity:1}]};
 expect((await request(app).post(endpoint).send(body)).status).toBe(404);
 const before=await stock(),raw=await ingredient(),checkout=()=>request(app).post(endpoint).set('X-Group-Host',hostToken).send(body);
 const responses=await Promise.all([checkout(),checkout()]);expect(responses.filter(r=>r.status===201)).toHaveLength(1);expect(responses.filter(r=>r.status!==201)).toHaveLength(1);
 expect((await stock()).stock).toBe(before.stock-2);expect((await ingredient()).stock).toBe(raw.stock-1);
 expect((await request(app).post(`/api/public/group-cart/${id}/items?tenant=safe_A`).set('X-Group-Participant',participant).send(item)).status).toBe(409);
});
it('checks seats atomically across both staff creation endpoints',async()=>{
 await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('seat_two','seat_two','cashier','safe_B')");
 const results=await Promise.all(['/api/users','/api/auth/register'].map((endpoint,i)=>request(app).post(endpoint).set(staff('safe_B')).send({username:`seat_parallel_${i}`,password:'ValidTestPassword123',pin:'927461',role:'cashier'})));
 expect(results.map(r=>r.status).sort()).toEqual([200,402]);
});
it('rejects negative or foreign stock transfers and cannot approve unavailable stock',async()=>{
 const endpoint='/api/inventory/transfers',body={destinationOutlet:'Storage room',ingredientId:'safe_ingredient',quantity:5};
 expect((await request(app).post(endpoint).set(staff()).send({...body,quantity:-1})).status).toBe(400);
 expect((await request(app).post(endpoint).set(staff()).send({...body,ingredientId:'foreign_ingredient'})).status).toBe(404);
 const created=await request(app).post(endpoint).set(staff()).send(body);expect(created.status,created.text).toBe(201);const before=await ingredient();
 const approve=()=>request(app).post(`${endpoint}/${created.body.id}/approve`).set(staff()).send({});expect((await Promise.all([approve(),approve()])).map(r=>r.status)).toEqual([200,200]);expect((await ingredient()).stock).toBe(before.stock-5);
 const over=await request(app).post(endpoint).set(staff()).send({...body,quantity:100000});expect((await request(app).post(`${endpoint}/${over.body.id}/approve`).set(staff()).send({})).status).toBe(409);
 expect((await ingredient()).stock).toBe(before.stock-5);
});
it('returns recorded loyalty reservations once when a customer cancels',async()=>{
 await dbRun("UPDATE customer_accounts SET loyaltyPoints=1000 WHERE id='safe_customer'");
 const token=jwt.sign({id:'safe_customer',type:'customer'},process.env.CUSTOMER_JWT_SECRET);
 const created=await request(app).post('/api/public/orders?tenant=safe_A').send({customerName:'Safety Customer',customerPhone:'0770000000',orderType:'takeaway',paymentMethod:'cash',customerToken:token,loyaltyPointsToRedeem:500,items:[{id:'safe_item',quantity:1}]});expect(created.status,created.text).toBe(201);
 expect((await dbGet("SELECT loyaltyPoints FROM customer_accounts WHERE id='safe_customer'")).loyaltyPoints).toBe(500);
 const cancel=()=>request(app).post(`/api/public/orders/${created.body.orderId}/cancel?tenant=safe_A`).set('X-Order-Tracking',created.body.trackingToken);
 expect((await Promise.all([cancel(),cancel()])).map(r=>r.status)).toEqual([200,200]);expect((await dbGet("SELECT loyaltyPoints FROM customer_accounts WHERE id='safe_customer'")).loyaltyPoints).toBe(1000);
});
it('rechecks live stream access after driver reassignment, account deletion, expiration and suspension',async()=>{
 const {createLiveAccessCheck}=await import('../lib/live-access.js');const id=await ticket();await dbRun("UPDATE orders SET driverId='safe_driver',customerAccountId='safe_customer' WHERE id=?",[id]);
 const check=(actor,expiresAt)=>createLiveAccessCheck({dbGet,actor,tenantId:'safe_A',orderId:id,expiresAt});
 const assigned=check({type:'driver',id:'safe_driver'});expect(await assigned()).toBe(true);
 await dbRun('UPDATE orders SET driverId=NULL WHERE id=?',[id]);expect(await assigned()).toBe(false);
 const staffCheck=check({type:'staff',id:'stream_staff'});await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('stream_staff','stream_staff','owner','safe_A')");expect(await staffCheck()).toBe(true);await dbRun("DELETE FROM users WHERE id='stream_staff'");expect(await staffCheck()).toBe(false);
 expect(await check({type:'capability'},1)()).toBe(false);
 await dbRun("UPDATE tenants SET status='suspended' WHERE id='safe_A'");expect(await check({type:'capability'})()).toBe(false);await dbRun("UPDATE tenants SET status='active' WHERE id='safe_A'");
});
it('reconciles offline cash recipe inventory exactly once on replay',async()=>{
 const before=await stock(),raw=await ingredient(),offlineId='off_'+crypto.randomUUID();const body={orders:[{offlineId,createdAt:Date.now(),paymentMethod:'cash',total:200,items:[{id:'safe_item',quantity:2}]}]};
 for(let i=0;i<2;i++){const response=await request(app).post('/api/orders/offline-sync').set(staff()).send(body);expect(response.status,response.text).toBe(200);}
 expect((await stock()).stock).toBe(before.stock-2);expect((await ingredient()).stock).toBe(raw.stock-1);
});
it('publishes configured restaurant names, opening state and real review counts',async()=>{
 await dbRun("INSERT INTO settings (key,value,tenant_id) VALUES ('businessName','Real Kitchen','safe_A')");await dbRun("UPDATE settings SET value='false' WHERE key='storeOpen' AND tenant_id='safe_A'");
 const response=await request(app).get('/api/public/restaurants');expect(response.status).toBe(200);const store=response.body.find(r=>r.id==='safe_A');expect(store.name).toBe('Real Kitchen');expect(store.isOpen).toBe(false);expect(store.promoBadge).toBeUndefined();expect(store.lat).toBeNull();expect(store.ratingCount).toBe(1);expect(store.rating).toBe(5);
 await dbRun("UPDATE settings SET value='true' WHERE key='storeOpen' AND tenant_id='safe_A'");
});
it('keeps each invited participant in control of their own items and rolls back a failed group checkout',async()=>{
 const created=await request(app).post('/api/public/group-cart?tenant=safe_A').send({}),{id,hostToken}=created.body;
 const endpoint=`/api/public/group-cart/${id}`,body={participantName:'Same Name',itemId:'safe_item',quantity:1};
 const first=crypto.randomBytes(32).toString('hex'),second=crypto.randomBytes(32).toString('hex');
 for(const token of [first,second])expect((await request(app).post(endpoint+'/items?tenant=safe_A').set('X-Group-Participant',token).send(body)).status).toBe(200);
 const removal=await request(app).post(endpoint+'/items?tenant=safe_A').set('X-Group-Participant',second).send({...body,quantity:0});expect(removal.body.items).toHaveLength(1);
 await dbRun("UPDATE ingredients SET stock=0 WHERE id='safe_ingredient'");const before=await stock();
 const response=await request(app).post(endpoint+'/checkout?tenant=safe_A').set('X-Group-Host',hostToken).send({customerName:'Host',customerPhone:'0770000000',orderType:'takeaway',paymentMethod:'cash'});expect(response.status).toBe(500);
 expect((await dbGet('SELECT status,orderId FROM group_carts WHERE id=?',[id]))).toEqual({status:'active',orderId:null});expect(await stock()).toEqual(before);
 await dbRun("UPDATE ingredients SET stock=1000 WHERE id='safe_ingredient'");
});
const recoveryBody=()=>({customerName:'Retry Customer',customerPhone:'0770000000',orderType:'takeaway',paymentMethod:'cash',items:[{id:'safe_item',quantity:2}]});
const retryCheckout=(key,body=recoveryBody(),tenant='safe_A')=>request(app).post('/api/public/orders?tenant='+tenant).set('Idempotency-Key',key).send(body);
it('saves one order and one inventory reservation across concurrent checkout retries',async()=>{
 const key=crypto.randomUUID(),before=await stock(),raw=await ingredient();const results=await Promise.all([retryCheckout(key),retryCheckout(key)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,201]);expect(new Set(results.map(r=>r.body.orderId)).size).toBe(1);expect(results.find(r=>r.status===200).headers['idempotency-replayed']).toBe('true');
 expect((await stock()).stock).toBe(before.stock-2);expect((await ingredient()).stock).toBe(raw.stock-1);
 const saved=await dbGet('SELECT requestHash FROM checkout_requests WHERE orderId=?',[results[0].body.orderId]);expect(saved.requestHash).not.toBe(key);expect(saved.requestHash).toHaveLength(64);
});
it('rejects reuse of a private checkout key with a changed order',async()=>{
 const key=crypto.randomUUID(),created=await retryCheckout(key);expect(created.status).toBe(201);const before=await stock();
 expect((await retryCheckout(key,{...recoveryBody(),items:[{id:'safe_item',quantity:3}]})).status).toBe(409);expect(await stock()).toEqual(before);
});
it('recovers the original paid receipt after pricing, stock, loyalty and account tokens change',async()=>{
 const key=crypto.randomUUID(),body={...recoveryBody(),loyaltyPointsToRedeem:500},firstToken=jwt.sign({id:'safe_customer',type:'customer',version:1},process.env.CUSTOMER_JWT_SECRET);
 await dbRun("UPDATE customer_accounts SET loyaltyPoints=1000 WHERE id='safe_customer'");const first=await retryCheckout(key,{...body,customerToken:firstToken});expect(first.status,first.text).toBe(201);
 await dbRun("UPDATE menu_items SET price=9999,isAvailable=0 WHERE id='safe_item'");await dbRun("UPDATE customer_accounts SET loyaltyPoints=0 WHERE id='safe_customer'");await dbRun("UPDATE orders SET paymentStatus='paid' WHERE id=?",[first.body.orderId]);
 const rotated=jwt.sign({id:'safe_customer',type:'customer',version:2},process.env.CUSTOMER_JWT_SECRET),replay=await retryCheckout(key,{...body,customerToken:rotated});expect(replay.status,replay.text).toBe(200);expect(replay.body.orderId).toBe(first.body.orderId);expect(replay.body.total).toBe(first.body.total);expect(replay.body.paymentStatus).toBe('paid');expect(replay.body.trackingToken).toBeTruthy();
 await dbRun("UPDATE menu_items SET price=100,isAvailable=1 WHERE id='safe_item'");await dbRun("UPDATE customer_accounts SET loyaltyPoints=1000 WHERE id='safe_customer'");
});
it('scopes the same checkout key separately to each restaurant',async()=>{
 const key=crypto.randomUUID(),first=await retryCheckout(key),other=await retryCheckout(key,{...recoveryBody(),items:[{id:'foreign_item',quantity:2}]},'safe_B');expect(first.status).toBe(201);expect(other.status,other.text).toBe(201);expect(first.body.orderId).not.toBe(other.body.orderId);
});
it('does not transfer checkout recovery access to a different customer identity',async()=>{
 const key=crypto.randomUUID();expect((await retryCheckout(key)).status).toBe(201);
 const token=jwt.sign({id:'safe_customer',type:'customer'},process.env.CUSTOMER_JWT_SECRET);expect((await retryCheckout(key,{...recoveryBody(),customerToken:token})).status).toBe(409);
});
it('rolls back the recovery record with failed inventory and allows a corrected retry',async()=>{
 const key=crypto.randomUUID(),before=await stock();await dbRun("UPDATE ingredients SET stock=0 WHERE id='safe_ingredient'");expect((await retryCheckout(key)).status).toBe(500);expect(await stock()).toEqual(before);
 await dbRun("UPDATE ingredients SET stock=1000 WHERE id='safe_ingredient'");expect((await retryCheckout(key)).status).toBe(201);expect((await stock()).stock).toBe(before.stock-2);
});
it('blocks new orders while closed but still recovers an already saved checkout',async()=>{
 const key=crypto.randomUUID(),created=await retryCheckout(key);expect(created.status).toBe(201);
 await dbRun("UPDATE settings SET value='false' WHERE key='storeOpen' AND tenant_id='safe_A'");expect((await retryCheckout(crypto.randomUUID())).status).toBe(409);
 const replay=await retryCheckout(key);expect(replay.status).toBe(200);expect(replay.body.orderId).toBe(created.body.orderId);await dbRun("UPDATE settings SET value='true' WHERE key='storeOpen' AND tenant_id='safe_A'");
});
it('recovers a checked-out group order only for its private host',async()=>{
 const created=await request(app).post('/api/public/group-cart?tenant=safe_A').send({}),{id,hostToken}=created.body,endpoint=`/api/public/group-cart/${id}`;
 expect((await request(app).post(endpoint+'/items?tenant=safe_A').set('X-Group-Participant',crypto.randomBytes(32).toString('hex')).send({participantName:'Host',itemId:'safe_item',quantity:1})).status).toBe(200);
 const first=await request(app).post(endpoint+'/checkout?tenant=safe_A').set('X-Group-Host',hostToken).send(recoveryBody());expect(first.status).toBe(201);const before=await stock();
 const replay=await request(app).post(endpoint+'/checkout?tenant=safe_A').set('X-Group-Host',hostToken).send({});expect(replay.status).toBe(200);expect(replay.body.orderId).toBe(first.body.orderId);expect(replay.body.trackingToken).toBeTruthy();expect(await stock()).toEqual(before);
 expect((await request(app).post(endpoint+'/checkout?tenant=safe_A').set('X-Group-Host',crypto.randomBytes(32).toString('hex')).send({})).status).toBe(404);
});
it('rejects weak or malformed checkout recovery keys',async()=>expect((await retryCheckout('short')).status).toBe(400));
it('returns the stored phone-verification flag without exposing customer credentials',async()=>{
 await dbRun("UPDATE customer_accounts SET phoneVerified=1 WHERE id='safe_customer'");
 const response=await request(app).get('/api/customer/auth/me?tenant=safe_A').set(customer('safe_customer'));expect(response.status).toBe(200);expect(response.body.phoneVerified).toBe(1);expect(response.body.passwordHash).toBeUndefined();
});
