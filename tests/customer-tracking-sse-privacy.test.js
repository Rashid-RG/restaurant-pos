import {describe,it,expect} from 'vitest';
import {publicTrackingEvent,loadAssignedDriverLocation} from '../lib/order-tracking.js';

describe('customer SSE privacy boundary (CUST-136)',()=>{
  it('only emits the approved customer order DTO, excluding internal order fields',()=>{
    const payload={id:'order-1',status:'picked_up',total:1200,items:[{name:'Rice',price:1200,quantity:1}],tenant_id:'other-store',customerAccountId:'private',loyaltyPointsReserved:20,driverId:'internal',internalNotes:'hidden',paymentProviderSecret:'private'};
    expect(publicTrackingEvent(payload)).toEqual({id:'order-1',total:1200,status:'picked_up',items:[{name:'Rice',price:1200,quantity:1}]});
  });
  it('only emits accepted rider location fields',()=>{
    expect(publicTrackingEvent({type:'driver_location',lat:6.9,lng:79.8,updatedAt:100,accuracyMeters:9,driverName:'Rider',driverPhone:'private',tenant_id:'secret'}))
      .toEqual({type:'driver_location',lat:6.9,lng:79.8,driverName:'Rider',updatedAt:100,accuracyMeters:9});
  });
  it('does not expose a stale location for an unassigned or different driver',async()=>{
    const calls=[];
    const lookup=async(sql,params)=>{calls.push({sql,params});return {lat:6.92,lng:79.85,driverName:'Driver B'};};
    expect(await loadAssignedDriverLocation(lookup,'order-1','store-A',null)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await loadAssignedDriverLocation(lookup,'order-1','store-A','driver-B')).toMatchObject({driverName:'Driver B'});
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['driver-B','store-A','order-1']);
    expect(calls[0].sql).toMatch(/JOIN drivers d/);
    expect(calls[0].sql).toMatch(/d\\.tenant_id = \\?/);
    expect(calls[0].sql).toMatch(/dl\\.driverName = d\\.name/);
  });
  it('preserves assignment notification without internal dispatch details',()=>{
    expect(publicTrackingEvent({type:'driver_assigned',orderId:'order-1',driverToken:'secret'})).toEqual({type:'driver_assigned',orderId:'order-1'});
    expect(publicTrackingEvent({type:'driver_assigned'})).toBeNull();
    expect(publicTrackingEvent({type:'unexpected',token:'secret'})).toBeNull();
    expect(publicTrackingEvent(null)).toBeNull();
  });
});
