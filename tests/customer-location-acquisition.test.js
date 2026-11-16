import {describe,it,expect,vi} from 'vitest';
import {validatePosition,inSriLankaBounds,permissionAllowsAutomaticLocation,acquireBestLocation} from '../apps/customer-web/src/utils/location-acquisition.js';

describe('Customer location acquisition',()=>{
  it('accepts finite accurate fixes and rejects imprecise or invalid coordinates',()=>{
    expect(validatePosition({coords:{latitude:6.9271,longitude:79.8612,accuracy:35}})).toMatchObject({lat:6.9271,lng:79.8612,accuracy:35,source:'gps'});
    expect(validatePosition({coords:{latitude:6.9271,longitude:79.8612,accuracy:2500}})).toBe(null);
    expect(validatePosition({coords:{latitude:NaN,longitude:79.8,accuracy:20}})).toBe(null);
    expect(inSriLankaBounds({lat:6.9,lng:79.8})).toBe(true);
    expect(inSriLankaBounds({lat:51.5,lng:-0.1})).toBe(false);
  });
  it('automatically locates only when permission was already granted',async()=>{
    const query=vi.fn(async()=>({state:'prompt'}));
    expect(await permissionAllowsAutomaticLocation({query})).toBe(false);
    expect(await permissionAllowsAutomaticLocation({query:async()=>({state:'denied'})})).toBe(false);
    expect(await permissionAllowsAutomaticLocation({query:async()=>({state:'granted'})})).toBe(true);
    expect(await permissionAllowsAutomaticLocation(null)).toBe(false);
  });
  it('tries accuracy-first and uses coarse fallback only when high accuracy fails',async()=>{
    const options=[];
    const geo={getCurrentPosition(resolve,reject,opts){
      options.push(opts);
      if(opts.enableHighAccuracy)reject({code:3});
      else resolve({coords:{latitude:7.291,longitude:80.63,accuracy:650}});
    }};
    const result=await acquireBestLocation(geo);
    expect(result.accuracy).toBe(650);
    expect(options.map(x=>x.enableHighAccuracy)).toEqual([true,false]);
  });
  it('never retries a denied location permission and never invents a pin',async()=>{
    const geo={getCurrentPosition(_resolve,reject){reject({code:1});}};
    await expect(acquireBestLocation(geo)).rejects.toThrow(/denied/i);
    await expect(acquireBestLocation(null)).rejects.toThrow(/unavailable/i);
  });
});
