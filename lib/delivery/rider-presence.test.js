import {describe,it,expect} from 'vitest';
import {createRiderPresence} from './rider-presence.js';
const now=1800000000000;
const create=()=>createRiderPresence({clock:()=>now,ttlMs:90000,maxEntries:2});
const point=(patch={})=>({
  tenantId:'tenant-a',driverId:'rider-a',lat:6.9271,lng:79.8612,
  accuracyMeters:12,recordedAt:now-1000,consent:true,...patch
});
describe('ephemeral restaurant rider presence',()=>{
  it('requires explicit consent and fresh valid GPS',()=>{
    const store=create();
    for(const bad of [{consent:false},{lat:NaN},{lat:99},{lng:-181},
      {accuracyMeters:151},{recordedAt:now-31000},{recordedAt:now+11000}]){
      expect(store.record(point(bad)).accepted).toBe(false);
    }
    expect(store.list('tenant-a')).toEqual([]);
  });
  it('separates tenants and refuses replay',()=>{
    const store=create();
    expect(store.record(point()).accepted).toBe(true);
    expect(store.record(point()).reason).toBe('old_fix');
    expect(store.list('tenant-b')).toEqual([]);
    expect(store.list('tenant-a')).toEqual([{
      tenantId:'tenant-a',driverId:'rider-a',lat:6.9271,lng:79.8612,
      accuracyMeters:12,recordedAt:now-1000
    }]);
    expect(store.revoke('tenant-b','rider-a')).toBe(false);
    expect(store.revoke('tenant-a','rider-a')).toBe(true);
    expect(store.list('tenant-a')).toEqual([]);
  });
  it('expires entries and caps memory',()=>{
    let tick=now;
    const store=createRiderPresence({clock:()=>tick,ttlMs:90000,maxEntries:1});
    expect(store.record(point()).accepted).toBe(true);
    expect(store.record(point({driverId:'rider-b'})).reason).toBe('at_capacity');
    tick+=91000;
    expect(store.list('tenant-a')).toEqual([]);
    expect(store.record(point({driverId:'rider-b',recordedAt:tick-1000})).accepted).toBe(true);
  });
});
