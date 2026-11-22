// Health checks use a cached database probe rather than accepting one successful
// startup as proof of permanent connectivity. No credentials or SQL errors
// are exposed to public uptime monitors.
export function createDatabaseReadiness({now=()=>Date.now(),freshMs=45000}={}){
  let lastSuccessAt=null;
  let lastFailureAt=null;
  let startedAt=now();
  return {
    recordSuccess(){lastSuccessAt=now();lastFailureAt=null;},
    recordFailure(){lastFailureAt=now();},
    isReady(initialized){
      if(!initialized||lastSuccessAt===null)return false;
      if(lastFailureAt!==null&&lastFailureAt>=lastSuccessAt)return false;
      return now()-lastSuccessAt<=freshMs;
    },
    status(initialized){
      if(!initialized)return 'initializing';
      if(this.isReady(initialized))return 'connected';
      return 'unavailable';
    },
    get ageMs(){return lastSuccessAt===null?now()-startedAt:now()-lastSuccessAt;}
  };
}
