import {describe,it,expect} from 'vitest';
import {createDispatchRequestGate,shouldRetainTrackedOrder,latestDispatchTickets} from '../apps/driver-web/src/utils/dispatch-sync.js';

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
 it('preserves last known order during transient outages',()=>{
   expect(shouldRetainTrackedOrder(new Error('Failed to fetch'))).toBe(true);
   expect(shouldRetainTrackedOrder({status:503})).toBe(true);
   expect(shouldRetainTrackedOrder({status:408})).toBe(true);
   expect(shouldRetainTrackedOrder({status:404})).toBe(false);
   expect(shouldRetainTrackedOrder({status:403})).toBe(false);
 });
});
