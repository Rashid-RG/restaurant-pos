/**
 * GastroDriver native background-location upload controller.
 * The host must supply an installed Capacitor background-geolocation plugin
 * and CapacitorHttp (native HTTP). No tracking starts without explicit consent.
 * The controller never stores GPS to local disk or accepts an API host from
 * user-controlled URL parameters.
 */
export function createNativeTrackingSession({
  plugin,httpPost,apiOrigin,getToken,getActiveOrders,clock=Date.now,onStatus=()=>{},onFix=()=>{}
}={}) {
  if(typeof apiOrigin!=='string'||!apiOrigin.trim())
    throw new TypeError('A configured native staging API origin is required');
  const endpoint=new URL(apiOrigin);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
     endpoint.search||endpoint.hash||endpoint.pathname!=='/')
    throw new TypeError('A trusted HTTPS API origin is required');
  if(!plugin?.addWatcher||!plugin?.removeWatcher||typeof httpPost!=='function'||
     typeof getToken!=='function'||typeof getActiveOrders!=='function')
    throw new TypeError('Native plugin, authenticated HTTP and order provider required');
  let watcherId=null,active=false,pendingStart=false,consent=false,discovery=false,lastUpload=0,epoch=0;
  let chain=Promise.resolve();
  const post=async(path,data)=>{
    const token=getToken();
    if(!token)return Promise.reject(new Error('Rider login required'));
    const result=await httpPost({url:endpoint.origin+'/api'+path,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      data,connectTimeout:6000,readTimeout:6000
    });
    if(!Number.isInteger(result?.status)||result.status<200||result.status>=300)
      throw new Error('Native location upload was rejected');
    return result;
  };
  async function stop(){
    epoch++;active=false;pendingStart=false;consent=false;discovery=false;
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
    const currentEpoch=++epoch;
    try{
      const id=await plugin.addWatcher({
        backgroundMessage:'GastroDriver uses location only while your delivery shift is active. Open the app to stop sharing.',
        backgroundTitle:'GastroDriver active delivery location',
        requestPermissions:true,stale:false,distanceFilter:12
      },(point,error)=>{
        if(error){onStatus('location_error');return;}
        if(!active||!consent||currentEpoch!==epoch||!point)return;
        const lat=point.latitude,lng=point.longitude,
          accuracyMeters=point.accuracy,recordedAt=point.time;
        const now=clock();
        if(![lat,lng,accuracyMeters,recordedAt].every(Number.isFinite)||
          Math.abs(lat)>90||Math.abs(lng)>180||accuracyMeters<=0||
          accuracyMeters>150||recordedAt>now+10000||now-recordedAt>30000)return;
        onFix({lat,lng,accuracyMeters,recordedAt});
        if(now-lastUpload<4000)return;
        lastUpload=now;
        const fix={lat,lng,accuracyMeters,recordedAt};
        // Serialize uploads so earlier fixes cannot overtake later ones.
        chain=chain.catch(()=>{}).then(async()=>{
          if(!active||!consent||currentEpoch!==epoch)return;
          const orders=getActiveOrders().filter(o=>o?.id&&
            !['delivered','completed','cancelled','rejected'].includes(String(o.status||'').toLowerCase()));
          if(orders.length){
            const results=await Promise.allSettled(orders.map(o=>post('/public/driver/location',{orderId:o.id,...fix})));
            // A measured GPS fix is not proof that the customer can see it.
            // Signal only accepted assigned-order uploads; never mark rejected
            // requests as successfully shared.
            if(!active||currentEpoch!==epoch)return;
            onStatus(results.every(result=>result.status==='fulfilled')?'upload_success':'upload_error');
          }else if(discovery){
            await post('/public/driver/on-duty-location',{...fix,consent:true});
          }
        }).catch(()=>onStatus('upload_error'));
      });
      watcherId=id;
      if(!active||currentEpoch!==epoch){await plugin.removeWatcher({id});watcherId=null;return false;}
      pendingStart=false;onStatus('active');return true;
    }catch(error){
      active=false;pendingStart=false;consent=false;discovery=false;
      onStatus('location_error');throw error;
    }
  }
  return {start,stop,isActive:()=>active,setDiscoveryEnabled:next=>{discovery=active&&next===true;}};
}
