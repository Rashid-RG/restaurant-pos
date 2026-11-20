import * as h3 from 'h3-js';
import {createH3RiderIndex} from './h3-rider-index.js';

/**
 * Tenant-isolated shortlist for automatic delivery dispatch.
 * Requires an authenticated, on-duty, consented presence service to supply
 * ephemeral GPS. Never uses an old order's location as an idle-rider fix.
 *
 * This only ranks; the caller must atomically claim the order+driver against
 * the authoritative database and reject already occupied riders.
 */
export async function rankDispatchRiders({
  tenantId,pickup,presence,dbAll,estimateRoad,clock=Date.now,
  maxCandidates=10,maxDistanceMeters=10000
}={}) {
  if(typeof tenantId!=='string'||!tenantId.trim()||
     !Number.isFinite(pickup?.lat)||!Number.isFinite(pickup?.lng)||
     Math.abs(pickup.lat)>90||Math.abs(pickup.lng)>180||
     !presence||typeof presence.list!=='function'||typeof dbAll!=='function')
    return [];
  const fixes=await presence.list(tenantId);
  if(!fixes.length)return [];
  // Query actual tenant state at dispatch time. Available-only excludes busy,
  // pending approval, offline, suspended and riders on another active job.
  const drivers=await dbAll(
    "SELECT id FROM drivers WHERE tenant_id=? AND status IN ('available','active')",
    [tenantId]
  );
  const allowed=new Set(drivers.map(d=>String(d.id)));
  const now=clock();
  const eligible=fixes.filter(f=>allowed.has(String(f.driverId))).map(f=>({
    id:String(f.driverId),tenantId,status:'available',verified:true,
    onDuty:true,locationConsent:true,
    fix:{lat:f.lat,lng:f.lng,accuracyMeters:f.accuracyMeters,updatedAt:f.recordedAt}
  }));
  const byId=new Map(eligible.map(d=>[d.id,d.fix]));
  const index=createH3RiderIndex(h3,{resolution:7});
  try{
    index.replaceTenant(tenantId,eligible,now);
    // Resolution 7, ten rings: prefilter sufficiently broad for 10 km
    // subject to the exact geodesic radius enforced in rider-discovery.
    const shortlist=index.nearby({
      tenantId,origin:pickup,ringCount:10,now,maxRadiusMeters:maxDistanceMeters
    }).slice(0,maxCandidates);
    if(!shortlist.length)return [];
    const routed=await Promise.all(shortlist.map(async candidate=>{
      let roadTravelMinutes=null;
      if(typeof estimateRoad==='function'){
        try{
          const value=await estimateRoad({from:byId.get(candidate.driverId),to:pickup});
          if(Number.isFinite(value)&&value>=0&&value<=24*60)
            roadTravelMinutes=Math.ceil(value);
        }catch{/* Route failures must not fabricate arrival times. */}
      }
      return {...candidate,...(roadTravelMinutes===null?{}:{roadTravelMinutes})};
    }));
    routed.sort((a,b)=>{
      const ar=a.roadTravelMinutes,br=b.roadTravelMinutes;
      if(ar!=null&&br!=null)return ar-br||a.distanceMeters-b.distanceMeters;
      if(ar!=null)return -1;
      if(br!=null)return 1;
      return a.distanceMeters-b.distanceMeters||a.driverId.localeCompare(b.driverId);
    });
    return routed;
  }finally{index.clearTenant(tenantId);}
}
