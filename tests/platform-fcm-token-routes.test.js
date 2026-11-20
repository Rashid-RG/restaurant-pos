import {describe,it,expect,vi} from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {createPlatformCommunicationsRouter} from '../routes/platform-communications.js';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'staging-device-hmac-key-123456789-123456',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:crypto.randomBytes(32).toString('base64')
};
const installationId='1530ac0b-02f0-4ae5-a132-2056ab4bd660';
const token='fake_Android_registration_token_12345';
const make=(user={id:'owner_a',role:'owner',tenant_id:'tenant_a'})=>{
 const dbGet=vi.fn(async(sql)=>{
  if(sql.includes('SELECT status FROM tenants'))return {status:'active'};
  if(sql.includes('SELECT optedIn FROM platform_owner_communication_push_preferences'))return {optedIn:1};
  if(sql.includes('FROM platform_owner_communication_devices'))return {platform:'android'};
  return null;
 });
 const dbAll=vi.fn(async()=>[]),dbRun=vi.fn(async()=>({changes:1}));
 const router=createPlatformCommunicationsRouter({
  dbGet,dbAll,dbRun,env,
  authenticateToken:(req,res,next)=>{req.user=user;next();},
  requirePlatformAdmin:(_req,res)=>res.status(403).end()
 });
 const app=express();app.use(express.json());app.use('/api',router);
 return {app,dbGet,dbRun};
};
const endpoint='/api/owner/communications/fcm-token';

describe('session-bound owner FCM routes',()=>{
 it('denies staff and unrelated platform roles before token persistence',async()=>{
  for(const user of [
   {id:'manager',role:'manager',tenant_id:'tenant_a'},
   {id:'platform',role:'owner',tenant_id:'tenant_a',isPlatformAdmin:true},
   null
  ]){
   const f=make(user);
   expect((await request(f.app).post(endpoint).send({installationId,token})).status).toBe(403);
   expect(f.dbRun).not.toHaveBeenCalled();
  }
 });
 it('requires owner consent and active tenant before enrollment',async()=>{
  const f=make();
  f.dbGet.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT status FROM tenants'))return {status:'active'};
   if(sql.includes('SELECT optedIn'))return {optedIn:0};
   return null;
  });
  expect((await request(f.app).post(endpoint).send({installationId,token})).status).toBe(409);
  expect(f.dbRun).not.toHaveBeenCalled();
 });
 it('never exposes raw FCM token in a successful response or SQL values',async()=>{
  const f=make();
  const response=await request(f.app).post(endpoint).send({installationId,token});
  expect(response.status).toBe(201);
  expect(response.body).toEqual({status:'registered',platform:'android',pushOperational:false});
  expect(JSON.stringify(response.body)).not.toContain(token);
  const sqlValues=f.dbRun.mock.calls.map(([,args])=>args||[]);
  expect(JSON.stringify(sqlValues)).not.toContain(token);
 });
 it('rejects unregistered installations even for valid signed-in owners',async()=>{
  const f=make();
  f.dbGet.mockImplementation(async(sql)=>{
   if(sql.includes('SELECT status FROM tenants'))return {status:'active'};
   if(sql.includes('SELECT optedIn'))return {optedIn:1};
   return null;
  });
  expect((await request(f.app).post(endpoint).send({installationId,token})).status).toBe(409);
  expect(f.dbRun).not.toHaveBeenCalled();
 });
 it('is disabled without separate staging token-enrollment approval',async()=>{
  const f=make();
  const router=createPlatformCommunicationsRouter({
   dbGet:f.dbGet,dbRun:f.dbRun,dbAll:vi.fn(async()=>[]),
   authenticateToken:(req,res,next)=>{req.user={id:'owner_a',role:'owner',tenant_id:'tenant_a'};next();},
   requirePlatformAdmin:(_req,res)=>res.status(403).end(),
   env:{...env,PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'false'}
  });
  const app=express();app.use(express.json());app.use('/api',router);
  expect((await request(app).post(endpoint).send({installationId,token})).status).toBe(404);
  expect(f.dbRun).not.toHaveBeenCalled();
 });
 it('withdrawing push consent revokes devices and FCM tokens even when registration is disabled',async()=>{
  const f=make();
  const result=await request(f.app)
    .post('/api/owner/communications/push-preference').send({optedIn:false});
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({optedIn:false,pushOperational:false});
  expect(f.dbRun.mock.calls.some(([sql])=>
    sql.includes('UPDATE platform_owner_communication_fcm_tokens'))).toBe(true);
  expect(f.dbRun.mock.calls.some(([sql])=>
    sql.includes('UPDATE platform_owner_communication_devices'))).toBe(true);
 });
 it('revoking a device also revokes its stored FCM registration',async()=>{
  const f=make();
  const result=await request(f.app)
    .post('/api/owner/communications/devices/revoke').send({installationId});
  expect(result.status).toBe(200);
  expect(result.body.status).toBe('revoked');
  const revoked=f.dbRun.mock.calls.find(([sql])=>
    sql.includes('UPDATE platform_owner_communication_fcm_tokens'));
  expect(revoked).toBeTruthy();
  expect(revoked[1].slice(2,4)).toEqual(['tenant_a','owner_a']);
 });
 it('revokes only the signed-in owner installation',async()=>{
  const f=make();
  const result=await request(f.app).post(endpoint+'/revoke').send({installationId});
  expect(result.status).toBe(200);
  expect(result.body).toEqual({status:'revoked',pushOperational:false});
  const query=f.dbRun.mock.calls.find(([sql])=>sql.includes('UPDATE platform_owner_communication_fcm_tokens'));
  expect(query[1].slice(2,4)).toEqual(['tenant_a','owner_a']);
 });
});
