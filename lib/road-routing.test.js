import {describe,it,expect,vi} from 'vitest';
import {validRoadPoint,routingOrigin,roadRouteUrl,parseRoadRoute,fetchRoadRoute} from './road-routing.js';

const from={lat:6.9271,lng:79.8612};
const to={lat:6.9371,lng:79.8712};
const geometry={type:'LineString',coordinates:[[79.8612,6.9271],[79.8712,6.9371]]};
const route=(changes={})=>({code:'Ok',routes:[{distance:1900,duration:420,geometry,...changes}]});

describe('OSRM-compatible delivery routing adapter',()=>{
  it('requires plausible coordinates and an explicitly configured HTTPS origin',()=>{
    expect(validRoadPoint(from)).toBe(true);
    expect(validRoadPoint({lat:120,lng:80})).toBe(false);
    expect(routingOrigin('http://routing.example.com/')).toBeNull();
    expect(routingOrigin('https://router.project-osrm.org/')).toBeNull();
    expect(routingOrigin('https://routing.example.com/')).toBe('https://routing.example.com');
    for(const address of ['10.1.2.3','172.20.2.2','192.168.2.3','100.72.1.1','169.254.169.254','127.0.0.1','[::1]','[fc00::1]']){
      expect(routingOrigin(`https://${address}/`)).toBeNull();
    }
    expect(routingOrigin('https://routing.internal/')).toBeNull();
    expect(roadRouteUrl('https://routing.example.com',from,to)).toContain('79.861200,6.927100;79.871200,6.937100');
  });

  it('accepts a plausible response with explicit estimated duration',()=>{
    expect(parseRoadRoute(route())).toEqual({
      available:true,source:'road',distanceKm:1.9,travelMinutes:7,
      geometry
    });
  });

  it('refuses malformed provider payloads and unrelated geometry',()=>{
    expect(parseRoadRoute({code:'NoRoute',routes:[]})).toBeNull();
    expect(parseRoadRoute(route({distance:-1}))).toBeNull();
    expect(parseRoadRoute(route({duration:Infinity}))).toBeNull();
    expect(parseRoadRoute(route({geometry:{type:'LineString',coordinates:[[79.8612,6.9271],[999,6.9]]}}))).toBeNull();
    expect(parseRoadRoute(route({distance:1}))).toBeNull();
    expect(parseRoadRoute(route(),{from:{lat:7.5,lng:80.5},to})).toBeNull();
    expect(parseRoadRoute(route(),{from,to:{lat:7.5,lng:80.5}})).toBeNull();
    expect(parseRoadRoute(route({geometry:{type:'LineString',coordinates:[[79.8612,6.9271],[80.5,7.6]]}}))).toBeNull();
  });

  it('does not call routing provider without a long routing credential',async()=>{
    const send=vi.fn();
    expect(await fetchRoadRoute({from,to,origin:'https://routing.example.com',routingKey:'weak',fetchImpl:send})).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends only a server-side keyed request and parses the response',async()=>{
    const send=vi.fn(async()=>({ok:true,json:async()=>route()}));
    const result=await fetchRoadRoute({from,to,origin:'https://routing.example.com',routingKey:'a'.repeat(32),fetchImpl:send});
    expect(result?.available).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url,request]=send.mock.calls[0];
    expect(url).toContain('/route/v1/driving/');
    expect(request.headers['X-GastroFlow-Routing-Key']).toBe('a'.repeat(32));
    expect(request.redirect).toBe('error');
  });

  it('rejects a successful-looking route for the wrong destination',async()=>{
    const send=vi.fn(async()=>({ok:true,json:async()=>route()}));
    const result=await fetchRoadRoute({
      from,to:{lat:7.5,lng:80.5},origin:'https://routing.example.com',
      routingKey:'a'.repeat(32),fetchImpl:send
    });
    expect(result).toBeNull();
  });

  it('falls back without leaking provider failures',async()=>{
    expect(await fetchRoadRoute({from,to,origin:'https://routing.example.com',routingKey:'a'.repeat(32),fetchImpl:async()=>{throw new Error('offline');}})).toBeNull();
  });
});
