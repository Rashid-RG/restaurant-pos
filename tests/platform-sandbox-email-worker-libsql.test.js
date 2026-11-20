import {describe,it,expect,vi} from 'vitest';
import {createLibsqlStore} from '../lib/libsql-store.js';
import {runSandboxEmailWorkerTick} from '../lib/communications/platform-sandbox-email-worker.js';
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
