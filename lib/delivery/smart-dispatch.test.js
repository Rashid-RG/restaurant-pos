import {describe,it,expect,vi} from 'vitest';
import {rankDispatchRiders} from './smart-dispatch.js';
const now=1800000000000;
const pickup={lat:6.9271,lng:79.8612};
function fixture({records=[],allowed=['a','b'],estimateRoad}={}){
  const presence={list:vi.fn(async tenant=>records.filter(f=>f.tenantId===tenant))};
  const dbAll=vi.fn(async(_sql,params)=>{
    expect(params).toEqual(['restaurant-a']);
    return allowed.map(id=>({id,status:'available',licenseReviewRequired:0,licenseVerifiedUntil:now+100000}));
  });
  return {presence,dbAll,estimateRoad,tenantId:'restaurant-a',pickup,clock:()=>now};
}
const fix=(driverId,changes={})=>({
  tenantId:'restaurant-a',driverId,lat:6.9271,lng:79.8612,
  accuracyMeters:8,recordedAt:now-1000,...changes
});
describe('consented H3 / OSRM auto-dispatch shortlist',()=>{
  it('never includes riders from another tenant or offline riders',async()=>{
    const deps=fixture({records:[fix('a'),fix('b',{tenantId:'restaurant-b'}),fix('c')],
      allowed:['a']});
    expect((await rankDispatchRiders(deps)).map(x=>x.driverId)).toEqual(['a']);
    expect(deps.presence.list).toHaveBeenCalledWith('restaurant-a');
  });
  it('refuses riders whose current approval is revoked',async()=>{
    const deps=fixture({records:[fix('a')],allowed:[]});
    expect(await rankDispatchRiders(deps)).toEqual([]);
  });
  it('rejects stale, inaccurate, and distant positions',async()=>{
    const deps=fixture({records:[
      fix('a',{accuracyMeters:250}),
      fix('b',{recordedAt:now-200000})
    ]});
    expect(await rankDispatchRiders(deps)).toEqual([]);
  });
  it('sorts by valid OSRM travel time without revealing raw GPS',async()=>{
    const estimateRoad=vi.fn(async({from})=>from.lat>6.928?2:7);
    const deps=fixture({records:[fix('a'),fix('b',{lat:6.929})],estimateRoad});
    const result=await rankDispatchRiders(deps);
    expect(result.map(x=>x.driverId)).toEqual(['b','a']);
    expect(result.map(x=>x.roadTravelMinutes)).toEqual([2,7]);
    expect(result[0]).not.toHaveProperty('lat');
    expect(result[0]).not.toHaveProperty('lng');
  });
  it('degrades to proximity when no router is available',async()=>{
    const deps=fixture({records:[fix('a'),fix('b',{lat:6.929})],
      estimateRoad:async()=>{throw new Error('routing down');}});
    const result=await rankDispatchRiders(deps);
    expect(result.map(x=>x.driverId)).toEqual(['a','b']);
    expect(result[0]).not.toHaveProperty('roadTravelMinutes');
  });
  it('does not start a search without a valid tenant and pickup location',async()=>{
    const deps=fixture({records:[fix('a')]});
    expect(await rankDispatchRiders({...deps,tenantId:''})).toEqual([]);
    expect(await rankDispatchRiders({...deps,pickup:{lat:999,lng:80}})).toEqual([]);
    expect(deps.presence.list).not.toHaveBeenCalled();
  });
});
