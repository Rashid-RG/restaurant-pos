import {describe,it,expect} from 'vitest';
import {readDeliveryZones,zoneIssue} from './zones.js';
import {createDeliveryFeeCalculator} from './fee.js';

const square=(start,end)=>[[start,start],[end,start],[end,end],[start,end]];
const include={kind:'include',points:square(1,4)},exclude={kind:'exclude',points:square(2,3)};
describe('restaurant delivery areas',()=>{
  it('includes boundary entrances and gives exclusions priority on shared boundaries',()=>{
    const zones=readDeliveryZones(JSON.stringify([include,exclude]));
    expect(zoneIssue(zones,{lat:1,lng:3})).toBeNull();
    expect(zoneIssue(zones,{lat:2,lng:3})).toBe('excluded_area');
    expect(zoneIssue(zones,{lat:5,lng:3})).toBe('outside_delivery_area');
  });
  it('rejects intersecting, collinear and invalid polygons',()=>{
    for(const points of [[[0,0],[2,2],[2,0],[0,2]],[[0,0],[1,1],[2,2]],[[181,0],[2,2],[1,2]]])
      expect(()=>readDeliveryZones([{kind:'include',points}])).toThrow();
  });
  it('applies only the selected tenant’s areas before calculating road or free delivery',async()=>{
    let calls=0;
    const quote=createDeliveryFeeCalculator({getSettingsMap:async id=>({storeLat:2.5,storeLng:2.5,deliveryZones:id==='one'?JSON.stringify([exclude]):'[]',deliveryDistanceMode:'road'}),
      isPeakHour:async()=>false,getRoadRoute:async()=>{calls++;return {distanceMeters:300,travelMinutes:1};}});
    expect((await quote(2.5,2.5,5000,'one')).coverageIssue).toBe('excluded_area');
    expect(calls).toBe(0);
    expect((await quote(2.5,2.5,5000,'two')).isFreeDelivery).toBe(true);
    expect(calls).toBe(1);
  });
});
