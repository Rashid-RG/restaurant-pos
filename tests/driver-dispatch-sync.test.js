import {describe,it,expect,vi} from 'vitest';
import {createDispatchRequestGate,createDispatchTimeout,shouldRetainTrackedOrder,shouldClearTrackedOrder,latestDispatchTickets} from '../apps/driver-web/src/utils/dispatch-sync.js';

describe('GastroDriver dispatch refresh reliability',()=>{
 it('allows only one in-flight request and invalidates responses after logout',()=>{
   const gate=createDispatchRequestGate();
   const first=gate.start();
   expect(typeof first).toBe('number');
   expect(gate.start()).toBe(null);
   expect(gate.isCurrent(first)).toBe(true);
   gate.finish(first);
   const next=gate.start();
   expect(next).not.toBe(first);
   expect(gate.isCurrent(first)).toBe(false);
   gate.invalidate();
   expect(gate.isCurrent(next)).toBe(false);
   expect(gate.start()).not.toBe(null);
 });
 it('keeps validated dispatch ticket arrays without inventing assignments',()=>{
   const data=latestDispatchTickets({assigned:[{id:'o1'}],unassigned:'invalid',completed:null});
   expect(data.assigned).toEqual([{id:'o1'}]);
   expect(data.unassigned).toEqual([]);
   expect(data.completed).toEqual([]);
 });
 it('clears private tracking snapshots on revoked, expired and unknown-order access',()=>{
   for(const status of [401,403,404,410]) {
     expect(shouldClearTrackedOrder({status})).toBe(true);
     expect(shouldRetainTrackedOrder({status})).toBe(false);
   }
   for(const error of [{status:408},{status:429},{status:503},new Error('Network lost')]) {
     expect(shouldClearTrackedOrder(error)).toBe(false);
     expect(shouldRetainTrackedOrder(error)).toBe(true);
   }
 });
 it('aborts a stalled refresh after a bounded timeout and lets the gate recover',()=>{
   vi.useFakeTimers();
   try{
     const gate=createDispatchRequestGate();
     const first=gate.start();
     const request=createDispatchTimeout(12000);
     expect(request.signal.aborted).toBe(false);
     vi.advanceTimersByTime(12000);
     expect(request.signal.aborted).toBe(true);
     gate.finish(first);
     const next=gate.start();
     expect(next).not.toBe(first);
     request.finish();
     const cancelled=createDispatchTimeout(12000);
     cancelled.cancel();
     expect(cancelled.signal.aborted).toBe(true);
   }finally{vi.useRealTimers();}
 });
 it('preserves last known order during transient outages',()=>{
   expect(shouldRetainTrackedOrder(new Error('Failed to fetch'))).toBe(true);
   expect(shouldRetainTrackedOrder({status:503})).toBe(true);
   expect(shouldRetainTrackedOrder({status:408})).toBe(true);
   expect(shouldRetainTrackedOrder({status:404})).toBe(false);
   expect(shouldRetainTrackedOrder({status:403})).toBe(false);
 });
});
