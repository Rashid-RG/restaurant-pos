import { rateLimit } from 'express-rate-limit';
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
  await dbRun(`CREATE TABLE IF NOT EXISTS food_promotion_coupon_rules (
    campaign_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL NOT NULL,
    min_spend REAL NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    per_customer_limit INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    order_type TEXT NOT NULL DEFAULT 'any',
    UNIQUE (tenant_id, code)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS food_promotion_redemptions (
    order_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    customer_account_id TEXT,
    redeemed_at INTEGER NOT NULL
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS food_coupon_customer_usage ON food_promotion_redemptions(campaign_id,tenant_id,customer_account_id)');
}
const safeImage = z.string().trim().max(1000).refine(value => {
  if (!value) return true;
  if (value.startsWith('/')) return value.startsWith('/uploads/') || value.startsWith('/customer/');
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch {return false;}
}, 'Use an HTTPS image or an uploaded restaurant image path.');
const couponSchema=z.object({
  code:z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/).transform(v=>v.toUpperCase()),
  type:z.enum(['percent','flat']),
  value:z.number().finite().positive().max(1000000),
  minSpend:z.number().finite().min(0).max(10000000).default(0),
  maxUses:z.number().int().min(0).max(1000000).default(0),
  perCustomerLimit:z.number().int().min(0).max(1000).default(0),
  orderType:z.enum(['any','delivery','takeaway','dine-in']).default('any')
}).strict().refine(v=>v.type!=='percent'||v.value<=100,{message:'Percentage must not exceed 100'});
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
  autoCreative:z.boolean().default(true),
  coupon:couponSchema.nullable().optional()
}).strict().refine(v => v.startsAt === null || v.endsAt === null || v.endsAt > v.startsAt, {
  message:'End date must be later than start date'
});
const present = row => ({
  id:row.id,tenantId:row.tenant_id,title:row.title,subtitle:row.subtitle,
  offerLabel:row.offer_label,imageUrl:row.image_url,cta:row.call_to_action,
  status:row.status,startsAt:row.starts_at,endsAt:row.ends_at,
  showPopup:row.show_popup === 1,autoCreative:row.auto_creative === 1,
  createdAt:row.created_at,updatedAt:row.updated_at,
  impressions:Number(row.impressions||0),clicks:Number(row.clicks||0),
  coupon:row.coupon_code ? {code:row.coupon_code,type:row.coupon_type,value:Number(row.coupon_value),
    minSpend:Number(row.coupon_min_spend||0),maxUses:Number(row.coupon_max_uses||0),
    perCustomerLimit:Number(row.coupon_per_customer_limit||0),orderType:row.coupon_order_type||'any',
    usedCount:Number(row.coupon_used_count||0)} : null
});

export function createPromotionsRouter({dbAll,dbGet,dbRun,authenticateToken,requireRole,requirePlatformAdmin,publicApiLimiter}) {
  const router=express.Router();

  // Optional AI copy enhancement. No customer personal data is sent to AI.
  // Without a configured key, a deterministic branded draft remains available.
  const draftLimiter=rateLimit({windowMs:60*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
  const creativeSchema=z.object({
    title:z.string().trim().min(3).max(90),
    subtitle:z.string().trim().max(180).default(''),
    offerLabel:z.string().trim().max(55).default('')
  }).strict();
  const creativeDraft=async(req,res)=>{
    const parsed=creativeSchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Provide a valid offer headline and its real terms.'});
    const source=parsed.data;
    let tagline=source.subtitle||'Discover something delicious from a local restaurant.';
    let engine='branded-template';
    if(process.env.OPENAI_API_KEY){
      try{
        const response=await fetch('https://api.openai.com/v1/responses',{
          method:'POST',signal:AbortSignal.timeout(6500),
          headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify({
            model:process.env.GASTROFOOD_CREATIVE_TEXT_MODEL||'gpt-4.1-mini',
            max_output_tokens:90,
            input:[
              {role:'system',content:'You write ONE short food advertisement tagline of at most 85 characters. Never add discounts, percentages, prices, free delivery, time limits or product claims not explicitly supplied. Do not include personal data, markdown or quotes.'},
              {role:'user',content:JSON.stringify(source)}
            ]
          })
        });
        if(response.ok){
          const data=await response.json();
          const candidate=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text?.trim();
          // AI only suggests styling copy; authoritative offer terms remain untouched.
          if(candidate&&candidate.length<=85&&!/\d|%|\bfree\b|\bguarantee\b/i.test(candidate)){
            tagline=candidate;engine='ai-assisted-copy';
          }
        }
      }catch{ /* Keep a safe template if AI is unavailable. */ }
    }
    res.set('Cache-Control','no-store').json({
      engine,headline:source.title,tagline,offerLabel:source.offerLabel,
      note:'The store must verify every advertisement. Discount rules are enforced only by the server.'
    });
  };
  router.post('/food-promotions/creative-draft',authenticateToken,requireRole(['owner','manager']),draftLimiter,creativeDraft);
  router.post('/platform/food-promotions/creative-draft',authenticateToken,requirePlatformAdmin,draftLimiter,creativeDraft);


  const couponJoin=` LEFT JOIN food_promotion_coupon_rules r ON r.campaign_id=c.id `;
  const couponFields=`,r.code AS coupon_code,r.type AS coupon_type,r.value AS coupon_value,
    r.min_spend AS coupon_min_spend,r.max_uses AS coupon_max_uses,
    r.per_customer_limit AS coupon_per_customer_limit,r.used_count AS coupon_used_count,
    r.order_type AS coupon_order_type`;
  const getCampaign=async(id,tenantId)=>dbGet(
    `SELECT c.* ${couponFields} FROM food_promotion_campaigns c ${couponJoin}
     WHERE c.id=?${tenantId?' AND c.tenant_id=?':''}`,
     tenantId?[id,tenantId]:[id]);
  const transact=async(action)=>{
    await dbRun('BEGIN TRANSACTION');
    try{
      const result=await action();
      await dbRun('COMMIT');
      return result;
    }catch(err){
      await dbRun('ROLLBACK');
      throw err;
    }
  };
  const saveCoupon=async(campaignId,tenantId,coupon)=>{
    if(!coupon)return;
    if(!tenantId)throw Error('An offer coupon must belong to a restaurant.');
    const legacy=await dbGet('SELECT code FROM promotions WHERE tenant_id=? AND code=?',[tenantId,coupon.code]);
    if(legacy)throw Object.assign(Error('This coupon code is already used by an older promotion.'),{status:409});
    const existing=await dbGet('SELECT campaign_id FROM food_promotion_coupon_rules WHERE tenant_id=? AND code=?',[tenantId,coupon.code]);
    if(existing&&existing.campaign_id!==campaignId)
      throw Object.assign(Error('Coupon code already belongs to another campaign.'),{status:409});
    await dbRun(`INSERT INTO food_promotion_coupon_rules
      (campaign_id,tenant_id,code,type,value,min_spend,max_uses,per_customer_limit,order_type)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(campaign_id) DO UPDATE SET code=excluded.code,type=excluded.type,
        value=excluded.value,min_spend=excluded.min_spend,max_uses=excluded.max_uses,
        per_customer_limit=excluded.per_customer_limit,order_type=excluded.order_type`,
      [campaignId,tenantId,coupon.code,coupon.type,coupon.value,coupon.minSpend,
        coupon.maxUses,coupon.perCustomerLimit,coupon.orderType]);
  };

  // Public list: only scheduled/live campaigns, and never reveal suspended tenants.
  // A campaign's textual offer is promotional content, not a checkout price override.
  router.get('/public/food-promotions',publicApiLimiter,async(req,res,next)=>{
    try {
      const now=Date.now();
      const rows=await dbAll(`SELECT c.* ${couponFields} FROM food_promotion_campaigns c
        ${couponJoin} LEFT JOIN tenants t ON t.id=c.tenant_id
        WHERE c.status='active' AND (c.starts_at IS NULL OR c.starts_at<=?)
          AND (c.ends_at IS NULL OR c.ends_at>?)
          AND (c.tenant_id IS NULL OR t.status='active')
          AND (r.campaign_id IS NULL OR r.max_uses=0 OR r.used_count<r.max_uses)
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
      res.json({ok:true});
    }catch(err){next(err);}
  });

  // Store staff can only manage campaigns bound to their authenticated tenant.
  router.get('/food-promotions/manage',authenticateToken,requireRole(['owner','manager']),async(req,res,next)=>{
    try {
      const rows=await dbAll(`SELECT c.*,COALESCE(m.impressions,0) AS impressions,COALESCE(m.clicks,0) AS clicks ${couponFields} FROM food_promotion_campaigns c LEFT JOIN food_promotion_metrics m ON m.campaign_id=c.id ${couponJoin} WHERE c.tenant_id=? ORDER BY c.updated_at DESC LIMIT 100`,[req.tenantId]);
      res.json({campaigns:rows.map(present)});
    } catch(err){next(err);}
  });
  router.post('/food-promotions/manage',authenticateToken,requireRole(['owner','manager']),async(req,res,next)=>{
    try {
      const parsed=campaignSchema.safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.',details:parsed.error.issues.map(i=>i.message)});
      const v=parsed.data;const now=Date.now();const id=crypto.randomUUID();
      await transact(async()=>{
        await dbRun(`INSERT INTO food_promotion_campaigns
          (id,tenant_id,title,subtitle,offer_label,image_url,call_to_action,status,starts_at,ends_at,show_popup,auto_creative,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id,req.tenantId,v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,
           Number(v.showPopup),Number(v.autoCreative),req.user.id,now,now]);
        await saveCoupon(id,req.tenantId,v.coupon);
      });
      const row=await getCampaign(id,req.tenantId);
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
      await transact(async()=>{
        await dbRun(`UPDATE food_promotion_campaigns SET title=?,subtitle=?,offer_label=?,image_url=?,call_to_action=?,
          status=?,starts_at=?,ends_at=?,show_popup=?,auto_creative=?,updated_at=? WHERE id=? AND tenant_id=?`,
          [v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,Number(v.showPopup),
           Number(v.autoCreative),Date.now(),req.params.id,req.tenantId]);
        await saveCoupon(req.params.id,req.tenantId,v.coupon);
      });
      res.json({campaign:present(await getCampaign(req.params.id,req.tenantId))});
    } catch(err){next(err);}
  });

  // Platform owner can create global announcements or manage tenant promotions,
  // but only using the explicitly authorized platform identity.
  router.get('/platform/food-promotions',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      res.json({campaigns:(await dbAll(`SELECT c.*,COALESCE(m.impressions,0) AS impressions,COALESCE(m.clicks,0) AS clicks ${couponFields} FROM food_promotion_campaigns c LEFT JOIN food_promotion_metrics m ON m.campaign_id=c.id ${couponJoin} ORDER BY c.updated_at DESC LIMIT 250`)).map(present)});
    }catch(err){next(err);}
  });
  router.post('/platform/food-promotions',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      const parsed=campaignSchema.extend({tenantId:z.string().trim().max(120).nullable().default(null)}).safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.'});
      const v=parsed.data;
      if(v.coupon&&!v.tenantId)return res.status(400).json({error:'Coupon codes require an individual restaurant.'});
      if(v.tenantId && !(await dbGet('SELECT id FROM tenants WHERE id=?',[v.tenantId])))
        return res.status(404).json({error:'Restaurant not found.'});
      const id=crypto.randomUUID(),now=Date.now();
      await transact(async()=>{
        await dbRun(`INSERT INTO food_promotion_campaigns
          (id,tenant_id,title,subtitle,offer_label,image_url,call_to_action,status,starts_at,ends_at,show_popup,auto_creative,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id,v.tenantId,v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,
           Number(v.showPopup),Number(v.autoCreative),req.user.id,now,now]);
        await saveCoupon(id,v.tenantId,v.coupon);
      });
      res.status(201).json({campaign:present(await getCampaign(id))});
    }catch(err){next(err);}
  });
  router.patch('/platform/food-promotions/:id',authenticateToken,requirePlatformAdmin,async(req,res,next)=>{
    try {
      const old=await dbGet('SELECT * FROM food_promotion_campaigns WHERE id=?',[req.params.id]);
      if(!old)return res.status(404).json({error:'Promotion not found.'});
      const parsed=campaignSchema.safeParse(req.body);
      if(!parsed.success)return res.status(400).json({error:'Invalid promotion details.'});
      const v=parsed.data;
      await transact(async()=>{
        await dbRun(`UPDATE food_promotion_campaigns SET title=?,subtitle=?,offer_label=?,image_url=?,call_to_action=?,
          status=?,starts_at=?,ends_at=?,show_popup=?,auto_creative=?,updated_at=? WHERE id=?`,
          [v.title,v.subtitle,v.offerLabel,v.imageUrl,v.cta,v.status,v.startsAt,v.endsAt,Number(v.showPopup),
           Number(v.autoCreative),Date.now(),req.params.id]);
        await saveCoupon(req.params.id,old.tenant_id,v.coupon);
      });
      res.json({campaign:present(await getCampaign(req.params.id))});
    }catch(err){next(err);}
  });
  return router;
}
