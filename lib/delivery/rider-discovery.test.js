import {describe,it,expect} from 'vitest';
import {eligibleNearbyRiders,riderDistanceMeters,MAX_RIDER_FIX_AGE_MS} from './rider-discovery.js';

const now=1800000000000,origin={lat:6.9271,lng:79.8612};
function rider(change={}){
  return {id:'drv1',tenantId:'restaurant-a',status:'available',verified:true,
    onDuty:true,locationConsent:true,fix:{lat:6.928,lng:79.862,
      accuracyMeters:12,updatedAt:now-1000},...change};
}
describe('private rider proximity policy',()=>{
  it('filters unrelated restaurants even when physically closer',()=>{
    const list=eligibleNearbyRiders({tenantId:'restaurant-a',origin,now,
      riders:[rider({id:'other',tenantId:'restaurant-b',fix:{...rider().fix,lat:origin.lat,lng:origin.lng}}),rider()]});
    expect(list.map(x=>x.driverId)).toEqual(['drv1']);
  });
  it('requires verified on-duty consented available rider positions',()=>{
    const changes=[
      {verified:false},{onDuty:false},{locationConsent:false},
      {status:'busy'},{status:'offline'},{fix:{...rider().fix,updatedAt:now-MAX_RIDER_FIX_AGE_MS-1}},
      {fix:{...rider().fix,accuracyMeters:200}},{fix:{...rider().fix,lat:999}},
      {fix:{...rider().fix,updatedAt:now+11000}}
    ];
    for(const change of changes)
      expect(eligibleNearbyRiders({tenantId:'restaurant-a',origin,now,riders:[rider(change)]})).toEqual([]);
  });
  it('sorts eligible riders by straight line distance and never emits GPS coordinates',()=>{
    const list=eligibleNearbyRiders({tenantId:'restaurant-a',origin,now,
      riders:[rider({id:'far',fix:{...rider().fix,lat:6.95}}),
        rider({id:'near',fix:{...rider().fix,lat:6.928}})]});
    expect(list.map(x=>x.driverId)).toEqual(['near','far']);
    expect(list[0]).toEqual({driverId:'near',distanceMeters:expect.any(Number),locationAgeMs:1000});
    expect('lat' in list[0]).toBe(false);
  });
  it('ignores duplicate rider IDs and invalid search inputs',()=>{
    expect(eligibleNearbyRiders({tenantId:'restaurant-a',origin,now,riders:[rider(),rider()]})).toHaveLength(1);
    expect(eligibleNearbyRiders({tenantId:'',origin,now,riders:[rider()]})).toEqual([]);
    expect(eligibleNearbyRiders({tenantId:'restaurant-a',origin:{lat:999,lng:0},now,riders:[rider()]})).toEqual([]);
    expect(riderDistanceMeters(origin,{lat:999,lng:80})).toBe(Infinity);
  });
});
