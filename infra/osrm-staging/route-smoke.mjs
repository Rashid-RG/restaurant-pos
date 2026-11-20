// A private deterministic startup smoke test. Uses two synthetic public road
// coordinates in Colombo, never a customer/rider position or stored order.
const port=Number(process.env.PORT||10000);
const secret=process.env.GASTROFLOW_ROUTING_KEY||'';
if(secret.length<32)throw Error('Routing key missing');
const url='http://127.0.0.1:'+port+
  '/route/v1/driving/79.861200,6.927100;79.866100,6.931700'+
  '?overview=full&geometries=geojson&steps=false&alternatives=false';
const response=await fetch(url,{
  headers:{'X-GastroFlow-Routing-Key':secret},
  signal:AbortSignal.timeout(3000),
  redirect:'error'
});
if(!response.ok)throw Error('Authenticated routing gateway unavailable');
const result=await response.json();
const route=result?.routes?.[0];
if(result?.code!=='Ok'||!Number.isFinite(route?.distance)||
   route.distance<=0||!Number.isFinite(route.duration)||route.duration<=0||
   route.geometry?.type!=='LineString'||route.geometry.coordinates?.length<2)
  throw Error('OSRM returned no valid Colombo driving route');
console.log(JSON.stringify({
  type:'osrm_startup_smoke',status:'passed',
  distanceMeters:Math.round(route.distance),durationSeconds:Math.round(route.duration)
}));
