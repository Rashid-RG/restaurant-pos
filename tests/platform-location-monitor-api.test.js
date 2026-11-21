import {beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE=path.join(os.tmpdir(),`gastroflow_platform_location_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='platform-location-monitor-staging-test-key';
const {app,dbReady,dbRun}=await import('../server.js');
const auth=(id,tenant='default_tenant')=>({Authorization:`Bearer ${jwt.sign({id,tenant_id:tenant,role:'owner'},process.env.JWT_SECRET)}`});
const assigned='monitor-driver';
const orderId=crypto.randomUUID();

beforeAll(async()=>{
  await dbReady;
  await dbRun('INSERT INTO drivers (id,name,phone,status,tenant_id) VALUES (?,?,?,?,?)',
    [assigned,'Monitoring Test Rider','0771234567','active','default_tenant']);
  await dbRun('INSERT INTO orders(id,tenant_id,driverId,status,diningType,total,source,timestamp) VALUES(?,?,?,?,?,?,?,?)',
    [orderId,'default_tenant',assigned,'out_for_delivery','delivery',100,'online',Date.now()]);
  await dbRun('INSERT INTO driver_locations(orderId,driverName,lat,lng,updatedAt,accuracyMeters) VALUES (?,?,?,?,?,?)',
    [orderId,assigned,6.9271,79.8612,Date.now()-1000,20]);
},30000);

describe('platform owner location monitoring API',()=>{
  it('requires authentication and rejects ordinary restaurant owners',async()=>{
    expect((await request(app).get('/api/platform/location-monitor')).status).toBe(401);
    await dbRun("INSERT INTO users (id,username,role,tenant_id) VALUES ('non-platform-location-owner','location-owner','owner','default_tenant')");
    expect((await request(app).get('/api/platform/location-monitor').set(auth('non-platform-location-owner'))).status).toBe(403);
  });
  it('returns aggregated delivery GPS health without private coordinates',async()=>{
    const response=await request(app).get('/api/platform/location-monitor').set(auth('user_admin'));
    expect(response.status,response.text).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const store=response.body.stores.find(row=>row.id==='default_tenant');
    expect(store).toBeTruthy();
    expect(store.trips).toBe(1);
    expect(store.fresh).toBe(1);
    expect(store.stale).toBe(0);
    expect(store.missing).toBe(0);
    expect(store.poorAccuracy).toBe(0);
    expect(response.text).not.toContain('6.9271');
    expect(response.text).not.toContain('79.8612');
    expect(response.text).not.toContain('0771234567');
  });
  it('identifies stale and low accuracy fixes without revealing location',async()=>{
    await dbRun('UPDATE driver_locations SET updatedAt=? WHERE orderId=?',[Date.now()-120000,orderId]);
    let r=await request(app).get('/api/platform/location-monitor').set(auth('user_admin'));
    let s=r.body.stores.find(row=>row.id==='default_tenant');
    expect(s.stale).toBe(1);
    expect(s.fresh).toBe(0);
    await dbRun('UPDATE driver_locations SET updatedAt=?,accuracyMeters=? WHERE orderId=?',[Date.now()-1000,300,orderId]);
    r=await request(app).get('/api/platform/location-monitor').set(auth('user_admin'));
    s=r.body.stores.find(row=>row.id==='default_tenant');
    expect(s.poorAccuracy).toBe(1);
    expect(s.stale).toBe(0);
  });
});
