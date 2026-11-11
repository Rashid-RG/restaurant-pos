import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.DATABASE_FILE=path.join(os.tmpdir(),`attendance_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='attendance-integration-test-secret';
const {app, dbReady, dbRun}=await import('../server.js');
const token=(id,tid)=>({Authorization:'Bearer '+jwt.sign({id,tenant_id:tid,role:'cashier'},process.env.JWT_SECRET)});
beforeAll(async()=>{
  await dbReady;
  for(const [tenant,user] of [['attendance_alpha','attendance_user_a'],['attendance_beta','attendance_user_b']]){
    await dbRun('INSERT OR IGNORE INTO tenants(id,name,subdomain,ownerEmail,plan,status,createdAt) VALUES(?,?,?,?,?,?,?)',
      [tenant,tenant,tenant,tenant+'@test.invalid','basic','active',Date.now()]);
    await dbRun('INSERT OR IGNORE INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',
      [user,user,'testhash','cashier',tenant]);
  }
  await dbRun('INSERT INTO timeclock_entries(id,userId,username,clockIn,clockOut,durationMinutes) VALUES(?,?,?,?,?,?)',
    ['att_alpha','attendance_user_a','attendance_user_a',Date.parse('2026-11-11T10:00:00Z'),Date.parse('2026-11-11T12:00:00Z'),120]);
  await dbRun('INSERT INTO timeclock_entries(id,userId,username,clockIn,clockOut,durationMinutes) VALUES(?,?,?,?,?,?)',
    ['att_beta','attendance_user_b','attendance_user_b',Date.parse('2026-11-11T10:00:00Z'),Date.parse('2026-11-11T13:00:00Z'),180]);
},30000);
describe('employee My Attendance route',()=>{
  it('requires signed-in staff',async()=>{
    expect((await request(app).get('/api/timeclock/mine')).status).toBe(401);
  });
  it('returns only the own restaurant employee timeclock sessions',async()=>{
    const a=await request(app).get('/api/timeclock/mine').set(token('attendance_user_a','attendance_alpha'));
    expect(a.status).toBe(200);
    expect(a.body.map(x=>x.id)).toEqual(['att_alpha']);
    const b=await request(app).get('/api/timeclock/mine').set(token('attendance_user_b','attendance_beta'));
    expect(b.status).toBe(200);
    expect(b.body.map(x=>x.id)).toEqual(['att_beta']);
  });
});
