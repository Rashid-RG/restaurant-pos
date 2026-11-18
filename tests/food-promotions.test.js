import {describe,it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {initPromotions,createPromotionsRouter} from '../routes/food-promotions.js';

function fixture(){
  const rows=[];const tenants=[{id:'store-a',status:'active'},{id:'store-b',status:'active'}];
  const dbRun=async(sql,p=[])=>{
    if(sql.includes('INSERT INTO food_promotion_metrics')) return;
    if(sql.startsWith('INSERT INTO food_promotion_campaigns'))rows.push({
      id:p[0],tenant_id:p[1],title:p[2],subtitle:p[3],offer_label:p[4],
      image_url:p[5],call_to_action:p[6],status:p[7],starts_at:p[8],ends_at:p[9],
      show_popup:p[10],auto_creative:p[11],created_by:p[12],created_at:p[13],updated_at:p[14]
    });
    if(sql.startsWith('UPDATE food_promotion_campaigns')){
      const x=rows.find(r=>r.id===p[11]&&(p.length===13?r.tenant_id===p[12]:true));
      if(x)Object.assign(x,{title:p[0],subtitle:p[1],offer_label:p[2],image_url:p[3],call_to_action:p[4],
        status:p[5],starts_at:p[6],ends_at:p[7],show_popup:p[8],auto_creative:p[9],updated_at:p[10]});
    }
  };
  const dbGet=async(sql,p=[])=>{
    if(sql.includes('FROM tenants'))return tenants.find(t=>t.id===p[0]);
    if(sql.includes('LEFT JOIN tenants'))return rows.find(r=>r.id===p[0]&&r.status==='active' &&
      (r.starts_at==null||r.starts_at<=p[1]) && (r.ends_at==null||r.ends_at>p[2]) &&
      (r.tenant_id==null||tenants.some(t=>t.id===r.tenant_id&&t.status==='active')));
    if(sql.includes('FROM food_promotion_campaigns'))return rows.find(r=>r.id===p[0]&&(p.length<2||r.tenant_id===p[1]));
    return null;
  };
  const dbAll=async(sql,p=[])=>{
    if(sql.includes('LEFT JOIN tenants'))return rows.filter(row=>row.status==='active' &&
      (row.starts_at==null||row.starts_at<=p[0]) && (row.ends_at==null||row.ends_at>p[1]) &&
      (row.tenant_id==null||tenants.some(t=>t.id===row.tenant_id&&t.status==='active')));
    if(sql.includes('WHERE tenant_id=?')||sql.includes('WHERE c.tenant_id=?'))return rows.filter(r=>r.tenant_id===p[0]);
    return rows;
  };
  const authenticateToken=(req,res,next)=>{
    const token=req.headers.authorization?.replace('Bearer ','');
    if(!token)return res.status(401).json({error:'Authentication required'});
    if(!['owner-a','owner-b','platform'].includes(token))return res.status(403).json({error:'Invalid actor'});
    req.user={id:token,role:'owner'};
    req.tenantId=token==='owner-b'?'store-b':'store-a';
    next();
  };
  const requireRole=roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Wrong role'});
  const requirePlatformAdmin=(req,res,next)=>req.user.id==='platform'?next():res.status(403).json({error:'Platform only'});
  const app=express();app.use(express.json());
  app.use('/api',createPromotionsRouter({dbAll,dbGet,dbRun,authenticateToken,requireRole,requirePlatformAdmin,publicApiLimiter:(_req,_res,next)=>next()}));
  return {app,dbRun,rows,tenants};
}
const item={title:'Real BBQ Friday Deal',subtitle:'10% discount on selected dishes',offerLabel:'Friday deal',imageUrl:'',cta:'See menu',status:'active',startsAt:null,endsAt:null,showPopup:true,autoCreative:true};
describe('GastroFlow restaurant advertisement and offer security',()=>{
  it('initializes only additive promotion tables and indexes',async()=>{
    const sql=[];await initPromotions(async statement=>sql.push(statement));
    expect(sql.length).toBe(4);expect(sql.join(' ')).not.toMatch(/DROP TABLE|DELETE FROM|ALTER TABLE/i);
  });
  it('requires a staff session and prevents any cross-tenant update',async()=>{
    const {app}=fixture();
    expect((await request(app).post('/api/food-promotions/manage').send(item)).status).toBe(401);
    const a=await request(app).post('/api/food-promotions/manage').set('Authorization','Bearer owner-a').send(item);
    expect(a.status).toBe(201);expect(a.body.campaign.tenantId).toBe('store-a');
    expect((await request(app).patch('/api/food-promotions/manage/'+a.body.campaign.id).set('Authorization','Bearer owner-b').send({...item,status:'paused'})).status).toBe(404);
    expect((await request(app).get('/api/food-promotions/manage').set('Authorization','Bearer owner-b')).body.campaigns).toEqual([]);
    expect((await request(app).get('/api/food-promotions/manage').set('Authorization','Bearer owner-a')).body.campaigns).toHaveLength(1);
  });
  it('publishes only active and current offers and hides suspended tenants',async()=>{
    const {app,tenants}=fixture();
    const create=body=>request(app).post('/api/food-promotions/manage').set('Authorization','Bearer owner-a').send(body);
    await create(item);
    await create({...item,title:'Draft offer',status:'draft'});
    await create({...item,title:'Expired offer',endsAt:Date.now()-2000});
    expect((await request(app).get('/api/public/food-promotions')).body.campaigns).toHaveLength(1);
    tenants[0].status='suspended';
    expect((await request(app).get('/api/public/food-promotions')).body.campaigns).toHaveLength(0);
  });
  it('counts valid live engagement only, without customer identity',async()=>{
    const {app}=fixture();
    const created=await request(app).post('/api/food-promotions/manage').set('Authorization','Bearer owner-a').send(item);
    const id=created.body.campaign.id;
    const allowed=await request(app).post('/api/public/food-promotions/'+id+'/events').send({event:'impression'});
    expect(allowed.status).toBe(200);expect(allowed.body.ok).toBe(true);
    expect((await request(app).post('/api/public/food-promotions/'+id+'/events').send({event:'purchase'})).status).toBe(400);
    expect((await request(app).post('/api/public/food-promotions/invalid/events').send({event:'click'})).status).toBe(400);
  });
  it('rejects untrusted promotion images and separates platform control',async()=>{
    const {app}=fixture();
    const bad=await request(app).post('/api/food-promotions/manage').set('Authorization','Bearer owner-a').send({...item,imageUrl:'javascript:alert(1)'});
    expect(bad.status).toBe(400);
    const unauthorized=await request(app).get('/api/platform/food-promotions').set('Authorization','Bearer owner-a');
    expect(unauthorized.status).toBe(403);
    const global=await request(app).post('/api/platform/food-promotions').set('Authorization','Bearer platform').send({...item,tenantId:null,title:'GastroFlow Weekend'});
    expect(global.status).toBe(201);expect(global.body.campaign.tenantId).toBeNull();
  });
});
