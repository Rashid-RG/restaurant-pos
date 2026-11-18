import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

// Additive schema. Never delete or rewrite historical orders, settings or tenant rows.
export async function initPromotions(dbRun) {
  await dbRun(`CREATE TABLE IF NOT EXISTS food_promotion_campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    offer_label TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    call_to_action TEXT NOT NULL DEFAULT 'Browse menu',
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at INTEGER,
    ends_at INTEGER,
    show_popup INTEGER NOT NULL DEFAULT 0,
    auto_creative INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS food_promo_status_dates ON food_promotion_campaigns(status, starts_at, ends_at)');
  await dbRun('CREATE INDEX IF NOT EXISTS food_promo_tenant ON food_promotion_campaigns(tenant_id, status)');
  // Anonymous aggregate counts only. No user identifiers, tracking IDs or PII.
  await dbRun(`CREATE TABLE IF NOT EXISTS food_promotion_metrics (
    campaign_id TEXT PRIMARY KEY,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);
}
const safeImage = z.string().trim().max(1000).refine(value => {
  if (!value) return true;
  if (value.startsWith('/')) return value.startsWith('/uploads/') || value.startsWith('/customer/');
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch {return false;}
}, 'Use an HTTPS image or an uploaded restaurant image path.');
const campaignSchema = z.object({
  title:z.string().trim().min(3).max(90),
  subtitle:z.string().trim().max(180).default(''),
  offerLabel:z.string().trim().max(55).default(''),
  imageUrl:safeImage.default(''),
  cta:z.string().trim().min(2).max(40).default('Browse menu'),
  status:z.enum(['draft','active','paused']).default('draft'),
  startsAt:z.number().int().nonnegative().nullable().default(null),
  endsAt:z.number().int().positive().nullable().default(null),
  showPopup:z.boolean().default(false),
  autoCreative:z.boolean().default(true)
}).strict().refine(v => v.startsAt === null || v.endsAt === null || v.endsAt > v.startsAt, {
  message:'End date must be later than start date'
});
const present = row => ({
  id:row.id,tenantId:row.tenant_id,title:row.title,subtitle:row.subtitle,
  offerLabel:row.offer_label,imageUrl:row.image_url,cta:row.call_to_action,
  status:row.status,startsAt:row.starts_at,endsAt:row.ends_at,
  showPopup:row.show_popup === 1,autoCreative:row.auto_creative === 1,
  createdAt:row.created_at,updatedAt:row.updated_at,
  impressions:Number(row.impressions||0),clicks:Number(row.clicks||0)
});

export function createPromotionsRouter({dbAll,dbGet,dbRun,authenticateToken,requireRole,requirePlatformAdmin,publicApiLimiter}) {
  const router=express.Router();

  // Public list: only scheduled/live campaigns, and never reveal suspended tenants.
  // A campaign's textual offer is promotional content, not a checkout price override.
  router.get('/public/food-promotions',publicApiLimiter,async(req,res,next)=>{
    try {
      const now=Date.now();
      const rows=await dbAll(`SELECT c.* FROM food_promotion_campaigns c
        LEFT JOIN tenants t ON t.id=c.tenant_id
        WHERE c.status='active' AND (c.starts_at IS NULL OR c.starts_at<=?)
          AND (c.ends_at IS NULL OR c.ends_at>?)
          AND (c.tenant_id IS NULL OR t.status='active')
        ORDER BY c.updated_at DESC LIMIT 40`,[now,now]);
      res.set('Cache-Control','no-store');
      res.json({campaigns:rows.map(present)});
    } catch(err){next(err);}
  });

  // Count campaign engagement without storing cookies, identifiers or customer data.
  // Public requests are rate limited; no view/click event affects checkout charges.
  router.post('/public/food-promotions/:id/events',publicApiLimiter,async(req,res,next)=>{
    try {
      const event=req.body?.event;
      if(event!=='impression' && event!=='click')
        return res.status(400).json({error:'Unsupported campaign event.'});
      if(!/^[a-f0-9-]{36}$/i.test(req.params.id))
        return res.status(400).json({error:'Invalid campaign identifier.'});
      const now=Date.now();
      const campaign=await dbGet(`SELECT c.id FROM food_promotion_campaigns c
        LEFT JOIN tenants t ON t.id=c.tenant_id
        WHERE c.id=? AND c.status='active'
        AND (c.starts_at IS NULL OR c.starts_at<=?)
        AND (c.ends_at IS NULL OR c.ends_at>?)
        AND (c.tenant_id IS NULL OR t.status='active')`,[req.params.id,now,now]);
      if(!campaign)return res.status(404).json({error:'Campaign unavailable.'});
      await dbRun(`INSERT INTO food_promotion_metrics (campaign_id,impressions,clicks,updated_at)
        VALUES (?,?,?,?)
        ON CONFLICT(campaign_id) DO UPDATE SET
        impressions=food_promotion_metrics.impressions+excluded.impressions,
        clicks=food_promotion_metrics.clicks+excluded.clicks,
        updated_at=excluded.updated_at`,
        [req.params.id,Number(event==='impression'),Number(event==='click'),now]);
      res.status(204).end();
    }catch(err){next(err);}
  });

  // Store staff can only manage campaigns bound to their authenticated tenant.
  router.get('/food-promotions/manage',authenticateToken,requireRole(['owner','manager']),async(req,res,next)=>{
    try {
      const rows=await dbAll('SELECT c.*,COALESCE(m.impressions,0) AS impressions,COALESCE(m.clicks,0) AS clicks FROM food_promotion_campaigns c LEFT JOIN food_promotion_metrics m ON m.campaign_id=c.id WHERE c.tenant_id=? ORDER BY c.updated_at DESC LIMIT 100',[req.tenantId]);
      res.json({campaigns:rows.map(present)});
    } catch(err){next(err);}
  });
  router.post('/food-promotions/manage',authenticateToken,requireRole(['owner','manager']),async(req,res,next)=>{
    try {
      const parsed=campaignSchema.safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.',details:parsed.error.issues.map(i=>i.message)});
      const v=parsed.data;const now=Date.now();const id=crypto.randomUUID();
      await dbRun(`INSERT INTO food_promotion_campaigns
        (id,tenant_id,title,subtitle,offer_label,image_url,call_to_action,status,starts_at,ends_at,show_popup,auto_creative,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,req.tenantId,v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,
         Number(v.showPopup),Number(v.autoCreative),req.user.id,now,now]);
      const row=await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=? AND tenant_id=?',[id,req.tenantId]);
      res.status(201).json({campaign:present(row)});
    } catch(err){next(err);}
  });
  router.patch('/food-promotions/manage/:id',authenticateToken,requireRole(['owner','manager']),async(req,res,next)=>{
    try {
      const row=await dbGet('SELECT id FROM food_promotion_campaigns WHERE id=? AND tenant_id=?',[req.params.id,req.tenantId]);
      if(!row)return res.status(404).json({error:'Promotion not found for this restaurant.'});
      const parsed=campaignSchema.safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.',details:parsed.error.issues.map(i=>i.message)});
      const v=parsed.data;
      await dbRun(`UPDATE food_promotion_campaigns SET title=?,subtitle=?,offer_label=?,image_url=?,call_to_action=?,
        status=?,starts_at=?,ends_at=?,show_popup=?,auto_creative=?,updated_at=? WHERE id=? AND tenant_id=?`,
        [v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,Number(v.showPopup),
         Number(v.autoCreative),Date.now(),req.params.id,req.tenantId]);
      res.json({campaign:present(await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=? AND tenant_id=?',[req.params.id,req.tenantId]))});
    } catch(err){next(err);}
  });

  // Platform owner can create global announcements or manage tenant promotions,
  // but only using the explicitly authorized platform identity.
  router.get('/platform/food-promotions',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      res.json({campaigns:(await dbAll('SELECT c.*,COALESCE(m.impressions,0) AS impressions,COALESCE(m.clicks,0) AS clicks FROM food_promotion_campaigns c LEFT JOIN food_promotion_metrics m ON m.campaign_id=c.id ORDER BY c.updated_at DESC LIMIT 250')).map(present)});
    }catch(err){next(err);}
  });
  router.post('/platform/food-promotions',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      const parsed=campaignSchema.extend({tenantId:z.string().trim().max(120).nullable().default(null)}).safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.'});
      const v=parsed.data;
      if(v.tenantId && !(await dbGet('SELECT id FROM tenants WHERE id=?',[v.tenantId])))
        return res.status(404).json({error:'Restaurant not found.'});
      const id=crypto.randomUUID(),now=Date.now();
      await dbRun(`INSERT INTO food_promotion_campaigns
        (id,tenant_id,title,subtitle,offer_label,image_url,call_to_action,status,starts_at,ends_at,show_popup,auto_creative,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,v.tenantId,v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,
         Number(v.showPopup),Number(v.autoCreative),req.user.id,now,now]);
      res.status(201).json({campaign:present(await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=?',[id]))});
    }catch(err){next(err);}
  });
  router.patch('/platform/food-promotions/:id',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      const old=await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=?',[req.params.id]);
      if(!old)return res.status(404).json({error:'Promotion not found.'});
      const parsed=campaignSchema.safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.'});
      const v=parsed.data;
      await dbRun(`UPDATE food_promotion_campaigns SET title=?,subtitle=?,offer_label=?,image_url=?,call_to_action=?,
        status=?,starts_at=?,ends_at=?,show_popup=?,auto_creative=?,updated_at=? WHERE id=?`,
        [v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,Number(v.showPopup),
         Number(v.autoCreative),Date.now(),req.params.id]);
      res.json({campaign:present(await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=?',[req.params.id]))});
    }catch(err){next(err);}
  });
  return router;
}
