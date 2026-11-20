import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createRiderPresenceRouter} from './rider-presence.js';
import {createRiderPresence} from '../lib/delivery/rider-presence.js';

const now=1800000000000;
function setup({enabled=true,status='available',verified=true}={}){
  const presence=createRiderPresence({clock:()=>now});
  const app=express();app.use(express.json());
  const authenticateDriver=(req,res,next)=>{
    if(req.headers.authorization!=='Bearer rider-a')return res.sendStatus(401);
    req.driver={tenant_id:'tenant-a',driverId:'rider-a'};next();
  };
  const authenticateToken=(req,res,next)=>{
    if(req.headers.authorization!=='Bearer manager-a')return res.sendStatus(401);
    req.tenantId='tenant-a';next();
  };
  const requireRole=()=>((req,res,next)=>next());
  const dbGet=vi.fn(async()=>status==='missing'?null:{
    status,licenseReviewRequired:verified?0:1,licenseVerifiedUntil:verified?now+100000:null,
    manualReview:null,identityReview:null
  });
  const dbAll=vi.fn(async()=>status==='available'?[{id:'rider-a'}]:[]);
  app.use('/api',createRiderPresenceRouter({
    express,authenticateDriver,authenticateToken,requireRole,dbGet,dbAll,
    presence,enabled,clock:()=>now
  }));
  return {app,presence,dbGet,dbAll};
}
const ping={lat:6.9271,lng:79.8612,accuracyMeters:12,recordedAt:now-1000,consent:true};
describe('rider-presence API security',()=>{
  it('is opt-in disabled by default',async()=>{
    const {app}=setup({enabled:false});
    expect((await request(app).post('/api/public/driver/on-duty-location')
      .set('Authorization','Bearer rider-a').send(ping)).status).toBe(404);
  });
  it('requires rider identity and explicit consent',async()=>{
    const {app}=setup();
    expect((await request(app).post('/api/public/driver/on-duty-location').send(ping)).status).toBe(401);
    expect((await request(app).post('/api/public/driver/on-duty-location')
      .set('Authorization','Bearer rider-a').send({...ping,consent:false})).body.sharing).toBe(false);
  });
  it('does not track offline or unverified riders',async()=>{
    for(const config of [{status:'offline'},{verified:false}]){
      const {app,presence}=setup(config);
      const result=await request(app).post('/api/public/driver/on-duty-location')
        .set('Authorization','Bearer rider-a').send(ping);
      expect(result.status).toBe(403);
      expect(presence.list('tenant-a')).toEqual([]);
    }
  });
  it('returns only tenant-scoped anonymized candidate summary to authorized staff',async()=>{
    const {app}=setup();
    expect((await request(app).get('/api/delivery/nearby-riders?lat=6.9271&lng=79.8612')).status).toBe(401);
    expect((await request(app).post('/api/public/driver/on-duty-location')
      .set('Authorization','Bearer rider-a').send(ping)).status).toBe(200);
    const response=await request(app).get('/api/delivery/nearby-riders?lat=6.9271&lng=79.8612')
      .set('Authorization','Bearer manager-a');
    expect(response.status).toBe(200);
    expect(response.body.candidates[0].driverId).toBe('rider-a');
    expect(response.body.candidates[0].lat).toBeUndefined();
    expect(response.body.candidates[0].lng).toBeUndefined();
    expect((await request(app).post('/api/public/driver/off-duty-location')
      .set('Authorization','Bearer rider-a')).status).toBe(200);
    const after=await request(app).get('/api/delivery/nearby-riders?lat=6.9271&lng=79.8612')
      .set('Authorization','Bearer manager-a');
    expect(after.body.candidates).toEqual([]);
  });
});
