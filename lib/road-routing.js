// GastroFlow road routing provider adapter. No public/demo routing service is used
// implicitly; configure a dedicated trusted OSRM-compatible HTTPS origin.
export function validRoadPoint(point) {
  const lat=Number(point?.lat),lng=Number(point?.lng);
  return point && point.lat!=null && point.lng!=null && Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
}
export function routingOrigin(config=process.env.GASTROFLOW_ROUTING_URL) {
  if(!config)return null;
  try{
    const u=new URL(config);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
    const host=u.hostname.toLowerCase();
    // Explicitly do not route commercial orders through the public demo.
    if(host==='router.project-osrm.org'||host==='routing.openstreetmap.de'||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$)/.test(host))return null;
    return u.origin;
  }catch{return null;}
}
export function roadRouteUrl(origin,from,to) {
  if(!origin||!validRoadPoint(from)||!validRoadPoint(to))return null;
  const loc=p=>`${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`;
  return `${origin}/route/v1/driving/${loc(from)};${loc(to)}?overview=full&geometries=geojson&steps=false&alternatives=false`;
}
export function parseRoadRoute(payload) {
  if(payload?.code!=='Ok')return null;
  const r=payload.routes?.[0],geom=r?.geometry;
  if(!r||!Number.isFinite(r.distance)||r.distance<0||r.distance>250000||!Number.isFinite(r.duration)||r.duration<0||r.duration>24*3600||geom?.type!=='LineString'||!Array.isArray(geom.coordinates))return null;
  if(geom.coordinates.length<2||geom.coordinates.length>12000)return null;
  const coordinates=geom.coordinates.filter(c=>Array.isArray(c)&&c.length>=2&&validRoadPoint({lat:c[1],lng:c[0]})).map(c=>[Number(c[0]),Number(c[1])]);
  if(coordinates.length!==geom.coordinates.length)return null;
  // OSRM should return the requested route endpoints. Reject malformed or
  // unrelated geometry rather than displaying a plausible-looking wrong road.
  const distanceBetween=(a,b)=>{
    const rad=Math.PI/180,lat1=a[1]*rad,lat2=b[1]*rad;
    const dlat=lat2-lat1,dlng=(b[0]-a[0])*rad;
    const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;
    return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  };
  let lengthMeters=0;
  for(let i=1;i<coordinates.length;i++){
    const step=distanceBetween(coordinates[i-1],coordinates[i]);
    if(!Number.isFinite(step)||step>50000)return null;
    lengthMeters+=step;
  }
  // A route's road length cannot be less than its summed straight segments.
  // Leave a small tolerance for geometry simplification and provider rounding.
  if(lengthMeters>r.distance*1.15+500)return null;
  return {available:true,source:'road',distanceKm:Math.round(r.distance/100)/10,travelMinutes:Math.ceil(r.duration/60),geometry:{type:'LineString',coordinates}};
}
export async function fetchRoadRoute({from,to,origin=routingOrigin(),routingKey=process.env.GASTROFLOW_ROUTING_KEY,fetchImpl=fetch,timeoutMs=3500}={}) {
  const url=roadRouteUrl(origin,from,to);
  // Require an explicit server-to-server credential before sending any route request.
  // A public OSRM demo must never silently become a production dependency.
  if(!url || typeof routingKey!=='string' || routingKey.length<32 || /[\r\n]/.test(routingKey))return null;
  try{
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error',headers:{Accept:'application/json','X-GastroFlow-Routing-Key':routingKey}});
    if(!response.ok)return null;
    return parseRoadRoute(await response.json());
  }catch{return null;}
}
