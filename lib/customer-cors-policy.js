import {configuredNativeOrigins,invalidNativeOriginEntries} from './customer-native-origins.js';

// The browser-facing POS and the customer app share an API. Never widen CORS
// for an arbitrary local host, and never interpret a missing Origin as proof
// of a trusted customer login. Actual authentication/tenant checks stay intact.
export function resolveCustomerCorsOrigins({isProd=true,corsOrigin='',nativeOrigins=''}={}){
  const native=configuredNativeOrigins(nativeOrigins);
  const browser=String(corsOrigin||'').split(',').map(s=>s.trim()).filter(Boolean);
  const dev=isProd?[]:[
    'http://localhost:3000','http://localhost:3001',
    'http://127.0.0.1:3000','http://127.0.0.1:3001',
    'http://localhost:5173','http://localhost:5174'
  ];
  return [...new Set([...dev,...native,...browser])];
}
export function customerCorsOriginHandler({isProd=true,allowedOrigins=[]}={}){
  const allowed=new Set(allowedOrigins);
  return (origin,callback)=>{
    if(!origin||!isProd||allowed.has(origin))return callback(null,true);
    // Missing CORS response headers are deliberate for untrusted origins.
    return callback(null,false);
  };
}
export function auditStagingNativeCorsConfig({nativeOrigins='',corsOrigin=''}={}){
  const required=['https://localhost','capacitor://localhost'];
  const configured=configuredNativeOrigins(nativeOrigins);
  const invalid=invalidNativeOriginEntries(nativeOrigins);
  const browser=String(corsOrigin||'').split(',').map(s=>s.trim()).filter(Boolean);
  const missing=required.filter(s=>!configured.includes(s));
  // This audit never prints existing staging browser origins or secrets.
  return {
    ready:missing.length===0&&invalid.length===0&&
      !browser.some(s=>s==='*'||s==='null'||s==='https://localhost'||s==='capacitor://localhost'),
    missingNativeOrigins:missing,
    invalidNativeOriginCount:invalid.length,
    reservedNativeOriginInBrowserCors:browser.some(s=>s==='https://localhost'||s==='capacitor://localhost'),
  };
}
