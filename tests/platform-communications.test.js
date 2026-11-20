import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createPlatformCommunicationsRouter,validateOwnerAudience,
  ownerRecipientEligible,safeOwnerScope,dispatchDueOwnerAnnouncements,recordOwnerInboxDelivery
} from '../routes/platform-communications.js';

describe('Platform owner announcement targeting',()=>{
  it('creates idempotent tenant-specific in-app delivery records',async()=>{
    const dbRun=vi.fn(async()=>({changes:1}));
    const event={announcementId:'a1',tenantId:'tenant_a',userId:'owner_a',at:1234567};
    await recordOwnerInboxDelivery(dbRun,event);
    const [sql,args]=dbRun.mock.calls[0];
    expect(sql).toMatch(/INSERT OR IGNORE INTO platform_owner_communication_deliveries/);
    expect(sql).toMatch(/'in_app','delivered'/);
    expect(args.slice(0,3)).toEqual(['a1','tenant_a','owner_a']);
    expect(args).not.toContain('tenant_b');
  });
  it('rejects unspecified restaurant selection',()=>{
    expect(validateOwnerAudience({scope:'specific',tenantIds:[]}).success).toBe(false);
    expect(validateOwnerAudience({scope:'specific',tenantIds:['tenant_a']}).success).toBe(true);
    expect(validateOwnerAudience({scope:'all',tenantIds:[]}).success).toBe(true);
  });
  it('requires active tenant and a real owner identity',()=>{
    const base={userId:'u1',tenantId:'tenant_a',role:'owner',status:'active',isPlatformAdmin:0};
    expect(ownerRecipientEligible(base)).toBe(true);
    expect(ownerRecipientEligible({...base,role:'manager'})).toBe(false);
    expect(ownerRecipientEligible({...base,status:'suspended'})).toBe(false);
    expect(ownerRecipientEligible({...base,isPlatformAdmin:1})).toBe(false);
  });
  it('does not allow cross-tenant access',()=>{
    expect(safeOwnerScope({id:'u1',role:'owner',tenant_id:'tenant_a'},'tenant_b')).toBe(false);
    expect(safeOwnerScope({id:'u1',role:'owner',tenant_id:'tenant_a'},'tenant_a')).toBe(true);
    expect(safeOwnerScope({id:'u1',role:'manager',tenant_id:'tenant_a'},'tenant_a')).toBe(false);
  });
  const fixture=({actor={id:'u_a',role:'owner',tenant_id:'tenant_a',isPlatformAdmin:0},enabled=true}={})=>{
    const dbGet=vi.fn(async(sql,args)=>{
      if(sql.includes('SELECT status FROM tenants')) return {status:'active'};
      if(sql.includes('SELECT a.id,a.requiresAcknowledgment')){
        return args?.[1]==='u_a'&&args?.[2]==='tenant_a'?{id:'notice1',requiresAcknowledgment:1}:null;
      }
      return null;
    });
    const dbAll=vi.fn(async(sql,args)=>{
      if(sql.includes('FROM platform_owner_announcements a'))return [
        {id:'notice1',title:'Tenant A notice',body:'Message',readAt:null}
      ];
      return [];
    });
    const dbRun=vi.fn(async()=>({changes:1}));
    const router=createPlatformCommunicationsRouter({
      dbGet,dbAll,dbRun,authenticateToken:(req,res,next)=>{req.user=actor;next();},
      requirePlatformAdmin:(req,res,next)=>res.status(403).json({error:'Platform role required.'}),
      env:{PLATFORM_COMMUNICATIONS_ENABLED:enabled?'true':'false',PLATFORM_COMMUNICATIONS_STAGE:'staging'}
    });
    const app=express();app.use(express.json());app.use('/api',router);
    return {app,dbGet,dbAll,dbRun};
  };
  it('requires staging stage even if enabled',async()=>{
    const f=fixture();
    const router=createPlatformCommunicationsRouter({
      dbGet:f.dbGet,dbAll:f.dbAll,dbRun:f.dbRun,
      authenticateToken:(req,res,next)=>{req.user={id:'u_a',role:'owner',tenant_id:'tenant_a'};next()},
      requirePlatformAdmin:(req,res,next)=>res.status(403).end(),
      env:{PLATFORM_COMMUNICATIONS_ENABLED:'true',PLATFORM_COMMUNICATIONS_STAGE:'production'}
    });
    const app=express();app.use(express.json());app.use('/api',router);
    expect((await request(app).get('/api/owner/communications')).status).toBe(404);
    expect((await request(app).get('/api/platform/communications')).status).toBe(404);
  });
  it('fails closed while disabled',async()=>{
    const f=fixture({enabled:false});
    expect((await request(f.app).get('/api/owner/communications')).status).toBe(404);
    expect(f.dbAll).not.toHaveBeenCalled();
  });
  it('denies owners access to platform email readiness',async()=>{
    const f=fixture();
    expect((await request(f.app).get('/api/platform/communications/email/status')).status).toBe(403);
  });
  it('denies owner access to platform templates',async()=>{
    const f=fixture();
    expect((await request(f.app).get('/api/platform/communications/templates')).status).toBe(403);
    expect((await request(f.app).post('/api/platform/communications/templates').send({
      name:'Example',title:'Example message',body:'This is an example',category:'announcement'
    })).status).toBe(403);
  });
  it('never allows restaurant owners to publish',async()=>{
    const f=fixture();
    expect((await request(f.app).post('/api/platform/communications').send({})).status).toBe(403);
  });
  it('scopes the owner inbox query to signed-in user and tenant',async()=>{
    const f=fixture();
    const response=await request(f.app).get('/api/owner/communications');
    expect(response.status).toBe(200);
    expect(f.dbAll.mock.calls[0][1]).toEqual(['tenant_a','u_a',expect.any(Number)]);
  });
  it('never accepts a tenant ID from a request body for acknowledgment',async()=>{
    const f=fixture();
    const r=await request(f.app).post('/api/owner/communications/notice1/acknowledge').send({tenantId:'tenant_b'});
    expect(r.status).toBe(200);
    expect(f.dbRun.mock.calls[0][1].slice(-3)).toEqual(['notice1','tenant_a','u_a']);
  });
  it('does not dispatch an announcement that is no longer scheduled',async()=>{
    const dbAll=vi.fn(async()=>[{id:'notice1',status:'scheduled',audienceJson:'{"scope":"all","tenantIds":[]}',expiresAt:null}]);
    const dbGet=vi.fn(async()=>({status:'cancelled'}));
    const dbRun=vi.fn(async()=>({changes:1}));
    const result=await dispatchDueOwnerAnnouncements({dbAll,dbGet,dbRun,now:Date.now()});
    expect(result).toEqual([]);
    expect(dbRun.mock.calls.map(x=>x[0])).toEqual(['BEGIN TRANSACTION','ROLLBACK']);
  });
  it('marks already expired scheduled notices cancelled, without notifying owners',async()=>{
    const dbAll=vi.fn(async()=>[{id:'notice_expired',status:'scheduled',expiresAt:1000}]);
    const dbGet=vi.fn(async()=>({status:'scheduled',expiresAt:1000}));
    const dbRun=vi.fn(async()=>({changes:1}));
    const result=await dispatchDueOwnerAnnouncements({dbAll,dbGet,dbRun,now:2000});
    expect(result).toEqual([{id:'notice_expired',status:'expired'}]);
    expect(dbRun.mock.calls.some(x=>x[0].includes('announcement_recipients'))).toBe(false);
  });
  it('rejects a manager inbox request',async()=>{
    const f=fixture({actor:{id:'mgr',role:'manager',tenant_id:'tenant_a'}});
    expect((await request(f.app).get('/api/owner/communications')).status).toBe(403);
  });
});
