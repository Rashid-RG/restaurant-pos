import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {
 brevoWebhookEnabled,authenticateBrevoWebhook,normalizeBrevoTransactionalPayload
} from '../lib/communications/platform-brevo-webhook.js';
import {createPlatformCommunicationsRouter} from '../routes/platform-communications.js';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN:'test-staging-only-webhook-bearer-secret-1234567890'
};
const now=Date.now();
const event={'event':'delivered','message-id':'brevo-msg-123',email:'test@example.test',ts_event:Math.floor(now/1000)};
const setup=(configuration=env)=>{
 const dbGet=vi.fn(async sql=>{
  if(sql.includes('platform_owner_communication_email_receipts'))
   return {eventStatus:'accepted',acceptedAt:now-10000,eventAt:null,recipientEmail:'test@example.test'};
  return null;
 });
 const dbRun=vi.fn(async()=>({changes:1}));
 const router=createPlatformCommunicationsRouter({
   dbGet,dbRun,dbAll:vi.fn(async()=>[]),
   authenticateToken:(_req,res)=>res.status(403).end(),
   requirePlatformAdmin:(_req,res)=>res.status(403).end(),env:configuration
 });
 const app=express();app.use(express.json({limit:'16kb'}));app.use('/api',router);
 return {app,dbGet,dbRun};
};
const endpoint='/api/platform/communications/brevo/webhook';
describe('Authenticated Brevo transactional staging webhook',()=>{
 it('requires independent stage, webhook flag and a strong secret',()=>{
  expect(brevoWebhookEnabled(env)).toBe(true);
  expect(brevoWebhookEnabled({...env,PLATFORM_COMMUNICATIONS_STAGE:'production'})).toBe(false);
  expect(brevoWebhookEnabled({...env,PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'false'})).toBe(false);
  expect(brevoWebhookEnabled({...env,PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED:'false'})).toBe(false);
  expect(brevoWebhookEnabled({...env,PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN:'short'})).toBe(false);
 });
 it('compares a configured bearer token without accepting alternate syntax',()=>{
  expect(authenticateBrevoWebhook('Bearer '+env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN,env)).toBe(true);
  expect(authenticateBrevoWebhook('Bearer wrong-secret-that-is-sufficiently-long-0000000',env)).toBe(false);
  expect(authenticateBrevoWebhook('Basic '+env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN,env)).toBe(false);
 });
 it('maps documented Brevo event fields and rejects stale and future payloads',()=>{
  expect(normalizeBrevoTransactionalPayload(event,now)).toMatchObject({event:'delivered',messageId:'brevo-msg-123'});
  expect(normalizeBrevoTransactionalPayload({...event,event:'hardBounce'},now).event).toBe('hard_bounce');
  expect(normalizeBrevoTransactionalPayload({...event,event:'opened'},now)).toBeNull();
  expect(normalizeBrevoTransactionalPayload({...event,email:'wrong-address'},now)).toBeNull();
  expect(normalizeBrevoTransactionalPayload({...event,ts_event:1},now)).toBeNull();
  expect(normalizeBrevoTransactionalPayload({...event,ts_event:Math.floor(now/1000)+3600},now)).toBeNull();
 });
 it('never hits storage without a valid webhook bearer',async()=>{
  const f=setup();
  expect((await request(f.app).post(endpoint).send(event)).status).toBe(401);
  expect((await request(f.app).post(endpoint).set('Authorization','Bearer incorrect-token-long-enough-to-test-5555555').send(event)).status).toBe(401);
  expect(f.dbGet).not.toHaveBeenCalled();expect(f.dbRun).not.toHaveBeenCalled();
 });
 it('returns 404 and leaves storage untouched while disabled',async()=>{
  const f=setup({...env,PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED:'false'});
  expect((await request(f.app).post(endpoint).set('Authorization','Bearer '+env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN).send(event)).status).toBe(404);
  expect(f.dbRun).not.toHaveBeenCalled();
 });
 it('safely records one authenticated event without exposing provider ids',async()=>{
  const f=setup();
  const result=await request(f.app).post(endpoint).set('Authorization','Bearer '+env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN).send(event);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({accepted:true,recorded:true});
  expect(f.dbRun).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result.body)).not.toContain(event['message-id']);
 });
 it('does not accept unsupported events after authentication',async()=>{
  const f=setup();
  const result=await request(f.app).post(endpoint).set('Authorization','Bearer '+env.PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN).send({...event,event:'opened'});
  expect(result.status).toBe(400);expect(f.dbRun).not.toHaveBeenCalled();
 });
});
