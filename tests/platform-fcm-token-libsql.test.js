import {describe,it,expect} from 'vitest';
import {createLibsqlStore} from '../lib/libsql-store.js';
import {
  registerOwnerFcmToken,revokeOwnerFcmToken,decryptBoundFcmToken
} from '../lib/communications/platform-fcm-token-registry.js';
import {digestOwnerInstallation} from '../lib/communications/platform-push-enrollment.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env={
 PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_STAGE:'staging',
 PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED:'true',
 PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY:'fixture-device-hmac-secret-staging-1234567890',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_ENROLLMENT_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY:crypto.randomBytes(32).toString('base64')
};
const installA='1530ac0b-02f0-4ae5-a132-2056ab4bd660';
const installB='1530ac0b-02f0-4ae5-a132-2056ab4bd661';
const token='fake_FCM_token_12345678901234567890';
async function localDb(){
  const file=path.join(os.tmpdir(),`gastroflow_fcm_${crypto.randomUUID()}.db`);
  const store=await createLibsqlStore({url:`file:${file}`});
  const dbRun=(sql,args=[])=>store.execute(sql,args);
  const dbGet=async(sql,args=[])=>((await store.execute(sql,args)).rows[0]||null);
  await dbRun(`CREATE TABLE platform_owner_communication_devices (
    tenant_id TEXT NOT NULL,userId TEXT NOT NULL,deviceHash TEXT NOT NULL,
    platform TEXT NOT NULL,registeredAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL,
    revokedAt BIGINT,PRIMARY KEY(tenant_id,userId,deviceHash),UNIQUE(deviceHash))`);
  await dbRun(`CREATE TABLE platform_owner_communication_fcm_tokens (
    tenant_id TEXT NOT NULL,userId TEXT NOT NULL,deviceHash TEXT NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,cipherText TEXT NOT NULL,cipherIv TEXT NOT NULL,
    cipherTag TEXT NOT NULL,registeredAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL,
    revokedAt BIGINT,PRIMARY KEY(tenant_id,userId,deviceHash))`);
  for(const [tenant,user,installation] of [
    ['tenant_a','owner_a',installA],['tenant_b','owner_b',installB]
  ])await dbRun(`INSERT INTO platform_owner_communication_devices
    (tenant_id,userId,deviceHash,platform,registeredAt,updatedAt)
    VALUES (?,?,?,'android',1,1)`,
    [tenant,user,digestOwnerInstallation(installation,env)]);
  return {dbRun,dbGet,close:()=>{
    store.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});
  }};
}
describe('isolated libSQL encrypted FCM token registration',()=>{
  it('stores encrypted token for exactly one owner and rejects cross-tenant reuse',async()=>{
    const db=await localDb();
    try{
      const first=await registerOwnerFcmToken({
        ...db,tenantId:'tenant_a',userId:'owner_a',input:{installationId:installA,token},env,now:100
      });
      expect(first).toMatchObject({status:'registered',pushOperational:false});
      const row=await db.dbGet('SELECT * FROM platform_owner_communication_fcm_tokens');
      expect(JSON.stringify(row)).not.toContain(token);
      const plain=decryptBoundFcmToken({
        record:row,tenantId:'tenant_a',userId:'owner_a',deviceHash:row.deviceHash,env
      });
      expect(plain).toBe(token);
      const duplicate=await registerOwnerFcmToken({
        ...db,tenantId:'tenant_b',userId:'owner_b',input:{installationId:installB,token},env,now:101
      });
      expect(duplicate.status).toBe('token_already_bound');
      const count=await db.dbGet('SELECT COUNT(*) AS total FROM platform_owner_communication_fcm_tokens');
      expect(count.total).toBe(1);
      const revoke=await revokeOwnerFcmToken({
        ...db,tenantId:'tenant_b',userId:'owner_b',installationId:installA,env,now:102
      });
      expect(revoke.status).toBe('not_found');
      expect((await db.dbGet('SELECT revokedAt FROM platform_owner_communication_fcm_tokens')).revokedAt).toBeNull();
      expect((await revokeOwnerFcmToken({
        ...db,tenantId:'tenant_a',userId:'owner_a',installationId:installA,env,now:103
      })).status).toBe('revoked');
      expect((await db.dbGet('SELECT revokedAt FROM platform_owner_communication_fcm_tokens')).revokedAt).toBe(103);
    }finally{db.close()}
  });
});
