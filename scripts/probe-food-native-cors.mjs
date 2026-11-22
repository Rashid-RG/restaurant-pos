// Read-only staging diagnostics for native WebView CORS.
// Sends anonymous GET and OPTIONS requests only; never authenticates, logs response bodies, or submits orders.
// Strict mode is opt-in for a future authorized native acceptance gate.
const DEFAULT_HOST='https://gastroflow-staging.onrender.com';
export const WEBVIEW_ORIGINS=['https://localhost','capacitor://localhost'];
export function evaluatePreflight(response,origin,{method='GET',headers=['content-type','x-tenant-id']}={}){
  if(!response)return {allowed:false,reason:'no-response'};
  const get=name=>response.headers?.get?.(name)||null;
  const allowOrigin=get('access-control-allow-origin');
  const allowHeaders=String(get('access-control-allow-headers')||'').toLowerCase().split(',').map(s=>s.trim());
  const allowMethods=String(get('access-control-allow-methods')||'').toUpperCase().split(',').map(s=>s.trim());
  if(response.status===401 || response.status===403){
    // Rejected preflights may fall through to the server auth handler. A
    // gateway-level challenge can look identical; do not misdiagnose login.
    return {allowed:false,reason:get('www-authenticate')?'upstream-auth-challenge':'preflight-rejected-or-auth-gate'};
  }
  if(response.status<200||response.status>=300)return {allowed:false,reason:'http-'+response.status};
  if(allowOrigin!==origin)return {allowed:false,reason:'origin-not-authorized'};
  if(get('access-control-allow-credentials')!=='true')return {allowed:false,reason:'credentials-not-enabled'};
  if(!allowMethods.includes(method.toUpperCase()))return {allowed:false,reason:'method-not-authorized'};
  if(!headers.every(name=>allowHeaders.includes(name.toLowerCase())))
    return {allowed:false,reason:'required-headers-not-authorized'};
  return {allowed:true,reason:'preflight-accepted'};
}
// The installed customer app's restaurant discovery is a simple anonymous GET.
// Unlike the private menu/checkout preflights it sends no tenant header and no
// JSON body. Probe this separately without cookies, tokens, or response logging.
export function evaluateNativeDiscoveryGet(response,origin){
  if(!response)return {allowed:false,reason:'no-response'};
  const allowOrigin=response.headers?.get?.('access-control-allow-origin')||null;
  const challenge=response.headers?.get?.('www-authenticate')||null;
  if(response.status===401 || response.status===403)
    return {allowed:false,reason:challenge?'upstream-auth-challenge':'discovery-auth-or-upstream-gate'};
  if(response.status<200 || response.status>=300)
    return {allowed:false,reason:'http-'+response.status};
  if(allowOrigin!==origin)
    return {allowed:false,reason:'discovery-get-origin-not-authorized'};
  return {allowed:true,reason:'anonymous-discovery-get-accepted'};
}
export async function probeNativeDiscoveryGet({host=DEFAULT_HOST,fetcher=fetch,timeoutMs=12000}={}){
  const url=new URL('/api/public/restaurants',host);
  if(url.protocol!=='https:'||url.origin!==host||host!==DEFAULT_HOST)
    throw new Error('Only the approved GastroFlow staging HTTPS origin can be probed');
  const reports=[];
  for(const origin of WEBVIEW_ORIGINS){
    try{
      const response=await fetcher(url.href,{
        method:'GET',
        headers:{Origin:origin},
        credentials:'omit',
        signal:AbortSignal.timeout(timeoutMs),
        redirect:'manual',
        cache:'no-store'
      });
      reports.push({origin,request:'anonymous-GET',httpStatus:response.status,
        ...evaluateNativeDiscoveryGet(response,origin)});
      // Never inspect or log restaurant/customer data in diagnostic output.
      await response.body?.cancel?.().catch?.(()=>{});
    }catch(e){
      reports.push({origin,request:'anonymous-GET',allowed:false,
        reason:e?.name==='TimeoutError'?'timeout':'network-unreachable'});
    }
  }
  return reports;
}

export async function probeNativeCors({host=DEFAULT_HOST,fetcher=fetch,timeoutMs=12000}={}){
  const url=new URL('/api/public/restaurants',host);
  if(url.protocol!=='https:'||url.origin!==host||host!==DEFAULT_HOST)
    throw new Error('Only the approved GastroFlow staging HTTPS origin can be probed');
  const reports=[];
  for(const origin of WEBVIEW_ORIGINS){
    try{
      const response=await fetcher(url.href,{
        method:'OPTIONS',
        headers:{
          Origin:origin,
          'Access-Control-Request-Method':'GET',
          'Access-Control-Request-Headers':'content-type,x-tenant-id'
        },
        signal:AbortSignal.timeout(timeoutMs),
        redirect:'manual'
      });
      reports.push({origin,httpStatus:response.status,...evaluatePreflight(response,origin)});
    }catch(e){
      reports.push({origin,allowed:false,reason:e?.name==='TimeoutError'?'timeout':'network-unreachable'});
    }
  }
  return reports;
}
// Simulate the browser's preflight for each native feature without ever
// sending an order, OTP, payment, private query, or customer credential.
// OPTIONS only; the backend's auth/tenant checks still require device tests.
export const NATIVE_PREFLIGHT_CASES=Object.freeze([
  {name:'tenant-menu',path:'/api/public/menu',method:'GET',headers:['x-tenant-id']},
  {name:'customer-otp-login',path:'/api/otp/verify',method:'POST',headers:['content-type','x-tenant-id']},
  {name:'customer-account',path:'/api/customer/auth/me',method:'GET',headers:['authorization','x-tenant-id']},
  {name:'restaurant-checkout',path:'/api/public/orders',method:'POST',headers:['content-type','x-tenant-id']},
  {name:'private-order-tracking',path:'/api/public/orders/cors-probe-no-real-order',method:'GET',headers:['x-order-tracking','x-tenant-id']}
]);

export async function probeNativeFeaturePreflights({host=DEFAULT_HOST,fetcher=fetch,timeoutMs=12000}={}){
  const root=new URL(host);
  if(root.origin!==DEFAULT_HOST||root.href!==DEFAULT_HOST+'/')
    throw new Error('Only the approved GastroFlow staging HTTPS origin can be probed');
  const results=[];
  for(const origin of WEBVIEW_ORIGINS){
    for(const feature of NATIVE_PREFLIGHT_CASES){
      try{
        const res=await fetcher(new URL(feature.path,root).href,{
          method:'OPTIONS',
          headers:{
            Origin:origin,
            'Access-Control-Request-Method':feature.method,
            'Access-Control-Request-Headers':feature.headers.join(',')
          },
          signal:AbortSignal.timeout(timeoutMs),
          redirect:'manual'
        });
        results.push({origin,request:'feature-preflight',feature:feature.name,
          httpStatus:res.status,...evaluatePreflight(res,origin,{
            method:feature.method,headers:feature.headers
          })});
        await res.body?.cancel?.().catch?.(()=>{});
      }catch(error){
        results.push({origin,request:'feature-preflight',feature:feature.name,
          allowed:false,reason:error?.name==='TimeoutError'?'timeout':'network-unreachable'});
      }
    }
  }
  return results;
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const strict=process.argv.includes('--require-allowed');
  try{
    const preflight=await probeNativeCors();
    const discovery=await probeNativeDiscoveryGet();
    const features=await probeNativeFeaturePreflights();
    const reports=[...preflight.map(e=>({...e,request:'private-preflight'})),...discovery,...features];
    for(const entry of reports)console.log(JSON.stringify(entry));
    if(reports.some(entry=>!entry.allowed)){
      console.log('Native staged API acceptance remains BLOCKED; no Render settings changed.');
      if(strict)process.exitCode=1;
    }else console.log('All native feature preflights and anonymous discovery CORS accepted; actual login/checkout testing is still required.');
  }catch(e){console.error('Probe setup error:',e.message);process.exitCode=1}
}
