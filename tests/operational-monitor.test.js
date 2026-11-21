import {describe,it,expect} from 'vitest';
import {createOperationalMonitor} from '../lib/operational-monitor.js';

describe('Safe operational monitoring',()=>{
 it('raises one incident after three consecutive failed probes then one recovery notice',()=>{
  let time=1_700_000_000_000;const logs=[];
  const m=createOperationalMonitor({now:()=>time,log:row=>logs.push(row)});
  m.probeFailed();m.probeFailed();
  expect(logs).toEqual([]);
  m.probeFailed();m.probeFailed();
  expect(logs.map(x=>x.event)).toEqual(['database_unavailable']);
  expect(m.getIncidentOpen()).toBe(true);
  m.probeSucceeded();m.probeSucceeded();
  expect(logs.map(x=>x.event)).toEqual(['database_unavailable','database_recovered']);
  expect(m.getIncidentOpen()).toBe(false);
  m.probeFailed();m.probeFailed();m.probeSucceeded();
  expect(logs).toHaveLength(2);
  m.probeFailed();m.probeFailed();m.probeFailed();
  expect(logs.at(-1).event).toBe('database_unavailable');
 });
 it('reports only slow sanitized route patterns and rate-limits repeated logs',()=>{
  let time=1_700_000_000_000;const logs=[];
  const m=createOperationalMonitor({now:()=>time,log:row=>logs.push(row),slowRequestMs:2000});
  m.recordRequest({method:'POST',route:'/api/public/orders/:id',status:201,durationMs:1800});
  expect(logs).toHaveLength(0);
  m.recordRequest({method:'POST',route:'/api/public/orders/:id',status:201,durationMs:2300});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({event:'slow_http_request',route:'/api/public/orders/:id',status:201,durationMs:2300});
  m.recordRequest({method:'POST',route:'/api/public/orders/:id',status:500,durationMs:9000});
  expect(logs).toHaveLength(1);
  time+=60001;
  m.recordRequest({method:'POST',route:'/api/public/orders/:id',status:503,durationMs:2800});
  expect(logs).toHaveLength(2);
 });
 it('never emits personal request URLs, tokens or arbitrary route strings',()=>{
  const logs=[];const m=createOperationalMonitor({log:row=>logs.push(row)});
  m.recordRequest({method:'GET',route:'/api/orders/secret-person?token=secret',status:200,durationMs:1900});
  m.recordRequest({method:'BREACH',route:'/api/orders/jane@example.test',status:902,durationMs:4000});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({method:'OTHER',route:'[unmatched]',status:500});
  expect(JSON.stringify(logs)).not.toMatch(/secret-person|secret|jane@example|token/i);
 });
});
