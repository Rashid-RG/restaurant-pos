import {describe,it,expect} from 'vitest';
import {deliveryPulseState} from '../apps/customer-web/src/utils/delivery-pulse.js';
describe('customer delivery pulse is grounded in confirmed states',()=>{
  it('shows a search phase without claiming the rider has been located',()=>{
    const s=deliveryPulseState({status:'preparing',assigned:false});
    expect(s.id).toBe('searching');
    expect(s.title).toMatch(/Looking/);
    expect(s.detail).toBe('Awaiting assignment');
    expect(s.eta).toBe(null);
  });
  it('distinguishes rider assignment from pickup',()=>{
    expect(deliveryPulseState({status:'preparing',assigned:true}).id).toBe('assigned');
    expect(deliveryPulseState({status:'ready',assigned:true}).id).toBe('assigned');
    expect(deliveryPulseState({status:'picked_up',assigned:true}).id).toBe('picked-up');
  });
  it('never claims live rider movement without fresh confirmed GPS',()=>{
    const delayed=deliveryPulseState({status:'out_for_delivery',assigned:true,gpsState:'delayed'});
    expect(delayed.description).toMatch(/Waiting for a fresh/);
    expect(delayed.detail).toMatch(/not live/);
    const fresh=deliveryPulseState({status:'out_for_delivery',assigned:true,gpsState:'fresh'});
    expect(fresh.detail).toMatch(/available/);
    expect(fresh.description).toMatch(/confirmed position/);
  });
  it('does not confuse arrived with delivery completion',()=>{
    expect(deliveryPulseState({status:'arrived'}).id).toBe('arrived');
    expect(deliveryPulseState({status:'delivered'}).id).toBe('delivered');
    expect(deliveryPulseState({status:'completed'}).id).toBe('delivered');
  });
  it('displays only valid server-backed estimates',()=>{
    expect(deliveryPulseState({status:'preparing',etaMinutes:15.4}).eta).toBe(16);
    for(const value of [undefined,null,0,-1,NaN,Infinity,'invalid',1500]){
      expect(deliveryPulseState({status:'preparing',etaMinutes:value}).eta).toBe(null);
    }
    expect(deliveryPulseState({status:'arrived',etaMinutes:30}).eta).toBe(null);
  });
});
