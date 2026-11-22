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
    // Do not accidentally send customer/rider coordinates to loopback or a
    // private network target. An HTTPS endpoint must be explicitly configured.
    if(host==='router.project-osrm.org'||host==='routing.openstreetmap.de'||
      host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||
      host.endsWith('.internal')||host.endsWith('.localhost.localdomain')||
      host.startsWith('['))return null;
    // URL normalizes IPv4 representations (including hexadecimal and shortened
    // forms) to dotted decimals. Deny non-public IPv4 ranges.
    const octets=host.split('.').map(Number);
    if(octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
      const [a,b]=octets;
      if(a===0||a===10||a===127||a>=224||a===169&&b===254||
        a===172&&b>=16&&b<=31||a===192&&b===168||
        a===100&&b>=64&&b<=127||a===192&&b===0||
        a===198&&(b===18||b===19)||a===198&&b===51||
        a===203&&b===0)return null;
    }
    return u.origin;
  }catch{return null;}
}
export function roadRouteUrl(origin,from,to) {
  if(!origin||!validRoadPoint(from)||!validRoadPoint(to))return null;
  const loc=p=>`${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`;
  return `${origin}/route/v1/driving/${loc(from)};${loc(to)}?overview=full&geometries=geojson&steps=false&alternatives=false`;
}
function roadDistanceMeters(a,b) {
  const rad=Math.PI/180,lat1=Number(a.lat)*rad,lat2=Number(b.lat)*rad;
  const dlat=lat2-lat1,dlng=(Number(b.lng)-Number(a.lng))*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;
  return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function parseRoadRoute(payload,{from,to,maxSnapMeters=1500}={}) {
  if(payload?.code!=='Ok')return null;
  const r=payload.routes?.[0],geom=r?.geometry;
  if(!r||!Number.isFinite(r.distance)||r.distance<0||r.distance>250000||!Number.isFinite(r.duration)||r.duration<0||r.duration>24*3600||geom?.type!=='LineString'||!Array.isArray(geom.coordinates))return null;
  if(geom.coordinates.length<2||geom.coordinates.length>12000)return null;
  const coordinates=geom.coordinates.filter(c=>Array.isArray(c)&&c.length>=2&&validRoadPoint({lat:c[1],lng:c[0]})).map(c=>[Number(c[0]),Number(c[1])]);
  if(coordinates.length!==geom.coordinates.length)return null;
  // Reject lines that do not start/end near the *requested* coordinates.
  // A 1.5 km tolerance allows normal snapping to the road network.
  if(from&&to){
    if(!validRoadPoint(from)||!validRoadPoint(to))return null;
    if(roadDistanceMeters(from,{lat:coordinates[0][1],lng:coordinates[0][0]})>maxSnapMeters||
       roadDistanceMeters(to,{lat:coordinates.at(-1)[1],lng:coordinates.at(-1)[0]})>maxSnapMeters)return null;
  }
  let lengthMeters=0;
  for(let i=1;i<coordinates.length;i++){
    const step=roadDistanceMeters({lat:coordinates[i-1][1],lng:coordinates[i-1][0]},{lat:coordinates[i][1],lng:coordinates[i][0]});
    if(!Number.isFinite(step)||step>50000)return null;
    lengthMeters+=step;
  }
  // A route's road length cannot be less than its summed straight segments.
  // Leave a small tolerance for geometry simplification and provider rounding.
  if(lengthMeters>r.distance*1.15+500)return null;
  return {available:true,source:'road',distanceKm:Math.round(r.distance/100)/10,travelMinutes:Math.ceil(r.duration/60),geometry:{type:'LineString',coordinates}};
}
export async function fetchRoadRoute({from,to,origin=routingOrigin(),routingKey=process.env.GASTROFLOW_ROUTING_KEY,fetchImpl=fetch,timeoutMs=3500,forPricing=false}={}) {
  const url=roadRouteUrl(origin,from,to);
  // Require an explicit server-to-server credential before sending any route request.
  // A public OSRM demo must never silently become a production dependency.
  if(!url || typeof routingKey!=='string' || routingKey.length<32 || /[\r\n]/.test(routingKey))return null;
  try{
    const routeUrl = forPricing ? `${url}&radiuses=100;100` : url;
    const response=await fetchImpl(routeUrl,{signal:AbortSignal.timeout(timeoutMs),redirect:'error',headers:{Accept:'application/json','X-GastroFlow-Routing-Key':routingKey}});
    if(!response.ok)return null;
    const payload = await response.json();
    const route = parseRoadRoute(payload, {from, to, maxSnapMeters: forPricing ? 100 : 1500});
    if (route && forPricing) return {...route, distanceMeters: payload.routes[0].distance};
    return route;
  }catch{return null;}
}
