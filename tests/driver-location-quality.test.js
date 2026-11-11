import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `gastroflow_location_quality_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'driver-location-quality-test-key';
const { app, dbReady, dbRun, dbGet } = await import('../server.js');
const driverId = 'quality-driver';
const tenantId = 'default_tenant';
const orderId = crypto.randomUUID();
const token = jwt.sign({ driverId, role: 'driver', tenant_id: tenantId }, process.env.JWT_SECRET);
const push = body => request(app).post('/api/public/driver/location')
  .set('Authorization', `Bearer ${token}`).send({ orderId, ...body });

beforeAll(async () => {
  await dbReady;
  await dbRun('INSERT INTO drivers (id,name,phone,status,tenant_id) VALUES (?,?,?,?,?)',
    [driverId,'Quality Test Rider','0772345678','active',tenantId]);
  await dbRun('INSERT INTO orders(id,tenant_id,driverId,status,diningType,total,source,timestamp) VALUES(?,?,?,?,?,?,?,?)',
    [orderId,tenantId,driverId,'out_for_delivery','delivery',100,'online',Date.now()]);
},30000);

describe('Live rider location quality controls', () => {
  it('rejects untrusted coarse positions and missing accuracy', async () => {
    const now=Date.now();
    expect((await push({lat:6.9271,lng:79.8612,recordedAt:now,accuracyMeters:1000})).status).toBe(422);
    expect((await push({lat:6.9271,lng:79.8612,recordedAt:now})).status).toBe(422);
  });
  it('rejects cached and impossible future-dated positions', async () => {
    expect((await push({lat:6.9271,lng:79.8612,accuracyMeters:10,recordedAt:Date.now()-90000})).status).toBe(422);
    expect((await push({lat:6.9271,lng:79.8612,accuracyMeters:10,recordedAt:Date.now()+90000})).status).toBe(422);
  });
  it('saves accurate fresh fixes with their real measurement timestamp', async () => {
    const recordedAt=Date.now()-1000;
    const result=await push({lat:6.9271,lng:79.8612,accuracyMeters:17,recordedAt});
    expect(result.status,result.text).toBe(200);
    expect(result.body.accuracyMeters).toBe(17);
    const row=await dbGet('SELECT lat,lng,updatedAt,accuracyMeters FROM driver_locations WHERE orderId=?',[orderId]);
    expect(row.lat).toBe(6.9271);
    expect(row.updatedAt).toBe(recordedAt);
    expect(row.accuracyMeters).toBe(17);
  });
  it('rejects out-of-order fixes rather than moving the map backward', async () => {
    const previous=await dbGet('SELECT updatedAt FROM driver_locations WHERE orderId=?',[orderId]);
    const response=await push({lat:6.9272,lng:79.8612,accuracyMeters:10,recordedAt:previous.updatedAt-500});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GPS_FIX_OLD');
  });
  it('rejects physically impossible location jumps', async () => {
    const response=await push({lat:7.22,lng:80.63,accuracyMeters:9,recordedAt:Date.now()});
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GPS_JUMP');
    expect((await dbGet('SELECT lat FROM driver_locations WHERE orderId=?',[orderId])).lat).toBe(6.9271);
  });
  it('does not allow another driver to overwrite this order location', async () => {
    const otherToken=jwt.sign({driverId:'other-driver',role:'driver',tenant_id:tenantId},process.env.JWT_SECRET);
    const response=await request(app).post('/api/public/driver/location')
      .set('Authorization',`Bearer ${otherToken}`)
      .send({orderId,lat:6.9272,lng:79.8612,accuracyMeters:10,recordedAt:Date.now()});
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.status).not.toBe(200);
  });
});
