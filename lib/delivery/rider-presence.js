/**
 * Ephemeral rider-presence registry. No customer coordinates, disk storage or
 * background GPS collection. A single-process staging pilot only: production
 * multi-instance deployment requires a shared TTL store (e.g. Redis).
 */
export function createRiderPresence({ttlMs=90000,clock=Date.now,maxEntries=10000}={}) {
  const entries=new Map();
  const key=(tenant,id)=>JSON.stringify([tenant,id]);
  const prune=()=>{
    const now=clock();
    for(const [id,item] of entries)if(now-item.receivedAt>ttlMs)entries.delete(id);
  };
  const revoke=(tenantId,driverId)=>entries.delete(key(tenantId,driverId));
  const record=({tenantId,driverId,lat,lng,accuracyMeters,recordedAt,consent}={})=>{
    const now=clock();
    if(typeof tenantId!=='string'||!tenantId||typeof driverId!=='string'||!driverId||
      consent!==true||![lat,lng,accuracyMeters,recordedAt].every(Number.isFinite)||
      Math.abs(lat)>90||Math.abs(lng)>180||accuracyMeters<=0||accuracyMeters>150||
      recordedAt>now+10000||now-recordedAt>30000)return {accepted:false,reason:'invalid_fix'};
    prune();
    const id=key(tenantId,driverId),prior=entries.get(id);
    if(prior&&prior.recordedAt>=recordedAt)return {accepted:false,reason:'old_fix'};
    if(!prior&&entries.size>=maxEntries)return {accepted:false,reason:'at_capacity'};
    entries.set(id,{tenantId,driverId,lat,lng,accuracyMeters,recordedAt,receivedAt:now});
    return {accepted:true};
  };
  const list=(tenantId)=>{
    prune();
    return [...entries.values()].filter(item=>item.tenantId===tenantId).map(
      ({tenantId,driverId,lat,lng,accuracyMeters,recordedAt})=>({tenantId,driverId,lat,lng,accuracyMeters,recordedAt})
    );
  };
  return {record,revoke,list};
}
