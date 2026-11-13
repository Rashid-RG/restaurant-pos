/**
 * GPS transmission policy for the driver PWA.
 * Reduce mobile data/battery use while stationary, but keep a recent heartbeat.
 * The server independently checks accuracy, timestamps, assignments and jumps.
 */
export const DRIVER_MOVING_INTERVAL_MS = 4000;
export const DRIVER_STATIONARY_INTERVAL_MS = 12000;
export const DRIVER_MOVEMENT_METERS = 12;

export function geoDistanceMeters(a,b) {
  if (!a || !b) return Infinity;
  const lat1=Number(a.lat),lon1=Number(a.lng),lat2=Number(b.lat),lon2=Number(b.lng);
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite)) return Infinity;
  const r=Math.PI/180, dLat=(lat2-lat1)*r,dLng=(lon2-lon1)*r;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}

export function shouldSendDriverFix(fix, lastSent, now = Date.now()) {
  if (!fix || !Number.isFinite(Number(fix.recordedAt))) return false;
  if (!lastSent) return true;
  if (fix.recordedAt <= lastSent.recordedAt) return false;
  const elapsed=now-lastSent.sentAt;
  if (elapsed<0) return false;
  const distance=geoDistanceMeters(fix,lastSent);
  const noise=Math.min(40,Math.max(6,Number(fix.accuracyMeters)||6));
  const moved=distance>=Math.max(DRIVER_MOVEMENT_METERS,noise);
  return elapsed >= (moved?DRIVER_MOVING_INTERVAL_MS:DRIVER_STATIONARY_INTERVAL_MS);
}

export function shouldAnimateDriverPosition(from,to) {
  const meters=geoDistanceMeters(from,to);
  return Number.isFinite(meters)&&meters>0.5&&meters<=500;
}
