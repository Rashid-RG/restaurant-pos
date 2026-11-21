import {describe,it,expect,vi} from 'vitest';
import {createLibsqlStore} from '../lib/libsql-store.js';
import {encryptBoundFcmToken} from '../lib/communications/platform-fcm-token-registry.js';
import {dispatchOneStagingOwnerNotice} from '../lib/communications/platform-owner-fcm-dispatch.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const {privateKey}=crypto.generateKeyPairSync('rsa',{
 modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},
 publicKeyEncoding:{type:'spki',format:'pem'}
});
const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'staging-integration-test-hmac-1234567890',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:crypto.randomBytes(32).toString('base64'),
 PLATFORM_COMMUNICATIONS_FCM_PROJECT_ID:'gastroflow-staging',
 PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL:'sender@gastroflow-staging.iam.gserviceaccount.com',
 PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY:privateKey,
 PLATFORM_COMMUNICATIONS_FCM_SEND_ENABLED:'true',PLATFORM_COMMUNICATIONS_FCM_STOP:'false',
 PLATFORM_COMMUNICATIONS_FCM_ACK:'I_APPROVE_STAGING_FCM_SANDBOX',
 PLATFORM_COMMUNICATIONS_FCM_DISPATCH_ENABLED:'true'
};
const now=1795200000000, deviceHash='a'.repeat(64);
const token='fake_Test_Android_token_123456789012345';
async function dbFixture(){
 const file=path.join(os.tmpdir(),`gastroflow_fcm_dispatch_${crypto.randomUUID()}.db`);
 const store=await createLibsqlStore({url:`file:${file}`});
 const dbRun=(sql,args=[])=>store.execute(sql,args);
 const dbGet=async(sql,args=[])=>((await store.execute(sql,args)).rows[0]||null);
 try{
  for(const sql of [
   'CREATE TABLE platform_owner_announcements (id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,expiresAt BIGINT)',
   'CREATE TABLE platform_owner_announcement_recipients (announcementId TEXT,tenant_id TEXT,userId TEXT)',
   'CREATE TABLE tenants (id TEXT PRIMARY KEY,status TEXT)',
   'CREATE TABLE users (id TEXT,tenant_id TEXT,role TEXT)',
   'CREATE TABLE platform_ownership (userId TEXT)',
   'CREATE TABLE platform_owner_communication_push_preferences (tenant_id TEXT,userId TEXT,optedIn INTEGER)',
   'CREATE TABLE platform_owner_communication_devices (tenant_id TEXT,userId TEXT,deviceHash TEXT,platform TEXT,revokedAt BIGINT)',
   'CREATE TABLE platform_owner_communication_fcm_tokens (tenant_id TEXT,userId TEXT,deviceHash TEXT,tokenHash TEXT,cipherText TEXT,cipherIv TEXT,cipherTag TEXT,revokedAt BIGINT)',
   `CREATE TABLE platform_owner_communication_fcm_dispatch (
     announcementId TEXT NOT NULL,tenant_id TEXT NOT NULL,userId TEXT NOT NULL,
     deviceHash TEXT NOT NULL,status TEXT NOT NULL,claimedAt BIGINT NOT NULL,
     updatedAt BIGINT NOT NULL,PRIMARY KEY(announcementId,tenant_id,userId,deviceHash))`
  ])await dbRun(sql);
  await dbRun("INSERT INTO platform_owner_announcements VALUES ('notice_a','Notice to owner','Review the policy update','published',NULL)");
  await dbRun("INSERT INTO platform_owner_announcement_recipients VALUES ('notice_a','tenant_a','owner_a')");
  await dbRun("INSERT INTO tenants VALUES ('tenant_a','active')");
  await dbRun("INSERT INTO users VALUES ('owner_a','tenant_a','owner')");
  await dbRun("INSERT INTO platform_owner_communication_push_preferences VALUES ('tenant_a','owner_a',1)");
  await dbRun("INSERT INTO platform_owner_communication_devices VALUES ('tenant_a','owner_a',?,'android',NULL)",[deviceHash]);
  const record=encryptBoundFcmToken({env,token,tenantId:'tenant_a',userId:'owner_a',deviceHash});
  await dbRun("INSERT INTO platform_owner_communication_fcm_tokens VALUES ('tenant_a','owner_a',?,?,?,?,?,NULL)",
    [deviceHash,record.tokenHash,record.cipherText,record.cipherIv,record.cipherTag]);
 }catch(e){store.close();throw e}
 return {dbRun,dbGet,close:()=>{
   store.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});
 }};
}
describe('local libSQL owner FCM dispatch: no external network',()=>{
 it('claims once per notice/device and never sends to a different tenant',async()=>{
  const db=await dbFixture();
  try{
   const fetcher=vi.fn()
    .mockResolvedValueOnce({ok:true,json:async()=>({access_token:'fake-firebase-oauth-access'})})
    .mockResolvedValueOnce({ok:true,json:async()=>({name:'projects/gastroflow-staging/messages/test-id'})});
   const base={...db,env,now,fetcher,announcementId:'notice_a',tenantId:'tenant_a',userId:'owner_a',deviceHash};
   expect(await dispatchOneStagingOwnerNotice({...base,tenantId:'tenant_b'}))
    .toMatchObject({started:false,reason:'RECIPIENT_INELIGIBLE'});
   const first=await dispatchOneStagingOwnerNotice(base);
   expect(first).toEqual({started:true,accepted:true,deviceDelivered:false});
   expect(fetcher).toHaveBeenCalledTimes(2);
   expect((await db.dbGet("SELECT status FROM platform_owner_communication_fcm_dispatch WHERE announcementId='notice_a'")).status)
    .toBe('accepted');
   expect(await dispatchOneStagingOwnerNotice(base))
    .toMatchObject({started:false,reason:'ALREADY_CLAIMED_OR_INELIGIBLE'});
   expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{db.close()}
 });
 it('refuses opted-out device and does not create a claim',async()=>{
  const db=await dbFixture();
  try{
   await db.dbRun("UPDATE platform_owner_communication_push_preferences SET optedIn=0 WHERE tenant_id='tenant_a'");
   const fetcher=vi.fn();
   expect(await dispatchOneStagingOwnerNotice({
    ...db,env,now,fetcher,announcementId:'notice_a',
    tenantId:'tenant_a',userId:'owner_a',deviceHash
   })).toMatchObject({started:false,reason:'RECIPIENT_INELIGIBLE'});
   expect(fetcher).not.toHaveBeenCalled();
   expect((await db.dbGet('SELECT COUNT(*) AS n FROM platform_owner_communication_fcm_dispatch')).n).toBe(0);
  }finally{db.close()}
 });
});
