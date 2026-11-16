// Read-only staging diagnostics for native WebView CORS.
// Sends OPTIONS requests only, never authenticates or submits customer orders.
// Strict mode is opt-in for a future authorized native acceptance gate.
const DEFAULT_HOST='https://gastroflow-staging.onrender.com';
export const WEBVIEW_ORIGINS=['https://localhost','capacitor://localhost'];
export function evaluatePreflight(response,origin){
  if(!response)return {allowed:false,reason:'no-response'};
  const get=name=>response.headers?.get?.(name)||null;
  const allowOrigin=get('access-control-allow-origin');
  const allowHeaders=String(get('access-control-allow-headers')||'').toLowerCase().split(',').map(s=>s.trim());
  const allowMethods=String(get('access-control-allow-methods')||'').toUpperCase().split(',').map(s=>s.trim());
  if(response.status<200||response.status>=300)return {allowed:false,reason:'http-'+response.status};
  if(allowOrigin!==origin)return {allowed:false,reason:'origin-not-authorized'};
  if(get('access-control-allow-credentials')!=='true')return {allowed:false,reason:'credentials-not-enabled'};
  if(!allowMethods.includes('GET'))return {allowed:false,reason:'get-not-authorized'};
  if(!['content-type','x-tenant-id'].every(name=>allowHeaders.includes(name)))
    return {allowed:false,reason:'required-headers-not-authorized'};
  return {allowed:true,reason:'preflight-accepted'};
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
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const strict=process.argv.includes('--require-allowed');
  try{
    const reports=await probeNativeCors();
    for(const entry of reports)console.log(JSON.stringify(entry));
    if(reports.some(entry=>!entry.allowed)){
      console.log('Native staged API acceptance remains BLOCKED; no Render settings changed.');
      if(strict)process.exitCode=1;
    }else console.log('Preflight accepted for both WebView origins; device authentication testing is still required.');
  }catch(e){console.error('Probe setup error:',e.message);process.exitCode=1}
}
