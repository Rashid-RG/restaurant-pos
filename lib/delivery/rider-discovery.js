/**
 * Private rider-discovery policy. The caller must load drivers and their last
 * consented on-duty locations under its authenticated restaurant tenant.
 * This module never queries cross-tenant data and never exposes coordinates
 * to customers. Geographic cells (H3) may pre-filter inputs later; road ETA
 * is required before making a dispatch recommendation.
 */
const R = 6371000;
export const MAX_RIDER_FIX_AGE_MS = 90000;
export const MAX_RIDER_ACCURACY_METERS = 150;

export function riderDistanceMeters(a,b) {
  const lat1=Number(a?.lat),lng1=Number(a?.lng),lat2=Number(b?.lat),lng2=Number(b?.lng);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)||
     Math.abs(lat1)>90||Math.abs(lat2)>90||Math.abs(lng1)>180||Math.abs(lng2)>180)return Infinity;
  const d=(lat2-lat1)*Math.PI/180,l=(lng2-lng1)*Math.PI/180;
  const h=Math.sin(d/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(l/2)**2;
  return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}

export function eligibleNearbyRiders({tenantId,origin,riders=[],now=Date.now(),maxRadiusMeters=10000}={}) {
  if(typeof tenantId!=='string'||!tenantId.trim()||
     !Number.isFinite(riderDistanceMeters(origin,origin))||
     !Number.isFinite(now)||!Number.isFinite(maxRadiusMeters)||maxRadiusMeters<=0)return [];
  const candidates=[];
  const ids=new Set();
  for(const rider of riders){
    if(!rider||rider.tenantId!==tenantId||!rider.id||ids.has(rider.id))continue;
    if(!['available','active'].includes(String(rider.status||'').toLowerCase()))continue;
    if(rider.verified!==true||rider.onDuty!==true||rider.locationConsent!==true)continue;
    const fix=rider.fix;
    if(!fix||!Number.isFinite(fix.updatedAt)||fix.updatedAt>now+10000||
       now-fix.updatedAt>MAX_RIDER_FIX_AGE_MS||
       !Number.isFinite(fix.accuracyMeters)||fix.accuracyMeters<=0||
       fix.accuracyMeters>MAX_RIDER_ACCURACY_METERS)continue;
    const distanceMeters=riderDistanceMeters(origin,fix);
    if(!Number.isFinite(distanceMeters)||distanceMeters>maxRadiusMeters)continue;
    ids.add(rider.id);
    candidates.push({driverId:rider.id,distanceMeters:Math.round(distanceMeters),locationAgeMs:Math.max(0,now-fix.updatedAt)});
  }
  // This is a geographic shortlist, NOT a road-based ETA or auto-dispatch decision.
  return candidates.sort((a,b)=>a.distanceMeters-b.distanceMeters||a.driverId.localeCompare(b.driverId));
}
