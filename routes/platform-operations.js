import express from 'express';
import crypto from 'node:crypto';
import {captureSnapshot} from '../lib/snapshots.js';
export async function initPlatformOperations(dbRun){
 await dbRun('CREATE TABLE IF NOT EXISTS platform_support_sessions (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actorId TEXT NOT NULL,reason TEXT NOT NULL,createdAt BIGINT NOT NULL,expiresAt BIGINT NOT NULL,revokedAt BIGINT)');
 await dbRun('CREATE TABLE IF NOT EXISTS platform_access_audit (id TEXT PRIMARY KEY,actorId TEXT NOT NULL,tenant_id TEXT NOT NULL,action TEXT NOT NULL,resourceId TEXT,reason TEXT NOT NULL,createdAt BIGINT NOT NULL)');
 for(const action of ['UPDATE','DELETE'])await dbRun(`CREATE TRIGGER IF NOT EXISTS platform_audit_no_${action.toLowerCase()} BEFORE ${action} ON platform_access_audit BEGIN SELECT RAISE(ABORT,'Platform access audit is append-only'); END`);
}
export function createPlatformOperations({dbAll,dbGet,dbRun,authenticateToken,requirePlatformAdmin}){
 const router=express.Router();router.use('/platform',authenticateToken,requirePlatformAdmin);
 const audit=(req,tenant,action,reason,resource)=>dbRun('INSERT INTO platform_access_audit (id,actorId,tenant_id,action,resourceId,reason,createdAt) VALUES (?,?,?,?,?,?,?)',[crypto.randomUUID(),req.user.id,tenant,action,resource||null,reason,Date.now()]);
 router.post('/platform/support-sessions',async(req,res,next)=>{try{
  const {tenantId,reason}=req.body||{};if(typeof reason!=='string'||reason.trim().length<10||reason.length>1000)return res.status(400).json({error:'Record a support reason of 10-1000 characters.'});
  const tenant=await dbGet('SELECT id FROM tenants WHERE id=?',[tenantId]);if(!tenant)return res.status(404).json({error:'Restaurant not found.'});
  const session={id:crypto.randomUUID(),tenantId,expiresAt:Date.now()+15*60*1000};
  await dbRun('INSERT INTO platform_support_sessions (id,tenant_id,actorId,reason,createdAt,expiresAt) VALUES (?,?,?,?,?,?)',[session.id,tenantId,req.user.id,reason.trim(),Date.now(),session.expiresAt]);
  await audit(req,tenantId,'support_session_started',reason.trim(),session.id);res.status(201).json(session);
 }catch(e){next(e)}});
 router.get('/platform/support-sessions/:id/snapshot',async(req,res,next)=>{try{
  const session=await dbGet('SELECT * FROM platform_support_sessions WHERE id=? AND actorId=? AND revokedAt IS NULL AND expiresAt>?',[req.params.id,req.user.id,Date.now()]);
  if(!session)return res.status(404).json({error:'Support session unavailable or expired.'});
  await audit(req,session.tenant_id,'support_snapshot_read',session.reason,session.id);
  const tenant=await dbGet('SELECT id,name,plan,status FROM tenants WHERE id=?',[session.tenant_id]);
  const orders=await dbAll('SELECT id,status,paymentStatus,total,timestamp FROM orders WHERE tenant_id=? ORDER BY timestamp DESC LIMIT 20',[session.tenant_id]);
  res.set('Cache-Control','no-store').json({tenant,orders,readOnly:true,expiresAt:session.expiresAt});
 }catch(e){next(e)}});
 router.delete('/platform/support-sessions/:id',async(req,res,next)=>{try{
  const session=await dbGet('SELECT * FROM platform_support_sessions WHERE id=? AND actorId=?',[req.params.id,req.user.id]);if(!session)return res.status(404).json({error:'Session not found.'});
  await dbRun('UPDATE platform_support_sessions SET revokedAt=? WHERE id=?',[Date.now(),session.id]);await audit(req,session.tenant_id,'support_session_ended',session.reason,session.id);res.json({success:true});
 }catch(e){next(e)}});
 router.get('/platform/access-audit',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await dbAll('SELECT * FROM platform_access_audit ORDER BY createdAt DESC LIMIT 200'));}catch(e){next(e)}});
 router.get('/platform/finance',async(req,res,next)=>{let open=false;try{
  const end=req.query.to?Number(req.query.to):Date.now();const start=req.query.from?Number(req.query.from):end-30*86400000;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>366*86400000)return res.status(400).json({error:'Use a valid reporting range of up to 366 days.'});
  await dbRun('BEGIN TRANSACTION');open=true;
  const tenants=await dbAll('SELECT id,name FROM tenants ORDER BY name');const rows=[];
  for(const tenant of tenants){
   const paid=await dbGet("SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS total FROM orders WHERE tenant_id=? AND (paymentStatus='paid' OR status='paid') AND COALESCE(paymentTimestamp,timestamp)>=? AND COALESCE(paymentTimestamp,timestamp)<?",[tenant.id,start,end]);
   const refunds=await dbGet('SELECT COALESCE(SUM(amountCents),0) AS cents FROM refund_transactions WHERE tenant_id=? AND createdAt>=? AND createdAt<?',[tenant.id,start,end]);
   const grossCents=Math.round(Number(paid.total)*100),refundCents=Number(refunds.cents);rows.push({...tenant,paidOrders:paid.count,grossCents,refundCents,netRecordedCents:grossCents-refundCents});
  }
  await audit(req,'default_tenant','platform_finance_read','Platform financial reconciliation');
  await dbRun('COMMIT');open=false;
  res.set('Cache-Control','no-store').json({from:start,to:end,currency:'LKR',restaurants:rows,note:'Recorded collections less cash refunds; not restaurant profit, provider settlement or a payout instruction.'});
 }catch(e){if(open)await dbRun('ROLLBACK');next(e)}});
 router.post('/platform/backups',async(req,res,next)=>{try{
  const reason=req.body?.reason;if(typeof reason!=='string'||reason.trim().length<10)return res.status(400).json({error:'Provide a backup reason.'});
  await audit(req,'default_tenant','backup_export',reason.trim());const snapshot=await captureSnapshot({dbAll,dbRun});
  res.set('Cache-Control','no-store').set('Content-Disposition','attachment; filename="gastroflow-backup.json"').json(snapshot);
 }catch(e){next(e)}});
 router.get('/platform/readiness',async(req,res,next)=>{try{
  await dbGet('SELECT 1 AS ok');
  res.set('Cache-Control','no-store').json({database:'connected',payments:process.env.PAYHERE_ENABLED==='false'?'disabled':'requires_provider_verification',subscriptionBilling:process.env.SAAS_BILLING_ENABLED==='true'?'configured_requires_provider_test':'disabled',notifications:'provider_delivery_not_verified',printers:'hardware_not_verified',backups:'restore_drill_required',tracking:'browser_foreground_only'});
 }catch(e){next(e)}});
 return router;
}
