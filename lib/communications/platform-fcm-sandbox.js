/**
 * Dormant Firebase Cloud Messaging HTTP v1 transport for staging-only owner push.
 *
 * This module is NOT mounted into the application server or any scheduler.
 * It uses a service-account OAuth 2.0 JWT to access the official FCM v1 API;
 * credentials never go to browsers and only an explicit operator invocation
 * with an authorized owner-specific token can send a notification.
 * It does not accept topics or conditions (which would bypass tenant scoping).
 */
import crypto from 'node:crypto';

const PROJECT=/^[a-z][a-z0-9-]{4,62}$/;
const SERVICE_EMAIL=/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/;
const FCM_TOKEN=/^[A-Za-z0-9:_-]{20,4096}$/;
const NOTICE_ID=/^[A-Za-z0-9_-]{1,180}$/;
const AUDIENCE='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/firebase.messaging';
const ACK='I_APPROVE_STAGING_FCM_SANDBOX';

export function fcmSandboxConfig(env={}){
  const project=String(env.PLATFORM_COMMUNICATIONS_FCM_PROJECT_ID||'');
  const email=String(env.PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL||'');
  const rawKey=String(env.PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY||'').replace(/\\n/g,'\n');
  const configured=PROJECT.test(project)&&SERVICE_EMAIL.test(email)&&
    rawKey.includes('-----BEGIN PRIVATE KEY-----')&&rawKey.includes('-----END PRIVATE KEY-----');
  const enabled=configured&&
    env.PLATFORM_COMMUNICATIONS_ENABLED==='true'&&
    env.PLATFORM_COMMUNICATIONS_STAGE==='staging'&&
    env.PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED==='true'&&
    env.PLATFORM_COMMUNICATIONS_FCM_SEND_ENABLED==='true'&&
    env.PLATFORM_COMMUNICATIONS_FCM_STOP==='false'&&
    env.PLATFORM_COMMUNICATIONS_FCM_ACK===ACK;
  return {enabled,configured,project};
}

const b64url=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
export function createFcmServiceJwt({clientEmail,privateKey,now=Date.now()}){
  if(!SERVICE_EMAIL.test(String(clientEmail||''))||
    typeof privateKey!=='string'||!privateKey.includes('-----BEGIN PRIVATE KEY-----')||
    !Number.isSafeInteger(now)||now<=0)throw new Error('Invalid FCM service account.');
  const seconds=Math.floor(now/1000);
  const signingInput=b64url({alg:'RS256',typ:'JWT'})+'.'+b64url({
    iss:clientEmail,scope:SCOPE,aud:AUDIENCE,iat:seconds,exp:seconds+3600
  });
  const signature=crypto.sign('RSA-SHA256',Buffer.from(signingInput),privateKey).toString('base64url');
  return signingInput+'.'+signature;
}

function validInput({token,announcementId,title,body}={}){
  return typeof token==='string'&&FCM_TOKEN.test(token)&&
    typeof announcementId==='string'&&NOTICE_ID.test(announcementId)&&
    typeof title==='string'&&title.trim().length>=3&&title.length<=140&&
    typeof body==='string'&&body.trim().length>=5&&body.length<=900;
}

async function jsonReply(response){
  if(!response||typeof response.ok!=='boolean'||typeof response.json!=='function')
    throw new Error('Malformed provider response.');
  const json=await response.json();
  if(!json||typeof json!=='object'||Array.isArray(json))
    throw new Error('Invalid provider response.');
  return json;
}

/**
 * One explicitly authorized staging send. Does not perform eligibility checks:
 * a future worker MUST resolve token from an authenticated tenant-owned,
 * opted-in registration just before invoking this transport.
 * Error messages never contain credentials, tokens, provider bodies or PII.
 */
export async function sendOneSandboxOwnerFcm({
  env={},fetcher=globalThis.fetch,token,announcementId,title,body,now=Date.now()
}={}){
  const config=fcmSandboxConfig(env);
  if(!config.enabled)return {accepted:false,reason:'DISABLED'};
  if(!validInput({token,announcementId,title,body}))return {accepted:false,reason:'INVALID_REQUEST'};
  if(typeof fetcher!=='function')return {accepted:false,reason:'NO_TRANSPORT'};
  const key=String(env.PLATFORM_COMMUNICATIONS_FCM_PRIVATE_KEY).replace(/\\n/g,'\n');
  try{
    const jwt=createFcmServiceJwt({
      clientEmail:env.PLATFORM_COMMUNICATIONS_FCM_CLIENT_EMAIL,
      privateKey:key,now
    });
    const exchange=await fetcher(AUDIENCE,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt
      }).toString(),
      signal:AbortSignal.timeout(10000)
    });
    const auth=await jsonReply(exchange);
    if(!exchange.ok||typeof auth.access_token!=='string'||auth.access_token.length<10)
      return {accepted:false,reason:'OAUTH_UNCONFIRMED'};
    const response=await fetcher(
      `https://fcm.googleapis.com/v1/projects/${config.project}/messages:send`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${auth.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({message:{
          token,
          notification:{title,body},
          data:{kind:'platform_owner_announcement',announcementId},
          android:{priority:'high'},
          apns:{headers:{'apns-push-type':'alert'}}
        }}),
        signal:AbortSignal.timeout(10000)
      });
    const result=await jsonReply(response);
    // FCM API acceptance is NOT confirmation of device display or user reading.
    if(!response.ok||typeof result.name!=='string'||
      !result.name.startsWith(`projects/${config.project}/messages/`))
      return {accepted:false,reason:'FCM_UNCONFIRMED'};
    return {accepted:true,deviceDelivered:false};
  }catch{
    // A transport timeout may occur after acceptance. Never blindly retry.
    return {accepted:false,reason:'MANUAL_REVIEW_REQUIRED'};
  }
}
