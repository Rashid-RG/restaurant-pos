/**
 * H3 candidate prefilter. Inject the supported h3-js v4 API at the composition
 * root; this is deliberately not an active HTTP endpoint until opt-in on-duty
 * rider presence is implemented. H3 cells are only a lookup optimization:
 * never use H3 graph distance as a customer ETA.
 */
import {eligibleNearbyRiders} from './rider-discovery.js';

export function createH3RiderIndex(h3,{resolution=9}={}) {
  if(!h3||typeof h3.latLngToCell!=='function'||typeof h3.gridDisk!=='function'||
     !Number.isInteger(resolution)||resolution<0||resolution>15)
    throw new TypeError('A supported H3 v4 implementation and resolution 0–15 are required.');
  const byTenant=new Map();
  const replaceTenant=(tenantId,riders=[],now=Date.now())=>{
    if(typeof tenantId!=='string'||!tenantId.trim())throw new TypeError('Tenant is required');
    const cells=new Map();
    for(const rider of riders){
      if(!rider||rider.tenantId!==tenantId||!rider.id)continue;
      // Reuse policy checks for consent, status, verification and age before
      // indexing; distance search is intentionally unconstrained at this step.
      const valid=eligibleNearbyRiders({tenantId,origin:rider.fix,now,
        riders:[rider],maxRadiusMeters:1});
      if(!valid.length)continue;
      const cell=h3.latLngToCell(rider.fix.lat,rider.fix.lng,resolution);
      if(!h3.isValidCell?.(cell))continue;
      if(!cells.has(cell))cells.set(cell,new Map());
      cells.get(cell).set(rider.id,rider);
    }
    // Atomically replaces stale per-tenant entries, including off-duty riders.
    byTenant.set(tenantId,cells);
  };
  const nearby=({tenantId,origin,ringCount=2,now=Date.now(),maxRadiusMeters=10000}={})=>{
    if(typeof tenantId!=='string'||!tenantId.trim()||
       !Number.isInteger(ringCount)||ringCount<0||ringCount>20||
       !origin||!Number.isFinite(origin.lat)||!Number.isFinite(origin.lng)||
       Math.abs(origin.lat)>90||Math.abs(origin.lng)>180)return [];
    const cells=byTenant.get(tenantId);
    if(!cells)return [];
    const center=h3.latLngToCell(origin.lat,origin.lng,resolution);
    if(!h3.isValidCell?.(center))return [];
    const matches=new Map();
    for(const cell of h3.gridDisk(center,ringCount)){
      for(const [id,rider] of cells.get(cell)||[])matches.set(id,rider);
    }
    return eligibleNearbyRiders({tenantId,origin,riders:[...matches.values()],now,maxRadiusMeters});
  };
  const clearTenant=tenantId=>byTenant.delete(tenantId);
  return {replaceTenant,nearby,clearTenant};
}
