// Rings contain [longitude, latitude] vertices. Their closing edge is implicit.
const cross = (a,b,p) => (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
function onEdge(a,b,p) {
  return Math.abs(cross(a,b,p)) < 1e-12 && p[0]>=Math.min(a[0],b[0]) && p[0]<=Math.max(a[0],b[0]) &&
    p[1]>=Math.min(a[1],b[1]) && p[1]<=Math.max(a[1],b[1]);
}
function crosses(a,b,c,d) {
  return onEdge(a,b,c) || onEdge(a,b,d) || onEdge(c,d,a) || onEdge(c,d,b) ||
    (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0);
}
function validRing(points) {
  if (!Array.isArray(points) || points.length<3 || points.length>100) return false;
  if (!points.every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isFinite) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90)) return false;
  if (new Set(points.map(p=>p.join(','))).size!==points.length) return false;
  let area=0;
  for(let i=0;i<points.length;i++) {
    const next=(i+1)%points.length, a=points[i], b=points[next];
    if(Math.abs(a[0]-b[0])>180)return false;
    area+=cross(points[0],a,b);
    for(let j=i+2;j<points.length;j++) {
      const end=(j+1)%points.length;
      if(end!==i && crosses(a,b,points[j],points[end]))return false;
    }
  }
  return Math.abs(area)>1e-12;
}
export function readDeliveryZones(value) {
  if(value==null || value==='')return [];
  let zones;
  try {zones=typeof value==='string'?JSON.parse(value):value;} catch {}
  if(!Array.isArray(zones)||zones.length>20||!zones.every(z=>z && ['include','exclude'].includes(z.kind) && validRing(z.points))) {
    throw Object.assign(new Error('Use up to 20 areas with 3–100 distinct, non-crossing corners each.'),{status:422,code:'INVALID_DELIVERY_ZONES'});
  }
  return zones;
}
function contains(points,p) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[j],b=points[i];
    if(onEdge(a,b,p))return true;
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function zoneIssue(zones,{lat,lng}) {
  if(zones.some(z=>z.kind==='exclude' && contains(z.points,[lng,lat])))return 'excluded_area';
  const allowed=zones.filter(z=>z.kind==='include');
  return allowed.length && !allowed.some(z=>contains(z.points,[lng,lat])) ? 'outside_delivery_area' : null;
}
export function zoneMessage(reason) {
  return reason==='excluded_area' ? 'This entrance is in an excluded delivery area.' :
    reason==='outside_delivery_area' ? 'This entrance is outside the restaurant’s delivery areas.' : '';
}
