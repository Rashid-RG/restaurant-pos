/**
 * GastroFlow Platform Communication Center - owner-targeted in-app delivery.
 * Feature-gated: PLATFORM_COMMUNICATIONS_ENABLED=true on isolated staging only.
 * No outbound email/push is sent from this module.
 */
import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

const audienceSchema=z.object({
  scope:z.enum(['all','specific']).default('all'),
  tenantIds:z.array(z.string().min(1).max(180)).max(500).default([])
}).strict().refine(x=>x.scope!=='specific'||x.tenantIds.length>0, 'Select restaurants.');
const policyVersionSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const messageSchema=z.object({
  title:z.string().trim().min(3).max(140),
  body:z.string().trim().min(5).max(10000),
  category:z.enum(['announcement','urgent','maintenance','policy','disclaimer','feature']).default('announcement'),
  requiresAcknowledgment:z.boolean().default(false),
  expiresAt:z.number().int().positive().nullable().default(null),
  audience:audienceSchema,
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
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_communication_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT NOT NULL, requiresAcknowledgment INTEGER NOT NULL DEFAULT 0,
    createdBy TEXT NOT NULL, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_versions (
    announcementId TEXT PRIMARY KEY, policyVersion TEXT NOT NULL,
    contentHash TEXT NOT NULL, createdAt BIGINT NOT NULL)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS platform_owner_announcement_audit (
    id TEXT PRIMARY KEY, announcementId TEXT NOT NULL, actorId TEXT NOT NULL,
    action TEXT NOT NULL, createdAt BIGINT NOT NULL)`);
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
      `SELECT a.id,a.title,a.category,a.status,a.requiresAcknowledgment,a.createdAt,a.publishedAt,a.expiresAt,v.policyVersion
       FROM platform_owner_announcements a LEFT JOIN platform_owner_announcement_versions v ON v.announcementId=a.id
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
    res.set('Cache-Control','no-store').json({announcement:m,stats});
  }catch(e){next(e)}});
  router.get('/owner/communications',authenticateToken,async(req,res,next)=>{try{
    if(!req.user||req.user.role!=='owner'||!req.user.tenant_id||req.user.isPlatformAdmin)return res.status(403).json({error:'Owner account required.'});
    const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[req.user.tenant_id]);
    if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
    const rows=await dbAll(`SELECT a.id,a.title,a.body,a.category,a.requiresAcknowledgment,a.publishedAt,a.expiresAt,v.policyVersion,v.contentHash,
      r.readAt,r.acknowledgedAt FROM platform_owner_announcements a
      JOIN platform_owner_announcement_recipients r ON a.id=r.announcementId
      LEFT JOIN platform_owner_announcement_versions v ON v.announcementId=a.id
      WHERE r.tenant_id=? AND r.userId=? AND a.status='published'
      AND (a.expiresAt IS NULL OR a.expiresAt>?)
      ORDER BY a.publishedAt DESC LIMIT 100`,[req.user.tenant_id,req.user.id,Date.now()]);
    res.set('Cache-Control','no-store').json(rows);
  }catch(e){next(e)}});
  for(const action of ['read','acknowledge']){
    router.post(`/owner/communications/:id/${action}`,authenticateToken,async(req,res,next)=>{try{
      const uid=req.user?.id,tid=req.user?.tenant_id;
      if(!safeOwnerScope(req.user,tid))return res.status(403).json({error:'Owner access required.'});
      const tenant=await dbGet('SELECT status FROM tenants WHERE id=?',[tid]);
      if(tenant?.status!=='active')return res.status(403).json({error:'Restaurant inactive.'});
      const row=await dbGet(`SELECT a.id,a.requiresAcknowledgment FROM platform_owner_announcements a
        JOIN platform_owner_announcement_recipients r ON r.announcementId=a.id
        WHERE a.id=? AND r.userId=? AND r.tenant_id=? AND a.status='published'
        AND (a.expiresAt IS NULL OR a.expiresAt>?)`,[req.params.id,uid,tid,Date.now()]);
      if(!row)return res.status(404).json({error:'Announcement not available.'});
      if(action==='acknowledge'&&!row.requiresAcknowledgment)return res.status(409).json({error:'This message does not require acknowledgment.'});
      const now=Date.now();
      if(action==='read')await dbRun(`UPDATE platform_owner_announcement_recipients SET readAt=COALESCE(readAt,?)
        WHERE announcementId=? AND tenant_id=? AND userId=?`,[now,row.id,tid,uid]);
      else await dbRun(`UPDATE platform_owner_announcement_recipients
        SET readAt=COALESCE(readAt,?),acknowledgedAt=COALESCE(acknowledgedAt,?)
        WHERE announcementId=? AND tenant_id=? AND userId=?`,[now,now,row.id,tid,uid]);
      res.json({success:true});
    }catch(e){next(e)}});
  }
  return router;
}
