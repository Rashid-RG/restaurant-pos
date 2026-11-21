import {describe,it,expect} from 'vitest';
import {createH3RiderIndex} from './h3-rider-index.js';

const now=1800000000000;
const fix=(lat=6.9271,lng=79.8612)=>({lat,lng,accuracyMeters:10,updatedAt:now-1000});
const rider=(id,tenantId,position=fix(),more={})=>({
  id,tenantId,fix:position,status:'available',verified:true,onDuty:true,locationConsent:true,...more
});
const h3={
  latLngToCell:(lat,lng,res)=>`c:${Math.floor(lat*10)}:${Math.floor(lng*10)}:${res}`,
  isValidCell:cell=>typeof cell==='string'&&cell.startsWith('c:'),
  gridDisk:cell=>[cell]
};
describe('tenant-isolated H3 rider prefilter',()=>{
  it('requires H3 interface and safe resolution',()=>{
    expect(()=>createH3RiderIndex({})).toThrow();
    expect(()=>createH3RiderIndex(h3,{resolution:16})).toThrow();
  });
  it('does not mix restaurant rider location cells',()=>{
    const idx=createH3RiderIndex(h3);
    idx.replaceTenant('a',[rider('a1','a'),rider('b1','b')],now);
    idx.replaceTenant('b',[rider('b1','b')],now);
    expect(idx.nearby({tenantId:'a',origin:fix(),now}).map(r=>r.driverId)).toEqual(['a1']);
    expect(idx.nearby({tenantId:'b',origin:fix(),now}).map(r=>r.driverId)).toEqual(['b1']);
    expect(idx.nearby({tenantId:'c',origin:fix(),now})).toEqual([]);
  });
  it('removes expired and off-duty riders on atomic refresh',()=>{
    const idx=createH3RiderIndex(h3);
    idx.replaceTenant('a',[rider('fresh','a')],now);
    expect(idx.nearby({tenantId:'a',origin:fix(),now})).toHaveLength(1);
    idx.replaceTenant('a',[rider('fresh','a',fix(),{onDuty:false})],now);
    expect(idx.nearby({tenantId:'a',origin:fix(),now})).toEqual([]);
  });
  it('does not trust stored position indefinitely and clears tenant state',()=>{
    const idx=createH3RiderIndex(h3);
    idx.replaceTenant('a',[rider('a1','a')],now);
    expect(idx.nearby({tenantId:'a',origin:fix(),now:now+100000})).toEqual([]);
    idx.clearTenant('a');
    expect(idx.nearby({tenantId:'a',origin:fix(),now})).toEqual([]);
  });
});
