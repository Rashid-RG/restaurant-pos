// Keep existing native customer sessions in sync with the server after a
// foreground return. Never treat a connectivity error as a logout.
// The hosted website keeps its current session lifecycle.
export const NATIVE_SESSION_REVALIDATE_INTERVAL_MS=60_000;

export function shouldRevalidateNativeCustomerSession({
  nativeBuild=false,token,visible=true,online=true,
  now=Date.now(),lastCheckedAt=0,inFlight=false
}={}){
  if(nativeBuild!==true || typeof token!=='string' || !token || inFlight)return false;
  if(!visible || !online || !Number.isFinite(now))return false;
  if(Number.isFinite(lastCheckedAt) && lastCheckedAt>0 &&
    now-lastCheckedAt<NATIVE_SESSION_REVALIDATE_INTERVAL_MS)return false;
  return true;
}

// A late response from an old restaurant or token must never clear a new
// login, even if an old network request returns 401 after a tenant switch.
export function isCurrentNativeSessionCheck({
  activeTenant,tenant,token,savedToken,epoch,currentEpoch,mounted
}={}){
  return mounted===true && tenant===activeTenant &&
    typeof token==='string' && !!token && token===savedToken &&
    Number.isSafeInteger(epoch) && epoch===currentEpoch;
}
