import { beforeAll,describe,it,expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE=path.join(os.tmpdir(),`gastroflow_customer_auth_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET='customer-auth-security-staff-secret';
process.env.CUSTOMER_JWT_SECRET='customer-auth-security-customer-secret';
process.env.PAYHERE_ENABLED='false';
const {app,dbReady,dbRun,dbGet}=await import('../server.js');
const A='tenant_auth_qa_a',B='tenant_auth_qa_b';
const phoneA='+94771234011',phoneB='+94771234022';
const pw='Secure-password-2026!';
const otpHash=c=>crypto.createHash('sha256').update(c).digest('hex');
const requestLogin=(tenantId,phone,password)=>request(app).post('/api/customer/auth/login')
  .set('X-Tenant-Id',tenantId).send({phone,password});
const otp=(tid,dest,purpose,code)=>dbRun(
  'INSERT INTO otp_codes(id,channel,destination,purpose,codeHash,expiresAt,createdAt,tenant_id) VALUES (?,?,?,?,?,?,?,?)',
  [crypto.randomUUID(),'email',dest,purpose,otpHash(code),Date.now()+600000,Date.now(),tid]
);
let tokenA;
beforeAll(async()=>{
  await dbReady;
  for (const [id,suffix] of [[A,'a'],[B,'b']]) {
    await dbRun('INSERT INTO tenants(id,name,subdomain,ownerEmail,status) VALUES(?,?,?,?,?)',
      [id,`Auth Test Store ${suffix}`,`auth-test-${suffix}`,`owner-${suffix}@example.test`,'active']);
  }
  const hash=await bcrypt.hash(pw,6);
  await dbRun('INSERT INTO customer_accounts(id,name,email,phone,passwordHash,tenant_id) VALUES(?,?,?,?,?,?)',
    ['acct-a','Test A','alpha@example.test',phoneA,hash,A]);
  await dbRun('INSERT INTO customer_accounts(id,name,email,phone,passwordHash,tenant_id) VALUES(?,?,?,?,?,?)',
    ['acct-b','Test B','bravo@example.test',phoneB,hash,B]);
},30000);

describe('Customer authentication for SaaS storefronts',()=>{
  it('authenticates the correct restaurant and rejects account from another restaurant',async()=>{
    const own=await requestLogin(A,phoneA,pw);
    expect(own.status,own.text).toBe(200);
    tokenA=own.body.token;
    expect(own.body.customer.id).toBe('acct-a');
    const wrong=await requestLogin(B,phoneA,pw);
    expect(wrong.status).toBe(401);
    expect(wrong.body.token).toBeUndefined();
  });
  it('prevents use of a customer token with another tenant',async()=>{
    const mismatched=await request(app).get('/api/customer/auth/me')
      .set('Authorization',`Bearer ${tokenA}`).set('X-Tenant-Id',B);
    expect(mismatched.status).toBe(403);
  });
  it('requires a login-purpose OTP; a registration OTP cannot sign someone in',async()=>{
    await otp(A,'alpha@example.test','phone_verify','547291');
    const wrong=await request(app).post('/api/otp/verify').set('X-Tenant-Id',A)
      .send({destination:'alpha@example.test',code:'547291'});
    expect(wrong.status).toBe(400);
    await otp(A,'alpha@example.test','login','728491');
    const right=await request(app).post('/api/otp/verify').set('X-Tenant-Id',A)
      .send({destination:'alpha@example.test',code:'728491'});
    expect(right.status,right.text).toBe(200);
    expect(right.body.loggedIn).toBe(true);
    const replay=await request(app).post('/api/otp/verify').set('X-Tenant-Id',A)
      .send({destination:'alpha@example.test',code:'728491'});
    expect(replay.status).toBe(400);
  });
  it('registers using a single registration OTP and cannot reuse that code',async()=>{
    await otp(A,'newcustomer@example.test','phone_verify','632194');
    const payload={name:'New Customer',email:'newcustomer@example.test',phone:'0771234066',password:pw,otpCode:'632194'};
    const added=await request(app).post('/api/customer/auth/register').set('X-Tenant-Id',A).send(payload);
    expect(added.status,added.text).toBe(201);
    expect(added.body.token).toBeTruthy();
    const already=await request(app).post('/api/customer/auth/register').set('X-Tenant-Id',A)
      .send({...payload,phone:'0771234067'});
    expect(already.status).toBe(400);
  });
  it('requires current password and invalidates previous session after change',async()=>{
    const rejected=await request(app).put('/api/customer/profile')
      .set('Authorization',`Bearer ${tokenA}`).set('X-Tenant-Id',A)
      .send({name:'Test A',password:'New-password-2027!',currentPassword:'wrong-password'});
    expect(rejected.status).toBe(403);
    const success=await request(app).put('/api/customer/profile')
      .set('Authorization',`Bearer ${tokenA}`).set('X-Tenant-Id',A)
      .send({name:'Test A',password:'New-password-2027!',currentPassword:pw});
    expect(success.status,success.text).toBe(200);
    expect(success.body.reauthenticationRequired).toBe(true);
    const expired=await request(app).get('/api/customer/auth/me')
      .set('Authorization',`Bearer ${tokenA}`).set('X-Tenant-Id',A);
    expect(expired.status).toBe(403);
    const fresh=await requestLogin(A,phoneA,'New-password-2027!');
    expect(fresh.status,fresh.text).toBe(200);
  });
  it('blocks unverified phone ownership changes',async()=>{
    const fresh=await requestLogin(A,phoneA,'New-password-2027!');
    const change=await request(app).put('/api/customer/profile')
      .set('Authorization',`Bearer ${fresh.body.token}`).set('X-Tenant-Id',A)
      .send({name:'Test A',phone:'+94771239999'});
    expect(change.status).toBe(409);
    expect((await dbGet('SELECT phone FROM customer_accounts WHERE id=?',['acct-a'])).phone).toBe(phoneA);
  });
  it('never advertises unconfigured verification gateways',async()=>{
    const res=await request(app).get('/api/public/customer-auth-capabilities');
    expect(res.status).toBe(200);
    expect(typeof res.body.emailOtp).toBe('boolean');
    expect(typeof res.body.smsOtp).toBe('boolean');
  });
});
