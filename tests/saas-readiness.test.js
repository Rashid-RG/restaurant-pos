import {beforeAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
process.env.DATABASE_FILE=path.join(os.tmpdir(),`saas-readiness-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='readiness-staff-secret';process.env.CUSTOMER_JWT_SECRET='readiness-customer-secret';
const{app,dbReady,dbRun,dbGet}=await import('../server.js');
const auth=(id='user_admin',tenant_id='default_tenant')=>({Authorization:'Bearer '+jwt.sign({id,role:'owner',tenant_id},process.env.JWT_SECRET)});
const customer=id=>({Authorization:'Bearer '+jwt.sign({id,type:'customer'},process.env.CUSTOMER_JWT_SECRET)});
let guest;
beforeAll(async()=>{
 await dbReady;
 for(const tid of ['tenant_A','tenant_B']){
  await dbRun('INSERT INTO tenants (id,name,subdomain,ownerEmail,status) VALUES (?,?,?,?,?)',[tid,tid,tid,'owner@example.test','active']);
  await dbRun('INSERT INTO users (id,username,role,tenant_id) VALUES (?,?,?,?)',[tid+'_owner',tid+'_owner','owner',tid]);
 }
 for(const id of ['customer_A','customer_B'])await dbRun('INSERT INTO customer_accounts (id,name,email,phone,tenant_id,passwordHash) VALUES (?,?,?,?,?,?)',[id,id,id+'@example.test',id,'tenant_A','test-fixture-not-for-login']);
},30000);
describe('Support privacy through actual routes',()=>{
 it.each(['/api/public/support/tickets','/api/customer/support/tickets'])('rejects contact-only ticket lookup at %s',async url=>expect((await request(app).get(url+'?phone=customer_A&email=customer_A@example.test')).status).toBe(401));
 it('creates private guest access without granting identity by contact',async()=>{
  const response=await request(app).post('/api/public/support/tickets?tenant=tenant_A').send({name:'Guest',message:'Private guest issue',email:'customer_A@example.test'});
  expect(response.status,response.text).toBe(201);guest=response.body;
  expect(guest.accessToken).toHaveLength(64);
  expect((await dbGet('SELECT guestAccessHash FROM support_tickets WHERE id=?',[guest.ticketId])).guestAccessHash).not.toBe(guest.accessToken);
 });
 it('requires the guest capability and the correct restaurant for private threads',async()=>{
  const url=`/api/public/support/tickets/${guest.ticketId}/messages?tenant=tenant_A`;
  expect((await request(app).get(url)).status).toBe(404);
  expect((await request(app).get(url).set('X-Support-Token',guest.accessToken)).status).toBe(200);
  expect((await request(app).get(url.replace('tenant_A','tenant_B')).set('X-Support-Token',guest.accessToken)).status).toBe(404);
 });
 it('never lets another restaurant owner read or reply to the ticket',async()=>{
  for(const method of ['get','post'])expect((await request(app)[method](`/api/tickets/${guest.ticketId}/messages`).set(auth('tenant_B_owner','tenant_B')).send({message:'Attack'})).status).toBe(404);
  const list=await request(app).get('/api/support/tickets').set(auth('tenant_B_owner','tenant_B'));
  expect(list.status).toBe(200);expect(list.text).not.toContain('Private guest issue');
 });
 it('assigns reply identity on the server, ignoring forged sender fields',async()=>{
  const response=await request(app).post(`/api/public/support/tickets/${guest.ticketId}/messages?tenant=tenant_A`).set('X-Support-Token',guest.accessToken).send({message:'Guest reply',senderType:'staff',senderName:'Platform Owner'});
  expect(response.status).toBe(201);const row=await dbGet('SELECT senderType,senderName FROM support_ticket_messages WHERE id=?',[response.body.messageId]);expect(row.senderType).toBe('customer');expect(row.senderName).not.toBe('Platform Owner');
 });
 it('binds signed-in tickets to the account rather than spoofed email/phone filters',async()=>{
  const created=await request(app).post('/api/customer/support/tickets?tenant=tenant_A').set(customer('customer_A')).send({message:'Account private issue'});expect(created.status).toBe(201);
  const foreign=await request(app).get('/api/customer/support/tickets?tenant=tenant_A&email=customer_A@example.test').set(customer('customer_B'));expect(foreign.status).toBe(200);expect(foreign.text).not.toContain('Account private issue');
 });
 it('rejects a guest linking an unrelated order',async()=>expect((await request(app).post('/api/public/support/tickets?tenant=tenant_A').send({message:'Forged order access',orderId:'any-order'})).status).toBe(404));
});
describe('Platform audit, finance and recovery',()=>{
 it.each(['/api/platform/finance','/api/platform/readiness','/api/platform/access-audit'])('blocks restaurant owners from %s',async url=>expect((await request(app).get(url).set(auth('tenant_A_owner','tenant_A'))).status).toBe(403));
 it('requires a reason, expires support access and records each read',async()=>{
  expect((await request(app).post('/api/platform/support-sessions').set(auth()).send({tenantId:'tenant_A',reason:'short'})).status).toBe(400);
  const created=await request(app).post('/api/platform/support-sessions').set(auth()).send({tenantId:'tenant_A',reason:'Investigating delayed kitchen orders'});expect(created.status).toBe(201);
  const endpoint=`/api/platform/support-sessions/${created.body.id}/snapshot`;
  const read=await request(app).get(endpoint).set(auth());expect(read.status).toBe(200);expect(read.body.readOnly).toBe(true);expect(read.body.tenant.id).toBe('tenant_A');
  await request(app).delete('/api/platform/support-sessions/'+created.body.id).set(auth());expect((await request(app).get(endpoint).set(auth())).status).toBe(404);
  expect((await request(app).get('/api/platform/access-audit').set(auth())).body.some(row=>row.action==='support_snapshot_read')).toBe(true);
 });
 it('rejects expired support sessions and audit tampering',async()=>{
  await dbRun("INSERT INTO platform_support_sessions (id,tenant_id,actorId,reason,createdAt,expiresAt) VALUES ('expired','tenant_A','user_admin','Expired support test',1,2)");
  expect((await request(app).get('/api/platform/support-sessions/expired/snapshot').set(auth())).status).toBe(404);
  await expect(dbRun("DELETE FROM platform_access_audit WHERE actorId='user_admin'")).rejects.toThrow(/append-only/);
 });
 it('reconciles recorded collections and journaled refunds per restaurant',async()=>{
  await dbRun("INSERT INTO orders (id,total,status,paymentStatus,timestamp,paymentTimestamp,tenant_id) VALUES ('paid-a',200,'paid','paid',1000,1000,'tenant_A'),('paid-b',500,'paid','paid',1000,1000,'tenant_B')");
  await dbRun("INSERT INTO refund_transactions (id,orderId,tenant_id,amountCents,reason,actorId,createdAt) VALUES ('refund-a','paid-a','tenant_A',3000,'Test refund','tenant_A_owner',1500)");
  const response=await request(app).get('/api/platform/finance?from=1&to=2000').set(auth());expect(response.status).toBe(200);const row=response.body.restaurants.find(r=>r.id==='tenant_A');expect(row.grossCents).toBe(20000);expect(row.refundCents).toBe(3000);expect(row.netRecordedCents).toBe(17000);
 });
 it('exports a consistent backup and restores it into a new isolated file',async()=>{
  const response=await request(app).post('/api/platform/backups').set(auth()).send({reason:'Automated isolated restore verification'});expect(response.status,response.text).toBe(200);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'saas-restore-')),input=path.join(dir,'backup.json');fs.writeFileSync(input,JSON.stringify(response.body),{mode:0o600});
  try{const result=spawnSync(process.execPath,['scripts/verify-restore.js',input,path.join(dir,'restored.db')],{cwd:process.cwd(),encoding:'utf8',timeout:30000});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).verified).toBe(true);
   const again=spawnSync(process.execPath,['scripts/verify-restore.js',input,path.join(dir,'restored.db')],{cwd:process.cwd(),encoding:'utf8'});expect(again.status).not.toBe(0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 },40000);
 it('does not expose a real subscription checkout without merchant setup',async()=>expect((await request(app).post('/api/saas/billing/checkout').set(auth('tenant_A_owner','tenant_A')).send({plan:'pro'})).status).toBe(503));
});

it('protects order status, ETA, dispatch and event streams from ID or phone-only access',async()=>{
 await dbRun("INSERT INTO orders (id,total,status,tenant_id,customerAccountId,customerPhone) VALUES ('private-tracking',100,'pending','tenant_A','customer_A','0771234567')");
 for(const suffix of ['','/eta','/dispatch-status'])expect((await request(app).get('/api/public/orders/private-tracking'+suffix+'?tenant=tenant_A&phone=0771234567')).status).toBe(401);
 expect((await request(app).get('/api/stream/orders/private-tracking?tenant=tenant_A')).status).toBe(401);
 const {makeTrackingAccess}=await import('../lib/order-tracking.js');
 const access=makeTrackingAccess('private-tracking','tenant_A');
 const own=await request(app).get('/api/public/orders/private-tracking?tenant=tenant_A').set('X-Order-Tracking',access);expect(own.status).toBe(200);expect(own.headers['set-cookie'][0]).toContain('HttpOnly');
 expect((await request(app).get('/api/public/orders/private-tracking?tenant=tenant_B').set('X-Order-Tracking',access)).status).toBe(404);
 expect((await request(app).get('/api/public/orders/private-tracking?tenant=tenant_A').set(customer('customer_B'))).status).toBe(401);
 expect((await request(app).get('/api/public/orders/private-tracking?tenant=tenant_A').set(customer('customer_A'))).status).toBe(200);
});
it('keeps a past-due owner able to fix billing while blocking restaurant operations',async()=>{
 await dbRun("INSERT INTO saas_contracts (id,tenant_id,plan,amountCents,status,paidThrough,createdAt,updatedAt) VALUES ('expired-contract','tenant_B','basic',490000,'active',1,1,1)");
 expect((await request(app).get('/api/orders').set(auth('tenant_B_owner','tenant_B'))).status).toBe(403);
 expect((await request(app).get('/api/saas/billing').set(auth('tenant_B_owner','tenant_B'))).status).toBe(200);
});
it.each(['/api/ingredients','/api/menu_items','/api/orders','/api/inventory/suppliers','/api/staff/performance','/api/reports/vat','/api/reports/cogs','/api/users','/api/timeclock/entries','/api/support/tickets','/api/tickets'])('requires authentication for protected collection %s',async url=>expect([401,403]).toContain((await request(app).get(url)).status));
