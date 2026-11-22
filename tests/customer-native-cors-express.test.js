import {describe,it,expect} from 'vitest';
import cors from 'cors';
import express from 'express';
import request from 'supertest';
import {resolveCustomerCorsOrigins,customerCorsOriginHandler,auditStagingNativeCorsConfig} from '../lib/customer-cors-policy.js';
const origins=['https://localhost','capacitor://localhost'];
const makeApp=({nativeOrigins='',corsOrigin='https://gastroflow-staging.onrender.com'}={})=>{
  const app=express();
  app.use(cors({
    origin:customerCorsOriginHandler({
      isProd:true,
      allowedOrigins:resolveCustomerCorsOrigins({isProd:true,corsOrigin,nativeOrigins})
    }),
    credentials:true
  }));
  app.get('/api/public/restaurants',(_req,res)=>res.json([]));
  app.get('/api/private',(_req,res)=>res.status(401).json({error:'Requires authentication'}));
  return app;
};
describe('actual Express CORS middleware for installed GastroFlow Food Android and iOS',()=>{
  it.each(origins)('accepts exact configured native origin %s for simple discovery GET and credentialed OPTIONS',async origin=>{
    const app=makeApp({nativeOrigins:origins.join(',')});
    const get=await request(app).get('/api/public/restaurants').set('Origin',origin);
    expect(get.status).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBe(origin);
    expect(get.headers['access-control-allow-credentials']).toBe('true');
    const preflight=await request(app).options('/api/public/restaurants')
      .set('Origin',origin).set('Access-Control-Request-Method','GET')
      .set('Access-Control-Request-Headers','content-type,x-tenant-id,authorization,x-order-tracking');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-headers'])
      .toContain('x-tenant-id');
    expect(preflight.headers['access-control-allow-headers'])
      .toContain('authorization');
  });
  it('keeps private API authorization even for approved WebView origins',async()=>{
    const app=makeApp({nativeOrigins:origins.join(',')});
    const r=await request(app).get('/api/private').set('Origin',origins[0]);
    expect(r.status).toBe(401);
    expect(r.headers['access-control-allow-origin']).toBe(origins[0]);
  });
  it('does not allow either native WebView origin without explicit native opt-in',async()=>{
    const app=makeApp();
    for(const origin of origins){
      const r=await request(app).get('/api/public/restaurants').set('Origin',origin);
      expect(r.status).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('never authorizes wildcard, lookalike or arbitrary browser origins',async()=>{
    const app=makeApp({nativeOrigins:origins.join(',')});
    for(const origin of ['https://localhost.evil.example','http://localhost','capacitor://evil.example','null']){
      const r=await request(app).get('/api/public/restaurants').set('Origin',origin);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('preserves explicitly allowed browser origins alongside native origins',async()=>{
    const app=makeApp({nativeOrigins:origins.join(',')});
    const r=await request(app).get('/api/public/restaurants').set('Origin','https://gastroflow-staging.onrender.com');
    expect(r.headers['access-control-allow-origin']).toBe('https://gastroflow-staging.onrender.com');
  });
  it('does not accidentally accept unsafe or incomplete staging native configuration',()=>{
    expect(auditStagingNativeCorsConfig({nativeOrigins:origins.join(','),corsOrigin:'https://gastroflow-staging.onrender.com'}).ready).toBe(true);
    expect(auditStagingNativeCorsConfig({nativeOrigins:'https://localhost'}).missingNativeOrigins).toContain('capacitor://localhost');
    expect(auditStagingNativeCorsConfig({nativeOrigins:'https://localhost,capacitor://localhost,*'}).ready).toBe(false);
    expect(auditStagingNativeCorsConfig({nativeOrigins:origins.join(','),corsOrigin:'https://localhost'}).ready).toBe(false);
  });
});
