import {describe,it,expect} from 'vitest';
import request from 'supertest';
import {createDatabaseReadiness} from '../lib/database-readiness.js';

describe('Database health readiness after startup',()=>{
 it('never reports connected before initialization or a successful database probe',()=>{
   let time=1000;const state=createDatabaseReadiness({now:()=>time,freshMs:45000});
   expect(state.isReady(false)).toBe(false);
   expect(state.status(false)).toBe('initializing');
   expect(state.isReady(true)).toBe(false);
   expect(state.status(true)).toBe('unavailable');
   state.recordSuccess();
   expect(state.isReady(true)).toBe(true);
   expect(state.status(true)).toBe('connected');
 });
 it('reports unavailable after a failed probe, recovers and ages out stale signals',()=>{
   let time=1000;const state=createDatabaseReadiness({now:()=>time,freshMs:45000});
   state.recordSuccess();time+=10000;state.recordFailure();
   expect(state.isReady(true)).toBe(false);
   time+=100;state.recordSuccess();
   expect(state.isReady(true)).toBe(true);
   time+=45001;
   expect(state.isReady(true)).toBe(false);
   expect(state.status(true)).toBe('unavailable');
   state.recordSuccess();
   expect(state.isReady(true)).toBe(true);
 });
 it('does not reveal database configuration in the public health payload',async()=>{
   const {app,dbReady}=await import('../server.js');
   await dbReady;
   const res=await request(app).get('/api/health');
   expect(res.status,res.text).toBe(200);
   expect(res.body).toMatchObject({status:'ok',database:'connected'});
   expect(res.headers['cache-control']).toBe('no-store');
   expect(JSON.stringify(res.body)).not.toMatch(/turso|token|password|database_url|sqlite/i);
 });
});
