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
  it('retries coarse GPS when a reported high-accuracy fix is too imprecise',async()=>{
    const calls=[];
    const geo={getCurrentPosition(resolve,_reject,opts){
      calls.push(opts);
      resolve({coords:{latitude:7.27,longitude:80.6,accuracy:opts.enableHighAccuracy?4200:420}});
    }};
    const result=await acquireBestLocation(geo);
    expect(result).toMatchObject({lat:7.27,lng:80.6,accuracy:420,source:'gps'});
    expect(calls.map(x=>x.enableHighAccuracy)).toEqual([true,false]);
  });
  it('does not silently replace a valid out-of-area GPS fix with a cached in-area fix',async()=>{
    const calls=[];
    const geo={getCurrentPosition(resolve,_reject,opts){
      calls.push(opts);
      resolve({coords:{latitude:51.5072,longitude:-0.1276,accuracy:20}});
    }};
    await expect(acquireBestLocation(geo)).rejects.toThrow(/outside/i);
    expect(calls).toHaveLength(1);
  });
  it('rejects a denied permission during the coarse retry',async()=>{
    const geo={getCurrentPosition(resolve,reject,opts){
      if(opts.enableHighAccuracy)reject({code:3});
      else reject({code:1});
    }};
    await expect(acquireBestLocation(geo)).rejects.toThrow(/denied/i);
  });
  it('fails safely when neither GPS fix meets required accuracy',async()=>{
    const geo={getCurrentPosition(resolve,_reject){
      resolve({coords:{latitude:7.2,longitude:80.6,accuracy:3600}});
    }};
    await expect(acquireBestLocation(geo)).rejects.toThrow(/accuracy is too low/i);
  });
  it('never retries a denied location permission and never invents a pin',async()=>{
    const geo={getCurrentPosition(_resolve,reject){reject({code:1});}};
    await expect(acquireBestLocation(geo)).rejects.toThrow(/denied/i);
    await expect(acquireBestLocation(null)).rejects.toThrow(/unavailable/i);
  });
});
