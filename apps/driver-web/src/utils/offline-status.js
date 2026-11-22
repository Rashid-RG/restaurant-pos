// Device-local, non-sensitive retry intent for rider delivery progress.
// Never enqueue payment, signature, photo, PIN, GPS or delivered status.
const ALLOWED=new Set(['picked_up','out_for_delivery','arrived']);
const LIMIT=20,TTL=12*60*60*1000;
export const offlineUpdateKey=(tenantId,driverId)=>`gastrodriver:pending-status:${encodeURIComponent(String(tenantId||''))}:${encodeURIComponent(String(driverId||''))}`;
export function sanitizePendingUpdates(value,now=Date.now()){
  if(!Array.isArray(value))return [];
  return value.filter(x=>x && typeof x.orderId==='string' && x.orderId.length>0 && x.orderId.length<=128 &&
    ALLOWED.has(x.status) && Number.isSafeInteger(x.createdAt) && x.createdAt<=now &&
    x.createdAt>now-TTL).slice(-LIMIT).map(x=>({orderId:x.orderId,status:x.status,createdAt:x.createdAt}));
}
export function queuePendingStatus(current,orderId,status,now=Date.now()){
  if(!ALLOWED.has(status)||typeof orderId!=='string'||!orderId||orderId.length>128)throw Error('Only non-final delivery progress can be queued');
  const previous=sanitizePendingUpdates(current,now);
  if(previous.some(x=>x.orderId===orderId))throw Error('Review the existing pending update for this order before adding another.');
  return [...previous,{orderId,status,createdAt:now}].slice(-LIMIT);
}
export function removePendingStatus(current,orderId,now=Date.now()){
  return sanitizePendingUpdates(current,now).filter(x=>x.orderId!==orderId);
}
