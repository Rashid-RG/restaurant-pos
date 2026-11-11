import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `payroll_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'payroll-integration-test-secret';

const { app, dbReady, dbRun } = await import('../server.js');
const auth = (id, tenant_id, role = 'owner') => ({
  Authorization: 'Bearer '+jwt.sign({id,tenant_id,role},process.env.JWT_SECRET)
});

const tenantA = 'payroll_test_a', tenantB = 'payroll_test_b';
const ownerA = 'payroll_owner_a', ownerB = 'payroll_owner_b', cashierA = 'payroll_cashier_a';

beforeAll(async () => {
  await dbReady;
  for (const [tenant,user] of [[tenantA,ownerA],[tenantB,ownerB]]) {
    await dbRun('INSERT OR IGNORE INTO tenants (id,name,subdomain,ownerEmail,plan,status,createdAt) VALUES (?,?,?,?,?,?,?)',
      [tenant,tenant,tenant,tenant+'@test.invalid','basic','active',Date.now()]);
    await dbRun('INSERT OR IGNORE INTO users (id,username,passwordHash,role,tenant_id) VALUES (?,?,?,?,?)',
      [user,user,'testhash','owner',tenant]);
  }
  await dbRun('INSERT OR IGNORE INTO users (id,username,passwordHash,role,tenant_id) VALUES (?,?,?,?,?)', [cashierA,cashierA,'testhash','cashier',tenantA]);
}, 30000);

describe('Staff and payroll tenant security', () => {
  it('requires authentication and management privileges',async() => {
    expect((await request(app).get('/api/staff-management/overview')).status).toBe(401);
    expect((await request(app).get('/api/staff-management/overview').set(auth(cashierA,tenantA,'cashier'))).status).toBe(403);
  });
  it('only exposes staff belonging to the authenticated restaurant',async() => {
    const a=await request(app).get('/api/staff-management/overview?month=2026-11').set(auth(ownerA,tenantA));
    expect(a.status).toBe(200);
    expect(a.body.staff.some(u=>u.userId===ownerA)).toBe(true);
    expect(a.body.staff.some(u=>u.userId===ownerB)).toBe(false);
  });
  it('denies salary updates targeting another restaurant',async() => {
    const result=await request(app).put('/api/staff-management/compensation/'+ownerB)
      .set(auth(ownerA,tenantA)).send({payType:'monthly',rate:45000});
    expect(result.status).toBe(404);
  });
  it('stores per-restaurant pay settings and creates one immutable draft',async() => {
    const headers=auth(ownerA,tenantA);
    const config=await request(app).put('/api/staff-management/compensation/'+ownerA)
      .set(headers).send({payType:'monthly',rate:25000,allowance:500,deduction:100});
    expect(config.status).toBe(200);
    const preview=await request(app).get('/api/staff-management/overview?month=2026-11').set(headers);
    expect(preview.body.staff.find(x=>x.userId===ownerA).totalPay).toBe(25400);
    const first=await request(app).post('/api/staff-management/payroll/'+ownerA+'/2026-11').set(headers);
    expect(first.status).toBe(201);
    const second=await request(app).post('/api/staff-management/payroll/'+ownerA+'/2026-11').set(headers);
    expect(second.status).toBe(409);
    const cross=await request(app).post('/api/staff-management/payroll-records/'+first.body.id+'/mark-paid')
      .set(auth(ownerB,tenantB)).send({reference:'external-transfer-123'});
    expect(cross.status).toBe(404);
  });
});
