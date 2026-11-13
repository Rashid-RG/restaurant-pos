// Tracking state is derived only from server statuses, estimates, and GPS fixes.
// No synthetic ETA, route, or live GPS accuracy claims.
export const TRACKING_GPS_FRESH_MS = 30_000;
export const TRACKING_GPS_EXPIRE_MS = 90_000;
export const TRACKING_UPDATE_STALE_MS = 35_000;

export function trackingSteps(type = 'takeaway') {
  if (type === 'delivery') return [
    {id:'pending',label:'Order received',description:'Waiting for restaurant confirmation'},
    {id:'preparing',label:'Preparing your food',description:'The restaurant is preparing your order'},
    {id:'ready',label:'Ready for pickup',description:'Food prepared; waiting for rider pickup'},
    {id:'picked_up',label:'Picked up by rider',description:'Your rider has collected the food'},
    {id:'out_for_delivery',label:'On the way',description:'Your rider is heading to the destination'},
    {id:'arrived',label:'Rider arrived',description:'Your rider reported arrival at the destination'},
    {id:'completed',label:'Delivered',description:'The restaurant confirmed delivery completion'}
  ];
  if (type === 'dine-in') return [
    {id:'pending',label:'Order received',description:'Waiting for restaurant confirmation'},
    {id:'preparing',label:'Preparing your food',description:'The kitchen is preparing your meal'},
    {id:'ready',label:'Ready to serve',description:'Your meal is ready'},
    {id:'completed',label:'Served',description:'Enjoy your meal'}
  ];
  return [
    {id:'pending',label:'Order received',description:'Waiting for restaurant confirmation'},
    {id:'preparing',label:'Preparing your food',description:'The kitchen is preparing your order'},
    {id:'ready',label:'Ready for pickup',description:'Collect your food at the restaurant'},
    {id:'completed',label:'Collected',description:'Pickup completed'}
  ];
}

export function trackingProgress(status, type = 'takeaway') {
  const steps = trackingSteps(type);
  const normalized=String(status||'pending').toLowerCase();
  const aliases={in_progress:'preparing','in progress':'preparing',accepted:'preparing',confirmed:'preparing',served:'completed',delivered:'completed',collected:'completed'};
  const canonical=aliases[normalized]||normalized;
  const idx=steps.findIndex(s=>s.id===canonical);
  const terminal=['cancelled','rejected','refunded','partially_refunded'].includes(canonical);
  return {steps,currentIndex:terminal?-1:Math.max(0,idx),terminal,done:canonical==='completed',percent:terminal?0:Math.round((Math.max(0,idx)+1)/steps.length*100)};
}

export function validGeoPoint(value) {
  const lat=Number(value?.lat),lng=Number(value?.lng);
  return value && value.lat!==null && value.lng!==null && Number.isFinite(lat) && Number.isFinite(lng) && lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
}

export function normalizeDriverFix(fix, now = Date.now()) {
  if (!validGeoPoint(fix)) return null;
  const updatedAt=Number(fix.updatedAt);
  if (!Number.isFinite(updatedAt)||updatedAt<=0||updatedAt>now+10_000||now-updatedAt>TRACKING_GPS_EXPIRE_MS) return null;
  const accuracyMeters=Number(fix.accuracyMeters);
  return {lat:Number(fix.lat),lng:Number(fix.lng),updatedAt,driverName:String(fix.driverName||''),accuracyMeters:Number.isFinite(accuracyMeters)&&accuracyMeters>=0?accuracyMeters:null};
}

export function isNewerDriverFix(incoming, previous) {
  return !!incoming && (!previous || incoming.updatedAt>previous.updatedAt);
}

export function driverFreshness(fix,now=Date.now()) {
  if(!fix?.updatedAt) return {state:'waiting',label:'Waiting for rider location',visible:false};
  const age=now-fix.updatedAt;
  if(age<0||age>TRACKING_GPS_EXPIRE_MS) return {state:'stale',label:'Rider position unavailable · waiting for update',visible:false};
  if(age>TRACKING_GPS_FRESH_MS) return {state:'delayed',label:'Rider GPS delayed · last fix '+Math.max(1,Math.floor(age/1000))+' seconds ago',visible:true};
  return {state:'fresh',label:'Rider location updated '+Math.max(0,Math.floor(age/1000))+' seconds ago'+(fix.accuracyMeters!=null?' · GPS accuracy about ±'+Math.round(fix.accuracyMeters)+' m':''),visible:true};
}

export function trackingEtaMinutes(eta) {
  const v=Number(eta);
  return eta == null || !Number.isFinite(v)||v<=0||v>24*60?null:Math.ceil(v);
}
