/**
 * Client-side staging-only FCM enrollment.
 * No sender or provider secret is used here. Tenant and owner identity are
 * resolved by the server from the authenticated staff JWT, never a request body.
 * The raw registration token is only sent over same-origin HTTPS to the staged
 * backend and must not be logged, rendered, or persisted in browser storage.
 */
export const STAGING_ORIGIN='https://gastroflow-staging.onrender.com';
export const STAGING_PUSH_STORAGE_PREFIX='gastroflow_staging_installation_v1:';
export const STAGING_DEVICE_OWNER_KEY='gastroflow_staging_push_device_owner_v1';
function ownerBinding(user){
  return JSON.stringify([user.tenant_id,user.id]);
}
function ensureNoOtherOwnerBound(storage,user){
  const previous=storage.getItem(STAGING_DEVICE_OWNER_KEY);
  if(previous&&previous!==ownerBinding(user))
    throw new Error('This phone has a previous owner push registration. Sign in as that owner and disable notifications before switching accounts.');
}
function clearOwnerBinding(storage,user){
  if(storage?.getItem(STAGING_DEVICE_OWNER_KEY)===ownerBinding(user))
    storage.removeItem(STAGING_DEVICE_OWNER_KEY);
}


export function eligibleStagingOwner(user,capacitor,origin){
  return origin===STAGING_ORIGIN &&
    Boolean(user?.id&&user?.tenant_id&&user.role==='owner'&&!user.isPlatformAdmin) &&
    Boolean(capacitor?.isNativePlatform?.()) &&
    Boolean(capacitor?.isPluginAvailable?.('FirebaseMessaging')) &&
    ['ios','android'].includes(capacitor?.getPlatform?.());
}
export function getStagingInstallationId(storage,user,makeUUID=()=>crypto.randomUUID()){
  if(!user?.id||!user?.tenant_id)return null;
  // Keys are scoped to an authenticated owner and tenant. This identifier is
  // not a Firebase token and contains no credentials.
  const key=STAGING_PUSH_STORAGE_PREFIX+encodeURIComponent(user.tenant_id)+':'+encodeURIComponent(user.id);
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const saved=storage.getItem(key);
  if(saved&&valid.test(saved))return saved;
  const id=makeUUID();
  if(!valid.test(id))throw new Error('Invalid installation identifier.');
  storage.setItem(key,id);
  return id;
}
export async function stagingPushApi(path,body,{fetcher=fetch,storage=localStorage}={}){
  const jwt=storage.getItem('gastroflow_token');
  if(!jwt)throw new Error('Sign in to your restaurant account again.');
  const response=await fetcher('/api/owner/communications/'+path,{
    method:'POST',
    credentials:'same-origin',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
    body:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=response.status===404
      ?'Staging push enrollment is not enabled on the server.'
      :response.status===401||response.status===403
        ?'Your restaurant owner session is not authorized.'
        :response.status===409
          ?'Registration conflict or consent requirement. Review your restaurant account.'
          :'Could not register this staging device.';
    throw new Error(message);
  }
  return result;
}
export async function enrollStagingOwnerPush({
  user,capacitor,storage,fetcher,makeUUID,origin
}={}){
  if(!eligibleStagingOwner(user,capacitor,origin))throw new Error('Owner staging device required.');
  // A single native installation can retain an FCM token across logins.
  // Refuse re-binding to another owner unless the previous owner completed
  // server revocation. Do not clear this marker after an offline logout.
  ensureNoOtherOwnerBound(storage,user);
  const api=(path,body)=>stagingPushApi(path,body,{fetcher,storage});
  // Never mutate consent or device tables unless the separately attested
  // isolated-staging server reports that all enrollment gates are enabled.
  const jwt=storage.getItem('gastroflow_token');
  if(!jwt)throw new Error('Sign in to your restaurant account again.');
  const readinessResponse=await fetcher('/api/owner/communications/push-enrollment-readiness',{
    method:'GET',credentials:'same-origin',
    headers:{Authorization:'Bearer '+jwt}
  });
  const readiness=await readinessResponse.json().catch(()=>({}));
  if(!readinessResponse.ok||readiness.enabled!==true)
    throw new Error('Staging device registration is disabled until database isolation is verified.');
  // Consent is user-initiated, never on app mount or login.
  const result=await api('push-preference',{optedIn:true});
  if(result.optedIn!==true)throw new Error('Push consent was not accepted.');
  const platform=capacitor.getPlatform();
  const installationId=getStagingInstallationId(storage,user,makeUUID);
  const device=await api('devices',{installationId,platform});
  if(device.status!=='enrolled')throw new Error('Device enrollment was not confirmed.');
  const messaging=capacitor.Plugins.FirebaseMessaging;
  const permissions=await messaging.requestPermissions();
  if(permissions?.receive!=='granted')
    return {status:'permission_denied',registered:false};
  const registration=await messaging.getToken();
  if(typeof registration?.token!=='string'||registration.token.length<20)
    throw new Error('Firebase did not supply a usable device token.');
  const enrolled=await api('fcm-token',{installationId,token:registration.token});
  if(enrolled.status!=='registered')throw new Error('Staging token registration not confirmed.');
  storage.setItem(STAGING_DEVICE_OWNER_KEY,ownerBinding(user));
  return {status:'registered',registered:true,pushOperational:false};
}
/**
 * A native Firebase token may rotate without user interaction. Sync only when
 * this exact owner already opted in and previously completed server enrollment.
 * NEVER opt users in, create device records, or switch a tenant automatically.
 */
export async function syncRotatedStagingOwnerToken({
  user,capacitor,origin,storage,fetcher,token
}={}){
  if(!eligibleStagingOwner(user,capacitor,origin))
    return {status:'not_applicable'};
  if(!storage||storage.getItem(STAGING_DEVICE_OWNER_KEY)!==ownerBinding(user))
    return {status:'not_enrolled'};
  if(typeof token!=='string'||!/^[A-Za-z0-9:_-]{20,4096}$/.test(token))
    return {status:'invalid_token'};
  const key=STAGING_PUSH_STORAGE_PREFIX+
    encodeURIComponent(user.tenant_id)+':'+encodeURIComponent(user.id);
  const installationId=storage.getItem(key);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId||''))
    return {status:'not_enrolled'};
  // Always recheck the exact isolated-staging, owner-authenticated server
  // instead of assuming registration can proceed because a token event fired.
  const jwt=storage.getItem('gastroflow_token');
  if(!jwt)return {status:'not_authorized'};
  try{
    const reply=await fetcher('/api/owner/communications/push-enrollment-readiness',{
      method:'GET',credentials:'same-origin',
      headers:{Authorization:'Bearer '+jwt}
    });
    const readiness=await reply.json().catch(()=>({}));
    if(!reply.ok||readiness.enabled!==true)
      return {status:'disabled'};
    const result=await stagingPushApi('fcm-token',{installationId,token},{storage,fetcher});
    return result.status==='registered'
      ?{status:'synced',pushOperational:false}:{status:'unconfirmed'};
  }catch{
    return {status:'unconfirmed'};
  }
}
export async function revokeStagingOwnerPush({user,storage,fetcher}={}){
  if(!user?.id||!user?.tenant_id||user.role!=='owner'||user.isPlatformAdmin)
    throw new Error('Owner account required.');
  // Consent withdrawal is server-tenant-scoped and revokes ALL old device/token
  // bindings for this owner, even if token-registration flags were disabled.
  const result=await stagingPushApi('push-preference',{optedIn:false},{storage,fetcher});
  if(result.optedIn!==false)throw new Error('Push revocation not confirmed.');
  clearOwnerBinding(storage,user);
  return {status:'disabled'};
}

/**
 * Best-effort device-only revocation when this staging native app signs out.
 * Never revokes all of an owner's other installations. The auth JWT must still
 * be valid; server-enforced tenancy remains authoritative. A failed network
 * request leaves the server-side token gated to the previous owner (not shared
 * with the new session), and should be corrected from the Devices UI.
 */
export async function revokeStagingInstallationOnLogout({
  user,capacitor,origin,storage,fetcher
}={}){
  if(!eligibleStagingOwner(user,capacitor,origin))
    return {status:'not_applicable'};
  const key=STAGING_PUSH_STORAGE_PREFIX+
    encodeURIComponent(user.tenant_id)+':'+encodeURIComponent(user.id);
  const installationId=storage?.getItem(key);
  if(!installationId)return {status:'not_enrolled'};
  try{
    const response=await stagingPushApi(
      'devices/revoke',{installationId},{storage,fetcher}
    );
    if(response?.status==='revoked'||response?.status==='not_found'){
      clearOwnerBinding(storage,user);
      return {status:'revoked'};
    }
    return {status:'unconfirmed'};
  }catch{
    return {status:'unconfirmed'};
  }
}
