import {describe,it,expect,vi} from 'vitest';
import {validRoadPoint,routingOrigin,roadRouteUrl,parseRoadRoute,fetchRoadRoute} from '../lib/road-routing.js';

const a={lat:6.9271,lng:79.8612},b={lat:7.201,lng:79.945};
const data={code:'Ok',routes:[{distance:16500,duration:1800,geometry:{type:'LineString',coordinates:[[79.8612,6.9271],[79.945,7.201]]}}]};
describe('GastroFlow opt-in road-based delivery routing',()=>{
 it('never uses public demo or non-HTTPS routing services',()=>{
   expect(routingOrigin(undefined)).toBe(null);
   expect(routingOrigin('https://router.project-osrm.org/')).toBe(null);
   expect(routingOrigin('http://routing.example.com/')).toBe(null);
   expect(routingOrigin('https://routing.example.com/')).toBe('https://routing.example.com');
   expect(routingOrigin('https://user:pass@routing.example.com/')).toBe(null);
   expect(routingOrigin('https://127.0.0.1/')).toBe(null);
 });
 it('requires valid coordinates and puts longitude first for OSRM',()=>{
   expect(validRoadPoint({lat:0,lng:0})).toBe(true);
   expect(validRoadPoint({lat:null,lng:70})).toBe(false);
   expect(validRoadPoint({lat:91,lng:70})).toBe(false);
   expect(roadRouteUrl('https://routing.example.com',a,b)).toContain('/route/v1/driving/79.861200,6.927100;79.945000,7.201000?');
 });
 it('uses actual route duration, distance, and geometry only when valid',()=>{
   const result=parseRoadRoute(data);
   expect(result.travelMinutes).toBe(30);
   expect(result.distanceKm).toBe(16.5);
   expect(result.geometry.coordinates).toHaveLength(2);
   expect(parseRoadRoute({code:'NoRoute'})).toBe(null);
   expect(parseRoadRoute({...data,routes:[{...data.routes[0],geometry:{type:'LineString',coordinates:[[500,6],[79,7]]}}]})).toBe(null);
 });
 it('returns safe empty availability when routing fails or is not configured',async()=>{
   const fake=vi.fn(async()=>({ok:true,json:async()=>data}));
   expect(await fetchRoadRoute({from:a,to:b,origin:null,fetchImpl:fake})).toBe(null);
   expect(fake).not.toHaveBeenCalled();
   expect((await fetchRoadRoute({from:a,to:b,origin:'https://routing.example.com',fetchImpl:fake})).travelMinutes).toBe(30);
   expect(await fetchRoadRoute({from:a,to:b,origin:'https://routing.example.com',fetchImpl:()=>Promise.reject(new Error('timeout'))})).toBe(null);
 });
});