/**
 * GastroFlow Platform Communication Center - owner-targeted in-app delivery.
 * Feature-gated: PLATFORM_COMMUNICATIONS_ENABLED=true on isolated staging only.
 * No outbound email/push is sent from this module.
 */
import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { enqueueSandboxOwnerEmails, sandboxEmailConfig, reconcileStaleSandboxEmailClaims, closeSandboxEmailReview } from '../lib/communications/platform-email-queue.js';
import { previewSandboxOwnerEmailDispatch } from '../lib/communications/platform-email-preview.js';
import { sandboxBrevoReady } from '../lib/communications/platform-brevo-sandbox.js';

const audienceSchema=z.object({
  scope:z.enum(['all','specific']).default('all'),
  tenantIds:z.array(z.string().min(1).max(180)).max(500).default([])
}).strict().refine(x=>x.scope!=='specific'||x.tenantIds.length>0, 'Select restaurants.');
const translationsSchema=z.object({
  si:z.object({title:z.string().trim().min(3).max(140),body:z.string().trim().min(5).max(10000)}).strict().optional(),
  ta:z.object({title:z.string().trim().min(3).max(140),body:z.string().trim().min(5).max(10000)}).strict().optional()
}).strict().default({});
export function announcementLanguage(value){
  return ['en','si','ta'].includes(value)?value:'en';
}
const policyVersionSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const messageSchema=z.object({
  title:z.string().trim().min(3).max(140),
  body:z.string().trim().min(5).max(10000),
  category:z.enum(['announcement','urgent','maintenance','policy','disclaimer','feature']).default('announcement'),
  requiresAcknowledgment:z.boolean().default(false),
  expiresAt:z.number().int().positive().nullable().default(null),
  audience:audienceSchema,
  translations:translationsSchema,
  policyVersion:policyVersionSchema.nullable().optional()
}).strict().superRefine((m,ctx)=>{
  if(['policy','disclaimer'].includes(m.category)&&!m.policyVersion)ctx.addIssue({code:'custom',path:['policyVersion'],message:'Policy and disclaimer notices require an immutable version.'});
  if(['policy','disclaimer'].includes(m.category)&&!m.requiresAcknowledgment)ctx.addIssue({code:'custom',path:['requiresAcknowledgment'],message:'Policy and disclaimer notices require acknowledgment.'});
});

const templateSchema=z.object({
  name:z.string().trim().min(2).max(100),
  title:z.string().trim().min(3).max(140),
  body:z.string().trim().min(5).max(10000),
  category:z.enum(['announcement','urgent','maintenance','policy','disclaimer','feature']).default('announcement'),
  requiresAcknowledgment:z.boolean().default(false)
}).strict();

export function validateOwnerAudience(input){ return audienceSchema.safeParse(input); }
export function ownerRecipientEligible(row){
  return Boolean(row?.userId && row?.tenantId && row?.role==='owner' && row?.status==='active' && !row?.isPlatformAdmin);
}
export function safeOwnerScope(user,tenantId){
  return Boolean(user && user.id && user.role==='owner' && user.tenant_id && user.tenant_id===tenantId && !user.isPlatformAdmin);
}

export async function initPlatformCommunications(dbRun) {
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
    requiresAcknowledgment INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
    audienceJson TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt BIGINT NOT NULL,
    publishedAt BIGINT, expiresAt BIGINT, cancelledAt BIGINT)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_recipients (
    announcementId TEXT NOT NULL, tenant_id TEXT NOT NULL, userId TEXT NOT NULL,
    deliveredAt BIGINT NOT NULL, readAt BIGINT, acknowledgedAt BIGINT,
    PRIMARY KEY (announcementId,tenant_id,userId))`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_owner_announcements_inbox
    ON platform_owner_announcement_recipients (tenant_id,userId,deliveredAt)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_communication_email_queue (
    announcementId TEXT NOT NULL, tenant_id TEXT NOT NULL,userId TEXT NOT NULL,
    email TEXT NOT NULL,status TEXT NOT NULL,attemptCount INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt BIGINT NOT NULL,lastAttemptAt BIGINT,deliveredAt BIGINT,
    lastErrorCode TEXT,createdAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL,
    PRIMARY KEY (announcementId,tenant_id,userId))`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_owner_email_pending
    ON platform_owner_communication_email_queue (status,nextAttemptAt)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_communication_deliveries (
    announcementId TEXT NOT NULL, tenant_id TEXT NOT NULL, userId TEXT NOT NULL,
    channel TEXT NOT NULL, status TEXT NOT NULL, attemptCount INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt BIGINT, lastAttemptAt BIGINT, lastErrorCode TEXT,
    deliveredAt BIGINT, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL,
    PRIMARY KEY (announcementId,tenant_id,userId,channel))`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_owner_delivery_pending
    ON platform_owner_communication_deliveries (channel,status,nextAttemptAt)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_schedule (
    announcementId TEXT PRIMARY KEY, scheduledAt BIGINT NOT NULL, createdBy TEXT NOT NULL,
    createdAt BIGINT NOT NULL)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_owner_schedule_due ON platform_owner_announcement_schedule (scheduledAt)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_communication_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT NOT NULL, requiresAcknowledgment INTEGER NOT NULL DEFAULT 0,
    createdBy TEXT NOT NULL, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_translations (
    announcementId TEXT NOT NULL,locale TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,
    createdAt BIGINT NOT NULL,PRIMARY KEY (announcementId,locale))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_translation_approvals (
    announcementId TEXT NOT NULL,locale TEXT NOT NULL,contentHash TEXT NOT NULL,
    reviewedBy TEXT NOT NULL,reviewedAt BIGINT NOT NULL,
    PRIMARY KEY (announcementId,locale))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_communication_push_preferences (
    tenant_id TEXT NOT NULL,userId TEXT NOT NULL,optedIn INTEGER NOT NULL DEFAULT 0,
    updatedAt BIGINT NOT NULL,PRIMARY KEY (tenant_id,userId))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_acknowledgment_evidence (
    announcementId TEXT NOT NULL,tenant_id TEXT NOT NULL,userId TEXT NOT NULL,
    contentLanguage TEXT NOT NULL,contentHash TEXT NOT NULL,
    policyVersion TEXT,acknowledgedAt BIGINT NOT NULL,
    PRIMARY KEY (announcementId,tenant_id,userId))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_versions (
    announcementId TEXT PRIMARY KEY, policyVersion TEXT NOT NULL,
    contentHash TEXT NOT NULL, createdAt BIGINT NOT NULL)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_audit (
    id TEXT PRIMARY KEY, announcementId TEXT NOT NULL, actorId TEXT NOT NULL,
    action TEXT NOT NULL, createdAt BIGINT NOT NULL)`);
}

/**
 * Scheduled notices are claimed from durable DB state, not in-memory timers.
 * Intended to run from the staging server after database readiness.
 * No email or external push side effects are performed here.
 */
export async function dispatchDueOwnerAnnouncements({dbGet,dbAll,dbRun,now=Date.now(),limit=10}){
  const bounded=Math.min(25,Math.max(1,Number(limit)||10));
  const due=await dbAll(`SELECT a.id,a.audienceJson,a.expiresAt,a.status,s.scheduledAt
    FROM platform_owner_announcements a
    JOIN platform_owner_announcement_schedule s ON s.announcementId=a.id
    WHERE a.status='scheduled' AND s.scheduledAt<=?
    ORDER BY s.scheduledAt LIMIT ${bounded}`,[now]);
  const results=[];
  for(const candidate of due){
    let tx=false;
    try{
      await dbRun('BEGIN TRANSACTION');tx=true;
      const a=await dbGet('SELECT status,audienceJson,expiresAt FROM platform_owner_announcements WHERE id=?',[candidate.id]);
      if(a?.status!=='scheduled'){await dbRun('ROLLBACK');tx=false;continue}
      if(a.expiresAt!==null && a.expiresAt<=now){
        await dbRun("UPDATE platform_owner_announcements SET status='cancelled',cancelledAt=? WHERE id=? AND status='scheduled'",[now,candidate.id]);
        await dbRun('DELETE FROM platform_owner_announcement_schedule WHERE announcementId=?',[candidate.id]);
        await dbRun('COMMIT');tx=false;
        results.push({id:candidate.id,status:'expired'});continue;
      }
      const target=JSON.parse(a.audienceJson);
      const ids=[...new Set(target.tenantIds||[])];
      if(target.scope==='specific'&&!ids.length)throw new Error('Scheduled notice has no selected restaurants.');
      const sql=`SELECT u.id AS userId,u.tenant_id AS tenantId,u.role,t.status,
        CASE WHEN p.userId IS NOT NULL THEN 1 ELSE 0 END AS isPlatformAdmin
        FROM users u JOIN tenants t ON t.id=u.tenant_id
        LEFT JOIN platform_ownership p ON p.userId=u.id
        WHERE u.role='owner' AND t.status='active' AND t.id!='default_tenant'
        ${target.scope==='specific'?`AND t.id IN (${ids.map(()=>'?').join(',')})`:''}`;
      const rows=(await dbAll(sql,target.scope==='specific'?ids:[])).filter(ownerRecipientEligible);
      if(!rows.length){
        // Keep it queued; the owner may reactivate a restaurant or fix targeting.
        await dbRun('ROLLBACK');tx=false;
        results.push({id:candidate.id,status:'no_eligible_owners'});continue;
      }
      const at=Date.now();
      for(const row of rows){
        await dbRun(`INSERT OR IGNORE INTO platform_owner_announcement_recipients
          (announcementId,tenant_id,userId,deliveredAt) VALUES (?,?,?,?)`,[candidate.id,row.tenantId,row.userId,at]);
        await recordOwnerInboxDelivery(dbRun,{announcementId:candidate.id,tenantId:row.tenantId,userId:row.userId,at});
      }
      await dbRun("UPDATE platform_owner_announcements SET status='published',publishedAt=? WHERE id=? AND status='scheduled'",[at,candidate.id]);
      await dbRun('DELETE FROM platform_owner_announcement_schedule WHERE announcementId=?',[candidate.id]);
      await dbRun(`INSERT INTO platform_owner_announcement_audit
        (id,announcementId,actorId,action,createdAt) VALUES (?,?,?,?,?)`,
        [crypto.randomUUID(),candidate.id,'system_scheduler','scheduled_published',at]);
      await dbRun('COMMIT');tx=false;
      results.push({id:candidate.id,status:'published',recipients:rows.length});
    }catch(e){
      if(tx)await dbRun('ROLLBACK');
      throw e;
    }
  }
  return results;
}

/** Record an in-app delivery. External channels are intentionally not queued
 * until sandbox destinations, opt-in and provider idempotency are implemented. */
export async function recordOwnerInboxDelivery(dbRun,{announcementId,tenantId,userId,at}){
  await dbRun(`INSERT OR IGNORE INTO platform_owner_communication_deliveries
    (announcementId,tenant_id,userId,channel,status,attemptCount,nextAttemptAt,lastAttemptAt,lastErrorCode,deliveredAt,createdAt,updatedAt)
    VALUES (?,?,?,'in_app','delivered',1,NULL,?,NULL,?,?,?)`,
    [announcementId,tenantId,userId,at,at,at,at]);
}

export function createPlatformCommunicationsRouter({dbRun,dbGet,dbAll,authenticateToken,requirePlatformAdmin,env=process.env}) {
  const router=express.Router();
  // Opt-in explicitly on staging. Disabled elsewhere, including unconfigured production.
  router.use('/platform/communications', (req,res,next)=>{
    if(env.PLATFORM_COMMUNICATIONS_ENABLED!=='true'||env.PLATFORM_COMMUNICATIONS_STAGE!=='staging')return res.status(404).json({error:'Communications module unavailable.'});
    next();
  });
  router.use('/owner/communications', (req,res,next)=>{
    if(env.PLATFORM_COMMUNICATIONS_ENABLED!=='true'||env.PLATFORM_COMMUNICATIONS_STAGE!=='staging')return res.status(404).json({error:'Communications module unavailable.'});
    next();
  });
  // No emails or push calls; only tenant-scoped in-app inbox rows.
  const targets=async (audience)=>{
    const ids=[...new Set(audience.tenantIds)];
    const sql=`SELECT u.id AS userId,u.tenant_id AS tenantId,u.role,t.status,
       CASE WHEN p.userId IS NOT NULL THEN 1 ELSE 0 END AS isPlatformAdmin,t.name AS restaurantName
       FROM users u INNER JOIN tenants t ON t.id=u.tenant_id
       LEFT JOIN platform_ownership p ON p.userId=u.id
       WHERE u.role='owner' AND t.status='active' AND t.id!='default_tenant'
       ${audience.scope==='specific' ? `AND t.id IN (${ids.map(()=>'?').join(',')})` : ''}
       ORDER BY t.name,u.id`;
    const rows=await dbAll(sql,audience.scope==='specific'?ids:[]);
    return rows.filter(ownerRecipientEligible);
  };
  const platform=[authenticateToken,requirePlatformAdmin];
  const audit=async (req,id,action)=>dbRun(
    'INSERT INTO platform_owner_announcement_audit (id,announcementId,actorId,action,createdAt) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(),id,req.user.id,action,Date.now()]);
  // Explicit queueing only: never sends emails from an HTTP request.
  // Requires isolated staging + separate sandbox email opt-in + exact allowlist.
  router.get('/platform/communications/email/status',...platform,(req,res)=>{
    const config=sandboxEmailConfig(env);
    res.set('Cache-Control','no-store').json({
      stagingFeatureEnabled:env.PLATFORM_COMMUNICATIONS_ENABLED==='true'&&env.PLATFORM_COMMUNICATIONS_STAGE==='staging',
      sandboxEmailQueueEnabled:config.enabled,
      sandboxTransportReady:sandboxBrevoReady(env),
      automaticProviderDeliveryEnabled:false,
      configuredTestRecipientCount:config.allowed.size,
      // Do not reveal credentials, addresses, provider secrets or raw delivery content.
      sendingMode:'manual_unmounted',
      note:'Transport readiness is not a test send or confirmation of mailbox delivery.'
    });
  });
  router.post('/platform/communications/:id/email-queue',...platform,async(req,res,next)=>{try{
    if(!sandboxEmailConfig(env).enabled)return res.status(403).json({error:'Sandbox email queue is disabled.'});
    const m=await dbGet('SELECT id,status FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    if(m.status!=='published')return res.status(409).json({error:'Only published notices can be queued.'});
    const result=await enqueueSandboxOwnerEmails({dbAll,dbRun,announcementId:m.id,env});
    res.set('Cache-Control','no-store').json(result);
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/email-queue',...platform,async(req,res,next)=>{try{
    const rows=await dbAll(`SELECT status,COUNT(*) AS count
      FROM platform_owner_communication_email_queue WHERE announcementId=?
      GROUP BY status ORDER BY status`,[req.params.id]);
    res.set('Cache-Control','no-store').json({statuses:rows});
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/email-queue/preview',...platform,async(req,res,next)=>{try{
    if(!sandboxEmailConfig(env).enabled)return res.status(403).json({error:'Sandbox email queue disabled.'});
    const m=await dbGet('SELECT id FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    const report=await previewSandboxOwnerEmailDispatch({dbAll,dbGet,announcementId:req.params.id,env});
    res.set('Cache-Control','no-store').json({...report,dryRun:true,sent:0});
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/email-queue/reviews',...platform,async(req,res,next)=>{try{
    if(!sandboxEmailConfig(env).enabled)return res.status(403).json({error:'Sandbox email queue disabled.'});
    const rows=await dbAll(`SELECT announcementId,tenant_id AS tenantId,userId,
      status,attemptCount,lastAttemptAt,lastErrorCode,updatedAt
      FROM platform_owner_communication_email_queue
      WHERE announcementId=? AND status='manual_review'
      ORDER BY updatedAt DESC LIMIT 100`,[req.params.id]);
    res.set('Cache-Control','no-store').json({reviews:rows});
  }catch(e){next(e)}});
  router.post('/platform/communications/email-queue/reconcile',...platform,async(req,res,next)=>{try{
    if(!sandboxEmailConfig(env).enabled)return res.status(403).json({error:'Sandbox email queue disabled.'});
    const outcome=await reconcileStaleSandboxEmailClaims({dbRun,env});
    res.set('Cache-Control','no-store').json(outcome);
  }catch(e){next(e)}});
  router.post('/platform/communications/:id/email-queue/:tenantId/:userId/close-review',...platform,async(req,res,next)=>{try{
    if(!sandboxEmailConfig(env).enabled)return res.status(403).json({error:'Sandbox email queue disabled.'});
    const closed=await closeSandboxEmailReview({dbRun,announcementId:req.params.id,tenantId:req.params.tenantId,userId:req.params.userId});
    if(!closed)return res.status(404).json({error:'Reviewable email job not found.'});
    res.set('Cache-Control','no-store').json({closed:true,resent:false});
  }catch(e){next(e)}});
  router.post('/platform/communications/:id/schedule',...platform,async(req,res,next)=>{try{
    const parsed=z.object({scheduledAt:z.number().int().positive()}).strict().safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'A valid UTC schedule timestamp is required.'});
    const at=parsed.data.scheduledAt,now=Date.now();
    if(at<now+60_000||at>now+365*86_400_000)return res.status(400).json({error:'Schedule must be 1 minute to 365 days in the future.'});
    const m=await dbGet('SELECT status,expiresAt FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    if(m.status!=='draft')return res.status(409).json({error:'Only drafts can be scheduled.'});
    if(m.expiresAt!==null&&m.expiresAt<=at)return res.status(400).json({error:'Announcement expiry must follow the publication time.'});
    let tx=false;
    try{
      await dbRun('BEGIN TRANSACTION');tx=true;
      const current=await dbGet('SELECT status FROM platform_owner_announcements WHERE id=?',[req.params.id]);
      if(current?.status!=='draft')return await (async()=>{await dbRun('ROLLBACK');tx=false;res.status(409).json({error:'Announcement status changed.'})})();
      await dbRun("UPDATE platform_owner_announcements SET status='scheduled' WHERE id=? AND status='draft'",[req.params.id]);
      await dbRun('INSERT INTO platform_owner_announcement_schedule (announcementId,scheduledAt,createdBy,createdAt) VALUES (?,?,?,?)',
        [req.params.id,at,req.user.id,now]);
      await audit(req,req.params.id,'scheduled');
      await dbRun('COMMIT');tx=false;
      res.json({success:true,scheduledAt:at});
    }catch(err){if(tx)await dbRun('ROLLBACK');throw err}
  }catch(err){next(err)}});
  router.get('/platform/communications/templates',...platform,async(req,res,next)=>{try{
    res.set('Cache-Control','no-store').json(await dbAll(
      'SELECT id,name,title,body,category,requiresAcknowledgment,createdAt,updatedAt FROM platform_owner_communication_templates ORDER BY updatedAt DESC LIMIT 200'));
  }catch(e){next(e)}});
  router.post('/platform/communications/templates',...platform,async(req,res,next)=>{try{
    const parsed=templateSchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Invalid communication template.'});
    const x=parsed.data,id=crypto.randomUUID(),now=Date.now();
    await dbRun(`INSERT INTO platform_owner_communication_templates
      (id,name,title,body,category,requiresAcknowledgment,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)`,[id,x.name,x.title,x.body,x.category,Number(x.requiresAcknowledgment),req.user.id,now,now]);
    res.status(201).set('Cache-Control','no-store').json({id});
  }catch(e){next(e)}});
  router.delete('/platform/communications/templates/:id',...platform,async(req,res,next)=>{try{
    const entry=await dbGet('SELECT id FROM platform_owner_communication_templates WHERE id=?',[req.params.id]);
    if(!entry)return res.status(404).json({error:'Template not found.'});
    await dbRun('DELETE FROM platform_owner_communication_templates WHERE id=?',[req.params.id]);
    res.json({success:true});
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/translations',...platform,async(req,res,next)=>{try{
    const notice=await dbGet('SELECT id,title,body,status,category FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!notice)return res.status(404).json({error:'Notice not found.'});
    const rows=await dbAll(`SELECT t.locale,t.title,t.body,a.reviewedBy,a.reviewedAt,a.contentHash
      FROM platform_owner_announcement_translations t
      LEFT JOIN platform_owner_translation_approvals a ON a.announcementId=t.announcementId AND a.locale=t.locale
      WHERE t.announcementId=? ORDER BY t.locale`,[req.params.id]);
    res.set('Cache-Control','no-store').json({notice,translations:rows});
  }catch(e){next(e)}});
  router.post('/platform/communications/:id/translations/:locale/approve',...platform,async(req,res,next)=>{try{
    if(!['si','ta'].includes(req.params.locale))return res.status(400).json({error:'Unsupported translation language.'});
    const x=await dbGet(`SELECT t.title,t.body,n.status FROM platform_owner_announcement_translations t
      JOIN platform_owner_announcements n ON n.id=t.announcementId
      WHERE t.announcementId=? AND t.locale=?`,[req.params.id,req.params.locale]);
    if(!x)return res.status(404).json({error:'Translation not found.'});
    if(x.status==='cancelled')return res.status(409).json({error:'Cancelled notice cannot be approved.'});
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([x.title,x.body,req.params.locale])).digest('hex');
    const now=Date.now();
    await dbRun(`INSERT INTO platform_owner_translation_approvals
      (announcementId,locale,contentHash,reviewedBy,reviewedAt) VALUES (?,?,?,?,?)
      ON CONFLICT(announcementId,locale) DO UPDATE SET
      contentHash=excluded.contentHash,reviewedBy=excluded.reviewedBy,reviewedAt=excluded.reviewedAt`,
      [req.params.id,req.params.locale,fingerprint,req.user.id,now]);
    await audit(req,req.params.id,'translation_approved_'+req.params.locale);
    res.set('Cache-Control','no-store').json({approved:true,locale:req.params.locale,contentHash:fingerprint});
  }catch(e){next(e)}});
  router.post('/platform/communications/:id/translations/:locale/revoke',...platform,async(req,res,next)=>{try{
    if(!['si','ta'].includes(req.params.locale))return res.status(400).json({error:'Unsupported translation language.'});
    const result=await dbRun('DELETE FROM platform_owner_translation_approvals WHERE announcementId=? AND locale=?',
      [req.params.id,req.params.locale]);
    if(!Number(result?.changes))return res.status(404).json({error:'Approved translation not found.'});
    await audit(req,req.params.id,'translation_revoked_'+req.params.locale);
    res.json({revoked:true});
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/acknowledgments',...platform,async(req,res,next)=>{try{
    const rows=await dbAll(`SELECT contentLanguage,policyVersion,COUNT(*) AS count
      FROM platform_owner_acknowledgment_evidence WHERE announcementId=?
      GROUP BY contentLanguage,policyVersion ORDER BY contentLanguage`,[req.params.id]);
    res.set('Cache-Control','no-store').json({evidenceSummary:rows});
  }catch(e){next(e)}});
  router.post('/platform/communications/preview',...platform,async(req,res,next)=>{try{
    const parsed=audienceSchema.safeParse(req.body?.audience);
    if(!parsed.success)return res.status(400).json({error:'Invalid restaurant audience.'});
    const rows=await targets(parsed.data);
    res.set('Cache-Control','no-store').json({recipientCount:rows.length,restaurantCount:new Set(rows.map(r=>r.tenantId)).size,
      restaurants:rows.slice(0,100).map(r=>({tenantId:r.tenantId,name:r.restaurantName,ownerCount:rows.filter(t=>t.tenantId===r.tenantId).length})),
      truncated:rows.length>100});
  }catch(e){next(e)}});
  router.post('/platform/communications',...platform,async(req,res,next)=>{try{
    const parsed=messageSchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Invalid announcement content or recipients.'});
    const m=parsed.data,now=Date.now(),id=crypto.randomUUID();
    if(m.expiresAt!==null&&m.expiresAt<=now)return res.status(400).json({error:'Expiry must be in the future.'});
    // Persist the notice, its immutable version fingerprint, and creation audit together.
    let tx=false;
    try {
      await dbRun('BEGIN TRANSACTION');tx=true;
      await dbRun(`INSERT INTO platform_owner_announcements
        (id,title,body,category,requiresAcknowledgment,status,audienceJson,createdBy,createdAt,expiresAt)
        VALUES (?,?,?,?,?,'draft',?,?,?,?)`,
        [id,m.title,m.body,m.category,Number(m.requiresAcknowledgment),JSON.stringify(m.audience),req.user.id,now,m.expiresAt]);
      for(const [locale,content] of Object.entries(m.translations)){
        await dbRun(`INSERT INTO platform_owner_announcement_translations
          (announcementId,locale,title,body,createdAt) VALUES (?,?,?,?,?)`,
          [id,locale,content.title,content.body,now]);
      }
      if(m.policyVersion){
        const hash=crypto.createHash('sha256').update(JSON.stringify([m.title,m.body,m.category,m.policyVersion])).digest('hex');
        await dbRun('INSERT INTO platform_owner_announcement_versions (announcementId,policyVersion,contentHash,createdAt) VALUES (?,?,?,?)',[id,m.policyVersion,hash,now]);
      }
      await audit(req,id,'created');
        await dbRun('COMMIT');tx=false;
    }catch(err){if(tx)await dbRun('ROLLBACK');throw err;}
    res.status(201).set('Cache-Control','no-store').json({id,status:'draft'});
  }catch(e){next(e)}});
  router.get('/platform/communications',...platform,async(req,res,next)=>{try{
    res.set('Cache-Control','no-store').json(await dbAll(
      `SELECT a.id,a.title,a.category,a.status,a.requiresAcknowledgment,a.createdAt,a.publishedAt,a.expiresAt,v.policyVersion,s.scheduledAt
       FROM platform_owner_announcements a LEFT JOIN platform_owner_announcement_versions v ON v.announcementId=a.id
       LEFT JOIN platform_owner_announcement_schedule s ON s.announcementId=a.id
       ORDER BY a.createdAt DESC LIMIT 100`));
  }catch(e){next(e)}});
  router.post('/platform/communications/:id/publish',...platform,async(req,res,next)=>{try{
    const m=await dbGet('SELECT * FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    if(m.status!=='draft')return res.status(409).json({error:'Only draft announcements may be published.'});
    const rows=await targets(JSON.parse(m.audienceJson));
    if(!rows.length)return res.status(409).json({error:'No eligible owners; nothing published.'});
    let tx=false;try{
      await dbRun('BEGIN TRANSACTION');tx=true;
      // Atomic state transition prevents repeat publish on the same announcement.
      const check=await dbGet('SELECT status FROM platform_owner_announcements WHERE id=?',[m.id]);
      if(check?.status!=='draft'){const err=new Error('Already published.');err.status=409;throw err;}
      const now=Date.now();
      await dbRun("UPDATE platform_owner_announcements SET status='published',publishedAt=? WHERE id=? AND status='draft'",[now,m.id]);
      for(const r of rows){
        await dbRun(`INSERT INTO platform_owner_announcement_recipients
          (announcementId,tenant_id,userId,deliveredAt) VALUES (?,?,?,?)`,
          [m.id,r.tenantId,r.userId,now]);
        await recordOwnerInboxDelivery(dbRun,{announcementId:m.id,tenantId:r.tenantId,userId:r.userId,at:now});
      }
      await audit(req,m.id,'published');
      await dbRun('COMMIT');tx=false;
      res.set('Cache-Control','no-store').json({success:true,recipientCount:rows.length,restaurantCount:new Set(rows.map(r=>r.tenantId)).size});
    }catch(e){if(tx)await dbRun('ROLLBACK');throw e;}
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}});
  router.post('/platform/communications/:id/cancel',...platform,async(req,res,next)=>{try{
    const m=await dbGet('SELECT status FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    if(m.status==='cancelled')return res.status(409).json({error:'Already cancelled.'});
    await dbRun("UPDATE platform_owner_announcements SET status='cancelled',cancelledAt=? WHERE id=?",[Date.now(),req.params.id]);
    await audit(req,req.params.id,'cancelled');
    res.json({success:true});
  }catch(e){next(e)}});
  router.get('/platform/communications/:id/report',...platform,async(req,res,next)=>{try{
    const m=await dbGet('SELECT id,title,status FROM platform_owner_announcements WHERE id=?',[req.params.id]);
    if(!m)return res.status(404).json({error:'Announcement not found.'});
    const stats=await dbGet(`SELECT COUNT(*) AS recipients,COUNT(DISTINCT tenant_id) AS restaurants,
       SUM(CASE WHEN readAt IS NOT NULL THEN 1 ELSE 0 END) AS readCount,
       SUM(CASE WHEN acknowledgedAt IS NOT NULL THEN 1 ELSE 0 END) AS acknowledgedCount
       FROM platform_owner_announcement_recipients WHERE announcementId=?`,[m.id]);
    const channels=await dbAll(`SELECT channel,status,COUNT(*) AS count
      FROM platform_owner_communication_deliveries WHERE announcementId=?
      GROUP BY channel,status ORDER BY channel,status`,[m.id]);
    res.set('Cache-Control','no-store').json({announcement:m,stats,channels});
  }catch(e){next(e)}});
  // Push-preference foundation only. No tokens, device identifiers or external push.
  router.get('/owner/communications/push-preference',authenticateToken,async(req,res,next)=>{try{
    const uid=req.user?.id,tid=req.user?.tenant_id;
    if(!safeOwnerScope(req.user,tid))return res.status(403).json({error:'Owner access required.'});
    const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
    if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
    const row=await dbGet('SELECT optedIn,updatedAt FROM platform_owner_communication_push_preferences WHERE tenant_id=? AND userId=?',[tid,uid]);
    res.set('Cache-Control','no-store').json({optedIn:Boolean(row?.optedIn),updatedAt:row?.updatedAt||null,pushOperational:false});
  }catch(e){next(e)}});
  router.post('/owner/communications/push-preference',authenticateToken,async(req,res,next)=>{try{
    const uid=req.user?.id,tid=req.user?.tenant_id;
    if(!safeOwnerScope(req.user,tid))return res.status(403).json({error:'Owner access required.'});
    if(typeof req.body?.optedIn!=='boolean'||Object.keys(req.body||{}).some(k=>k!=='optedIn'))
      return res.status(400).json({error:'Expected optedIn boolean.'});
    const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
    if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
    const now=Date.now();
    await dbRun(`INSERT INTO platform_owner_communication_push_preferences (tenant_id,userId,optedIn,updatedAt)
      VALUES (?,?,?,?) ON CONFLICT (tenant_id,userId)
      DO UPDATE SET optedIn=excluded.optedIn,updatedAt=excluded.updatedAt`,
      [tid,uid,Number(req.body.optedIn),now]);
    res.set('Cache-Control','no-store').json({optedIn:req.body.optedIn,updatedAt:now,pushOperational:false});
  }catch(e){next(e)}});
  router.get('/owner/communications/:id/receipt',authenticateToken,async(req,res,next)=>{try{
    const uid=req.user?.id,tid=req.user?.tenant_id;
    if(!safeOwnerScope(req.user,tid))return res.status(403).json({error:'Owner access required.'});
    const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
    if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
    const row=await dbGet(`SELECT e.announcementId,e.contentLanguage,e.contentHash,e.policyVersion,e.acknowledgedAt
      FROM platform_owner_acknowledgment_evidence e
      JOIN platform_owner_announcement_recipients r ON r.announcementId=e.announcementId
        AND r.tenant_id=e.tenant_id AND r.userId=e.userId
      WHERE e.announcementId=? AND e.tenant_id=? AND e.userId=?`,[req.params.id,tid,uid]);
    if(!row)return res.status(404).json({error:'No acknowledgment receipt for this owner.'});
    res.set('Cache-Control','no-store').json(row);
  }catch(e){next(e)}});
  router.get('/owner/communications',authenticateToken,async(req,res,next)=>{try{
    if(!req.user||req.user.role!=='owner'||!req.user.tenant_id||req.user.isPlatformAdmin)return res.status(403).json({error:'Owner account required.'});
    const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[req.user.tenant_id]);
    if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
    const locale=announcementLanguage(req.query.lang);
    const rows=await dbAll(`SELECT a.id,COALESCE(tr.title,a.title) AS title,COALESCE(tr.body,a.body) AS body,
      CASE WHEN tr.locale IS NOT NULL THEN tr.locale ELSE 'en' END AS contentLanguage,
      a.category,a.requiresAcknowledgment,a.publishedAt,a.expiresAt,v.policyVersion,v.contentHash,
      r.readAt,r.acknowledgedAt FROM platform_owner_announcements a
      JOIN platform_owner_announcement_recipients r ON a.id=r.announcementId
      LEFT JOIN platform_owner_announcement_versions v ON v.announcementId=a.id
      LEFT JOIN platform_owner_announcement_translations tr ON tr.announcementId=a.id AND tr.locale=?
      AND EXISTS (SELECT 1 FROM platform_owner_translation_approvals ap WHERE ap.announcementId=tr.announcementId AND ap.locale=tr.locale)
      WHERE r.tenant_id=? AND r.userId=? AND a.status='published'
      AND (a.expiresAt IS NULL OR a.expiresAt>?)
      ORDER BY a.publishedAt DESC LIMIT 100`,[locale,req.user.tenant_id,req.user.id,Date.now()]);
    res.set('Cache-Control','no-store').json(rows);
  }catch(e){next(e)}});
  for(const action of ['read','acknowledge']){
    router.post(`/owner/communications/:id/${action}`,authenticateToken,async(req,res,next)=>{try{
      const uid=req.user?.id,tid=req.user?.tenant_id;
      if(!safeOwnerScope(req.user,tid))return res.status(403).json({error:'Owner access required.'});
      const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
      if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
      const row=await dbGet(`SELECT a.id,a.title,a.body,a.category,a.requiresAcknowledgment,v.policyVersion,v.contentHash FROM platform_owner_announcements a
        JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id
        LEFT JOIN platform_owner_announcement_versions v ON v.announcementId=a.id
        WHERE a.id=? AND r.userId=? AND r.tenant_id=? AND a.status='published'
        AND (a.expiresAt IS NULL OR a.expiresAt>?)`,[req.params.id,uid,tid,Date.now()]);
      if(!row)return res.status(404).json({error:'Announcement not available.'});
      if(action==='acknowledge'&&!row.requiresAcknowledgment)return res.status(409).json({error:'This message does not require acknowledgment.'});
      const now=Date.now();
      if(action==='read')await dbRun(`UPDATE platform_owner_announcement_recipients SET readAt=COALESCE(readAt,?)
        WHERE announcementId=? AND tenant_id=? AND userId=?`,[now,row.id,tid,uid]);
      else {
        const selected=announcementLanguage(req.body?.language);
        const tr=selected==='en'?null:await dbGet(`SELECT t.title,t.body,ap.contentHash
          FROM platform_owner_announcement_translations t
          JOIN platform_owner_translation_approvals ap
            ON ap.announcementId=t.announcementId AND ap.locale=t.locale
          WHERE t.announcementId=? AND t.locale=?`,[row.id,selected]);
        const locale=tr?selected:'en';
        const hash=tr?.contentHash||row.contentHash||
          crypto.createHash('sha256').update(JSON.stringify([row.title,row.body,row.category])).digest('hex');
        let tx=false;
        try{
          await dbRun('BEGIN TRANSACTION');tx=true;
          await dbRun(`UPDATE platform_owner_announcement_recipients
            SET readAt=COALESCE(readAt,?),acknowledgedAt=COALESCE(acknowledgedAt,?)
            WHERE announcementId=? AND tenant_id=? AND userId=?`,[now,now,row.id,tid,uid]);
          await dbRun(`INSERT OR IGNORE INTO platform_owner_acknowledgment_evidence
            (announcementId,tenant_id,userId,contentLanguage,contentHash,policyVersion,acknowledgedAt)
            VALUES (?,?,?,?,?,?,?)`,[row.id,tid,uid,locale,hash,row.policyVersion||null,now]);
          await dbRun('COMMIT');tx=false;
        }catch(e){if(tx)await dbRun('ROLLBACK');throw e;}
      }
      res.json({success:true});
    }catch(e){next(e)}});
  }
  return router;
}
