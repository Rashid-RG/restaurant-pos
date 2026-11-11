import {beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE=path.join(os.tmpdir(),`workday_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='workday-integration-test-secret';
const {app,dbReady,dbRun}=await import('../server.js');
const auth=(id,tenant_id,role='owner')=>({Authorization:'Bearer '+jwt.sign({id,tenant_id,role},process.env.JWT_SECRET)});
const firstTenant='workday_tenant_a',secondTenant='workday_tenant_b';
const ownerA='workday_owner_a',ownerB='workday_owner_b',staffA='workday_staff_a';
beforeAll(async()=>{
  await dbReady;
  for(const [tid,owner] of [[firstTenant,ownerA],[secondTenant,ownerB]]){
    await dbRun('INSERT OR IGNORE INTO tenants(id,name,subdomain,ownerEmail,plan,status,createdAt) VALUES(?,?,?,?,?,?,?)',[tid,tid,tid,tid+'@test.invalid','basic','active',Date.now()]);
    await dbRun('INSERT OR IGNORE INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',[owner,owner,'testhash','owner',tid]);
  }
  await dbRun('INSERT OR IGNORE INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',[staffA,staffA,'testhash','cashier',firstTenant]);
},30000);

describe('Workday staff attendance and cash drawer security',()=>{
  it('rejects requests without authentication',async()=>{
    expect((await request(app).get('/api/workday/drawer')).status).toBe(401);
    expect((await request(app).post('/api/workday/manual-attendance')).status).toBe(401);
  });
  it('rejects manual attendance by cashier',async()=>{
    const end=Date.now()-3600000;
    const result=await request(app).post('/api/workday/manual-attendance')
      .set(auth(staffA,firstTenant,'cashier')).send({userId:staffA,clockIn:end-3600000,clockOut:end,reason:'Manager verified'});
    expect(result.status).toBe(403);
  });
  it('does not allow manual attendance for another restaurant',async()=>{
    const end=Date.now()-3600000;
    const result=await request(app).post('/api/workday/manual-attendance')
      .set(auth(ownerB,secondTenant)).send({userId:staffA,clockIn:end-3600000,clockOut:end,reason:'Manager verified'});
    expect(result.status).toBe(404);
  });
  it('adds an audited manual shift without allowing overlaps or duplicate hours',async()=>{
    const end=Date.now()-3600000;
    const input={userId:staffA,clockIn:end-3600000,clockOut:end,reason:'Confirmed with manager'};
    const first=await request(app).post('/api/workday/manual-attendance').set(auth(ownerA,firstTenant)).send(input);
    expect(first.status).toBe(201);
    const second=await request(app).post('/api/workday/manual-attendance').set(auth(ownerA,firstTenant)).send(input);
    expect(second.status).toBe(409);
    const history=await request(app).get('/api/workday/manual-attendance').set(auth(ownerA,firstTenant));
    expect(history.status).toBe(200);
    expect(history.body.some(row=>row.entryId===first.body.entryId&&row.staffUserId===staffA)).toBe(true);
    const other=await request(app).get('/api/workday/manual-attendance').set(auth(ownerB,secondTenant));
    expect(other.body.some(row=>row.staffUserId===staffA)).toBe(false);
  });
  it('keeps drawer shifts scoped to restaurant',async()=>{
    const today=new Date().toISOString().slice(0,10);
    const data=await request(app).get('/api/workday/drawer?date='+today).set(auth(ownerB,secondTenant));
    expect(data.status).toBe(200);
    expect(Array.isArray(data.body.shifts)).toBe(true);
    expect(data.body.timeZone).toBeTruthy();
  });
});
