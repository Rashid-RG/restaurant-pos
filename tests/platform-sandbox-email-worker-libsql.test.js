import {describe,it,expect,vi} from 'vitest';
import {createLibsqlStore} from '../lib/libsql-store.js';
import {runSandboxEmailWorkerTick} from '../lib/communications/platform-sandbox-email-worker.js';
import {recordVerifiedBrevoEvent} from '../lib/communications/platform-brevo-receipts.js';
import {previewSandboxOwnerEmailDispatch} from '../lib/communications/platform-email-preview.js';
import {reconcileStaleSandboxEmailClaims} from '../lib/communications/platform-email-queue.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_ENABLED:'true',PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox',
 PLATFORM_COMMUNICATIONS_TEST_EMAILS:'tester@example.test',
 PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT:'brevo_sandbox',
 PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_STOP:'false',
 PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK:'I_APPROVE_STAGING_SANDBOX_WORKER',
 PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'1',
 BREVO_API_KEY:'fake-test-key',BREVO_FROM_EMAIL:'sender@example.test'
};

async function sandboxDb(){
 const file=path.join(os.tmpdir(),`gastroflow_sandbox_email_${crypto.randomUUID()}.db`);
 const store=await createLibsqlStore({url:`file:${file}`});
 const execute=(sql,args=[])=>store.execute(sql,args);
 const dbRun=execute;
 const dbAll=async(sql,args=[])=>(await execute(sql,args)).rows;
 const dbGet=async(sql,args=[])=>((await execute(sql,args)).rows[0]||null);
 try{
  for(const sql of [
   'CREATE TABLE tenants (id TEXT PRIMARY KEY,status TEXT NOT NULL)',
   'CREATE TABLE users (id TEXT NOT NULL,tenant_id TEXT NOT NULL,role TEXT NOT NULL,email TEXT NOT NULL)',
   'CREATE TABLE platform_ownership (userId TEXT)',
   'CREATE TABLE platform_owner_announcements (id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,expiresAt BIGINT)',
   'CREATE TABLE platform_owner_announcement_recipients (announcementId TEXT,tenant_id TEXT,userId TEXT)',
   `CREATE TABLE platform_owner_communication_email_queue (
     announcementId TEXT,tenant_id TEXT,userId TEXT,email TEXT,status TEXT,
     attemptCount INTEGER,nextAttemptAt BIGINT,lastAttemptAt BIGINT,
     updatedAt BIGINT,deliveredAt BIGINT,lastErrorCode TEXT,
     createdAt BIGINT,PRIMARY KEY(announcementId,tenant_id,userId))`,
   `CREATE TABLE platform_owner_communication_email_receipts (
     provider TEXT,providerMessageId TEXT,announcementId TEXT,tenant_id TEXT,userId TEXT,
     eventStatus TEXT,acceptedAt BIGINT,eventAt BIGINT,updatedAt BIGINT,
     PRIMARY KEY(provider,providerMessageId))`,
   'CREATE TABLE platform_owner_email_sandbox_quota (quotaDay TEXT PRIMARY KEY,reservedCount INTEGER NOT NULL DEFAULT 0,updatedAt BIGINT NOT NULL)'
  ])await dbRun(sql);
  await dbRun("INSERT INTO tenants VALUES ('tenant_a','active')");
  await dbRun("INSERT INTO users VALUES ('owner_a','tenant_a','owner','tester@example.test')");
 }catch(e){store.close();throw e}
 const addNotice=async(id,now)=>{
  await dbRun('INSERT INTO platform_owner_announcements VALUES (?,?,?,?,NULL)',[id,'Sandbox notice','Safe test body','published']);
  await dbRun('INSERT INTO platform_owner_announcement_recipients VALUES (?,?,?)',[id,'tenant_a','owner_a']);
  await dbRun(`INSERT INTO platform_owner_communication_email_queue
   (announcementId,tenant_id,userId,email,status,attemptCount,nextAttemptAt,createdAt,updatedAt)
   VALUES (?,?,?,'tester@example.test','pending',0,?,?,?)`,[id,'tenant_a','owner_a',now-10,now-10,now-10]);
 };
 return {dbAll,dbGet,dbRun,addNotice,close:()=>{
  store.close();
  for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});
 }};
}
describe('sandbox worker against isolated local libSQL, no Brevo network',()=>{
 it('commits one send and exhausts the shared UTC quota for a different announcement',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('notice_1',now);
   await db.addNotice('notice_2',now);
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'fake-provider-message-1'})}));
   const first=await runSandboxEmailWorkerTick({...db,env,announcementId:'notice_1',now,fetcher});
   expect(first).toMatchObject({started:true,attempted:1,mailboxDelivered:false});
   const second=await runSandboxEmailWorkerTick({...db,env,announcementId:'notice_2',now,fetcher});
   expect(second).toMatchObject({started:false,reason:'DAILY_QUOTA_EXHAUSTED'});
   expect(fetcher).toHaveBeenCalledTimes(1);
   const day=new Date(now).toISOString().slice(0,10);
   expect((await db.dbGet('SELECT reservedCount FROM platform_owner_email_sandbox_quota WHERE quotaDay=?',[day])).reservedCount).toBe(1);
   expect((await db.dbGet("SELECT status,deliveredAt FROM platform_owner_communication_email_queue WHERE announcementId='notice_1'")))
     .toMatchObject({status:'accepted',deliveredAt:null});
   expect((await db.dbGet("SELECT status FROM platform_owner_communication_email_queue WHERE announcementId='notice_2'")).status).toBe('pending');
  }finally{db.close()}
 });
 it('records accepted provider message then a verified bounce and blocks later email',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('notice_original',now);
   await db.addNotice('notice_followup',now);
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'fake-brevo-accepted-1'})}));
   const result=await runSandboxEmailWorkerTick({...db,env,announcementId:'notice_original',now,fetcher});
   expect(result).toMatchObject({started:true,attempted:1});
   expect((await db.dbGet(`SELECT eventStatus FROM platform_owner_communication_email_receipts
     WHERE providerMessageId='fake-brevo-accepted-1'`)).eventStatus).toBe('accepted');
   const event={
     messageId:'fake-brevo-accepted-1',event:'hard_bounce',
     email:'tester@example.test',timestamp:now+1000
   };
   const recorded=await recordVerifiedBrevoEvent({...db,event,env,verified:true,now:now+1000});
   expect(recorded).toEqual({recorded:true,reason:'UPDATED'});
   const preview=await previewSandboxOwnerEmailDispatch({
     ...db,env,announcementId:'notice_followup',now:now+2000
   });
   expect(preview.eligible).toBe(0);
   expect(preview.reasons).toContainEqual({code:'provider_suppressed',count:1});
   const second=await runSandboxEmailWorkerTick({
     ...db,env,announcementId:'notice_followup',now:now+2000,fetcher
   });
   expect(second).toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{db.close()}
 });
 it('cannot record a provider event for a different email or unknown message',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('notice_1',now);
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'fake-brevo-accepted-2'})}));
   await runSandboxEmailWorkerTick({...db,env,announcementId:'notice_1',now,fetcher});
   const mismatch=await recordVerifiedBrevoEvent({...db,env,verified:true,now:now+500,
     event:{messageId:'fake-brevo-accepted-2',event:'delivered',email:'other@example.test',timestamp:now+500}});
   expect(mismatch).toMatchObject({recorded:false,reason:'RECIPIENT_MISMATCH'});
   const unknown=await recordVerifiedBrevoEvent({...db,env,verified:true,now:now+501,
     event:{messageId:'missing-message',event:'delivered',email:'tester@example.test',timestamp:now+501}});
   expect(unknown).toMatchObject({recorded:false,reason:'UNKNOWN_MESSAGE'});
   expect((await db.dbGet(`SELECT eventStatus FROM platform_owner_communication_email_receipts
     WHERE providerMessageId='fake-brevo-accepted-2'`)).eventStatus).toBe('accepted');
  }finally{db.close()}
 });
 it('serializes competing worker quota reservations on the same local database',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('parallel_a',now);
   await db.addNotice('parallel_b',now);
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'fake-concurrent-accepted'})}));
   const results=await Promise.all([
     runSandboxEmailWorkerTick({...db,env,announcementId:'parallel_a',now,fetcher}),
     runSandboxEmailWorkerTick({...db,env,announcementId:'parallel_b',now,fetcher})
   ]);
   expect(results.filter(x=>x.started===true)).toHaveLength(1);
   expect(results.filter(x=>x.reason==='DAILY_QUOTA_EXHAUSTED')).toHaveLength(1);
   expect(fetcher).toHaveBeenCalledTimes(1);
   const day=new Date(now).toISOString().slice(0,10);
   expect((await db.dbGet('SELECT reservedCount FROM platform_owner_email_sandbox_quota WHERE quotaDay=?',[day])).reservedCount).toBe(1);
  }finally{db.close()}
 });
 it('never accepts a second job that receives an already-used Brevo provider ID',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('first_id',now);
   await db.addNotice('second_id',now);
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageId:'repeated-provider-id'})}));
   const twoPermitted={...env,PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP:'2'};
   const first=await runSandboxEmailWorkerTick({...db,env:twoPermitted,announcementId:'first_id',now,fetcher});
   const second=await runSandboxEmailWorkerTick({...db,env:twoPermitted,announcementId:'second_id',now:now+1000,fetcher});
   expect(first).toMatchObject({started:true,attempted:1});
   expect(second).toMatchObject({started:true,attempted:1});
   expect((await db.dbGet("SELECT status FROM platform_owner_communication_email_queue WHERE announcementId='first_id'")).status).toBe('accepted');
   expect((await db.dbGet("SELECT status,lastErrorCode FROM platform_owner_communication_email_queue WHERE announcementId='second_id'")))
     .toMatchObject({status:'manual_review',lastErrorCode:'DELIVERY_UNCONFIRMED'});
   expect((await db.dbGet("SELECT COUNT(*) AS n FROM platform_owner_communication_email_receipts")).n).toBe(1);
   const another=await runSandboxEmailWorkerTick({...db,env:twoPermitted,announcementId:'second_id',now:now+2000,fetcher});
   expect(another).toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{db.close()}
 });
 it('retains an ambiguous failure for manual review and never retries the provider',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('uncertain',now);
   const fetcher=vi.fn(async()=>{throw new Error('injected provider timeout')});
   const result=await runSandboxEmailWorkerTick({...db,env,announcementId:'uncertain',now,fetcher});
   expect(result).toMatchObject({started:true,attempted:1,mailboxDelivered:false});
   expect(fetcher).toHaveBeenCalledTimes(1);
   const row=await db.dbGet("SELECT status,lastErrorCode,attemptCount FROM platform_owner_communication_email_queue WHERE announcementId='uncertain'");
   expect(row).toMatchObject({status:'manual_review',lastErrorCode:'DELIVERY_UNCONFIRMED',attemptCount:1});
   const retry=await runSandboxEmailWorkerTick({...db,env,announcementId:'uncertain',now:now+2000,fetcher});
   expect(retry).toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{db.close()}
 });
 it('moves stale sending claims into manual review without resending',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('interrupted',now);
   await db.dbRun("UPDATE platform_owner_communication_email_queue SET status='sending',attemptCount=1,lastAttemptAt=? WHERE announcementId='interrupted'",[now-40*60_000]);
   const result=await reconcileStaleSandboxEmailClaims({...db,env,now,staleAfterMs:15*60_000});
   expect(result).toEqual({disabled:false,reviewRequired:1});
   expect((await db.dbGet("SELECT status,lastErrorCode FROM platform_owner_communication_email_queue WHERE announcementId='interrupted'")))
     .toMatchObject({status:'manual_review',lastErrorCode:'STALE_SENDING_UNCONFIRMED'});
   const fetcher=vi.fn();
   expect((await runSandboxEmailWorkerTick({...db,env,announcementId:'interrupted',now,fetcher})).started).toBe(false);
   expect(fetcher).not.toHaveBeenCalled();
  }finally{db.close()}
 });
 it('honors verified provider suppression before reserving daily quota',async()=>{
  const db=await sandboxDb();
  try{
   const now=Date.now();
   await db.addNotice('previous',now);
   await db.addNotice('notice_2',now);
   await db.dbRun(`INSERT INTO platform_owner_communication_email_receipts
     (provider,providerMessageId,announcementId,tenant_id,userId,eventStatus,acceptedAt,eventAt,updatedAt)
     VALUES ('brevo','previous-message','previous','tenant_a','owner_a','unsubscribed',?,?,?)`,[now-500,now-100,now-100]);
   const fetcher=vi.fn();
   const outcome=await runSandboxEmailWorkerTick({...db,env,announcementId:'notice_2',now,fetcher});
   expect(outcome).toMatchObject({started:false,reason:'PREVIEW_NOT_SINGLE_ELIGIBLE'});
   expect(fetcher).not.toHaveBeenCalled();
   expect((await db.dbGet('SELECT COUNT(*) AS n FROM platform_owner_email_sandbox_quota')).n).toBe(0);
  }finally{db.close()}
 });
});
