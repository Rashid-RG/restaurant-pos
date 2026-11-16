// Process-local, bounded operational signals. Never include raw URLs, bodies,
// tenant IDs, customer data, bearer credentials or SQL error strings in logs.
export function createOperationalMonitor({
  now=()=>Date.now(),
  log=(record)=>console.warn(JSON.stringify(record)),
  failureThreshold=3,
  slowRequestMs=2000,
  slowLogCooldownMs=60000
}={}){
  let failedProbes=0,incidentOpen=false;
  const lastSlowLogged=new Map();
  const emit=(level,event,details={})=>log({level,event,at:new Date(now()).toISOString(),...details});
  return {
    probeSucceeded(){
      failedProbes=0;
      if(incidentOpen){
        incidentOpen=false;
        emit('info','database_recovered');
      }
    },
    probeFailed(){
      failedProbes++;
      if(!incidentOpen && failedProbes>=failureThreshold){
        incidentOpen=true;
        emit('error','database_unavailable',{failedProbes});
      }
    },
    recordRequest({method,route,status,durationMs}={}){
      if(!Number.isFinite(durationMs)||durationMs<slowRequestMs)return;
      const safeMethod=['GET','POST','PUT','PATCH','DELETE'].includes(method)?method:'OTHER';
      // Only Express route patterns are accepted, never req.path or originalUrl.
      const safeRoute=typeof route==='string' && route.startsWith('/') &&
        route.length<=120 && !/[?#]/.test(route) &&
        /^[\\w\\/.:*-]+$/.test(route)?route:'[unmatched]';
      const safeStatus=Number.isInteger(status)&&status>=100&&status<=599?status:500;
      const key=safeMethod+' '+safeRoute;
      const last=lastSlowLogged.get(key);
      if(last!==undefined && now()-last<slowLogCooldownMs)return;
      // Bounded cardinality and log volume, even under malicious traffic.
      if(lastSlowLogged.size>=200)lastSlowLogged.clear();
      lastSlowLogged.set(key,now());
      emit('warn','slow_http_request',{
        method:safeMethod,route:safeRoute,status:safeStatus,
        durationMs:Math.round(durationMs)
      });
    },
    getIncidentOpen(){return incidentOpen;}
  };
}
