import { nativeApiOrigin } from './native-api-origin.js';

// Web/PWA images keep the same behavior. In a packaged Capacitor WebView,
// root-relative store images must come from the approved HTTPS API host rather
// than https://localhost or capacitor://localhost.
// Absolute HTTPS photos from other providers remain intact.
export function resolveCustomerImageUrl(value,{nativeBuild=false,configuredOrigin}={}){
  if(typeof value!=='string'||!value.trim())return '';
  const url=value.trim();
  if(!nativeBuild)return url;
  if(url.startsWith('/') && !url.startsWith('//')){
    const path=new URL(url,nativeApiOrigin(configuredOrigin));
    // Native image resolution is never allowed to rewrite to a new origin.
    return path.href;
  }
  return url;
}
