import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createPlatformCommunicationsRouter,validateOwnerAudience,
  ownerRecipientEligible,safeOwnerScope
} from '../routes/platform-communications.js';

describe('Platform owner announcement targeting',()=>{
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
      env:{PLATFORM_COMMUNICATIONS_ENABLED:enabled?'true':'false'}
    });
    const app=express();app.use(express.json());app.use('/api',router);
    return {app,dbGet,dbAll,dbRun};
  };
  it('fails closed while disabled',async()=>{
    const f=fixture({enabled:false});
    expect((await request(f.app).get('/api/owner/communications')).status).toBe(404);
    expect(f.dbAll).not.toHaveBeenCalled();
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
  it('rejects a manager inbox request',async()=>{
    const f=fixture({actor:{id:'mgr',role:'manager',tenant_id:'tenant_a'}});
    expect((await request(f.app).get('/api/owner/communications')).status).toBe(403);
  });
});
