// Permission-aware, accuracy-labelled geolocation. No IP-to-pin substitution.
// Never request geolocation silently unless browser permission is already granted.
export const MAX_BROWSE_ACCURACY_METERS=1500;
export function validatePosition(position,{maxAccuracyMeters=MAX_BROWSE_ACCURACY_METERS}={}) {
  const {latitude:lat,longitude:lng,accuracy}=position?.coords||{};
  if (![lat,lng,accuracy].every(Number.isFinite) || Math.abs(lat)>90 || Math.abs(lng)>180 ||
      accuracy<0 || accuracy>maxAccuracyMeters) return null;
  return {lat,lng,accuracy:Math.round(accuracy),source:'gps'};
}
export function inSriLankaBounds({lat,lng}={}) {
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=5&&lat<=10&&lng>=79&&lng<=82;
}
export async function permissionAllowsAutomaticLocation(permissions=globalThis.navigator?.permissions) {
  if (!permissions?.query) return false;
  try {
    const status=await permissions.query({name:'geolocation'});
    return status?.state==='granted';
  } catch {return false;}
}
export async function acquireBestLocation(geolocation=globalThis.navigator?.geolocation) {
  if (!geolocation?.getCurrentPosition) throw new Error('Location services are unavailable on this device.');
  const attempt=options=>new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,options));
  let position;
  try {
    position=await attempt({enableHighAccuracy:true,timeout:13000,maximumAge:30000});
  } catch(error) {
    if (error?.code===1) throw new Error('Location permission was denied. Allow location access in device settings, or choose a map pin.');
    try {
      position=await attempt({enableHighAccuracy:false,timeout:8000,maximumAge:60000});
    } catch {
      throw new Error('Could not get a GPS fix. Check device location services or select your address manually.');
    }
  }
  const fix=validatePosition(position);
  if (!fix) throw new Error('Location accuracy is too low for nearby recommendations. Move outdoors or choose a map pin.');
  if (!inSriLankaBounds(fix)) throw new Error('Detected location is outside the supported Sri Lankan service area.');
  return fix;
}
