// Native builds must explicitly opt into a trusted HTTPS API host.
// The web/PWA build retains the existing same-origin backend contract.
export function nativeApiOrigin(configured) {
  if (typeof configured !== 'string' || !configured) throw new Error('Native API endpoint is not configured');
  let url;
  try { url=new URL(configured); } catch { throw new Error('Native API endpoint is invalid'); }
  if (url.protocol!=='https:' || !url.hostname || url.username || url.password ||
      url.pathname!=='/' || url.search || url.hash)
    throw new Error('Native API endpoint must be a bare HTTPS origin without credentials');
  return url.origin;
}
export function resolveApiUrl(endpoint,{location,nativeBuild=false,configuredOrigin}={}) {
  const path=String(endpoint||'');
  if (!path.startsWith('/') || path.startsWith('//') || !path.startsWith('/api/'))
    throw new Error('API endpoint must use a relative /api/ path');
  if (nativeBuild) return new URL(path,nativeApiOrigin(configuredOrigin)).href;
  if (!location) throw new Error('Browser location is required');
  const dev=location.port==='3001'||location.port==='3002';
  const origin=dev?`${location.protocol}//${location.hostname}:5000`:location.origin;
  return new URL(path,origin).href;
}
