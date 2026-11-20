/**
 * GastroDriver native background-location upload controller.
 * The host must supply an installed Capacitor background-geolocation plugin
 * and CapacitorHttp (native HTTP). No tracking starts without explicit consent.
 * The controller never stores GPS to local disk or accepts an API host from
 * user-controlled URL parameters.
 */
export function createNativeTrackingSession({
  plugin,httpPost,apiOrigin,getToken,getActiveOrders,clock=Date.now,onStatus=()=>{}
}={}) {
  const endpoint=new URL(apiOrigin||'https://invalid.example');
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
     endpoint.search||endpoint.hash||endpoint.pathname!=='/')
    throw new TypeError('A trusted HTTPS API origin is required');
  if(!plugin?.addWatcher||!plugin?.removeWatcher||typeof httpPost!=='function'||
     typeof getToken!=='function'||typeof getActiveOrders!=='function')
    throw new TypeError('Native plugin, authenticated HTTP and order provider required');
  let watcherId=null,active=false,pendingStart=false,consent=false,discovery=false,lastUpload=0;
  let chain=Promise.resolve();
  const post=(path,data)=>{
    const token=getToken();
    if(!token)return Promise.reject(new Error('Rider login required'));
    return httpPost({url:endpoint.origin+'/api'+path,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      data,connectTimeout:6000,readTimeout:6000
    });
  };
  async function stop(){
    active=false;pendingStart=false;consent=false;discovery=false;
    const id=watcherId;watcherId=null;
    try{if(id!==null)await plugin.removeWatcher({id});}finally{
      // A best-effort revoke is safe even after GPS has been switched off.
      try{await post('/public/driver/off-duty-location',{});}catch{}
      onStatus('off');
    }
  }
  async function start({onDuty=false,locationConsent=false,discoveryConsent=false}={}){
    if(active||pendingStart)return false;
    if(!onDuty||!locationConsent)throw new Error('Explicit on-duty location permission required');
    if(!getToken())throw new Error('Rider login required');
    consent=true;discovery=discoveryConsent===true;pendingStart=true;active=true;
    try{
      const id=await plugin.addWatcher({
        backgroundMessage:'GastroDriver uses location only while your delivery shift is active. Open the app to stop sharing.',
        backgroundTitle:'GastroDriver active delivery location',
        requestPermissions:true,stale:false,distanceFilter:12
      },(point,error)=>{
        if(error){onStatus('location_error');return;}
        if(!active||!consent||!point)return;
        const lat=point.latitude,lng=point.longitude,
          accuracyMeters=point.accuracy,recordedAt=point.time;
        const now=clock();
        if(![lat,lng,accuracyMeters,recordedAt].every(Number.isFinite)||
          Math.abs(lat)>90||Math.abs(lng)>180||accuracyMeters<=0||
          accuracyMeters>150||recordedAt>now+10000||now-recordedAt>30000)return;
        if(now-lastUpload<4000)return;
        lastUpload=now;
        const fix={lat,lng,accuracyMeters,recordedAt};
        // Serialize uploads so earlier fixes cannot overtake later ones.
        chain=chain.catch(()=>{}).then(async()=>{
          if(!active||!consent)return;
          const orders=getActiveOrders().filter(o=>o?.id&&
            !['delivered','completed','cancelled','rejected'].includes(String(o.status||'').toLowerCase()));
          if(orders.length){
            await Promise.allSettled(orders.map(o=>post('/public/driver/location',{orderId:o.id,...fix})));
          }else if(discovery){
            await post('/public/driver/on-duty-location',{...fix,consent:true});
          }
        }).catch(()=>onStatus('upload_error'));
      });
      watcherId=id;
      if(!active){await plugin.removeWatcher({id});watcherId=null;return false;}
      pendingStart=false;onStatus('active');return true;
    }catch(error){
      active=false;pendingStart=false;consent=false;discovery=false;
      onStatus('location_error');throw error;
    }
  }
  return {start,stop,isActive:()=>active};
}
