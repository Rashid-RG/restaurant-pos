import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const port=Number(process.env.PORT||8080);
const upstream=process.env.OSRM_INTERNAL_URL||'http://osrm:5000';
const secret=process.env.GASTROFLOW_ROUTING_KEY||'';
if(secret.length<32||!Number.isInteger(port)||port<1||port>65535)
  throw Error('OSRM gateway requires a strong secret and valid port');
const upstreamUrl=new URL(upstream);
if(upstreamUrl.protocol!=='http:'||upstreamUrl.hostname!=='osrm'||upstreamUrl.port!=='5000')
  throw Error('OSRM backend must be the private container service');
const keyOK=provided=>{
  if(typeof provided!=='string')return false;
  const a=Buffer.from(provided),b=Buffer.from(secret);
  return a.length===b.length&&timingSafeEqual(a,b);
};
const routePattern=/^\/route\/v1\/driving\/-?[\d.]+,-?[\d.]+;-?[\d.]+,-?[\d.]+$/;
createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/healthz'){
    res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;
  }
  if(req.method!=='GET'||!keyOK(req.headers['x-gastroflow-routing-key'])){
    res.writeHead(403);res.end();return;
  }
  try{
    const url=new URL(req.url,'http://localhost');
    if(!routePattern.test(url.pathname)||url.searchParams.get('overview')!=='full'||
       url.searchParams.get('geometries')!=='geojson'||url.searchParams.get('steps')!=='false'||
       url.searchParams.get('alternatives')!=='false'||[...url.searchParams].length!==4){
      res.writeHead(400);res.end();return;
    }
    const points=url.pathname.split('/').at(-1).split(';').map(v=>v.split(',').map(Number));
    if(points.some(([lng,lat])=>!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lat)>90||Math.abs(lng)>180)){
      res.writeHead(400);res.end();return;
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),3000);
    try{
      const response=await fetch(upstream+url.pathname+url.search,{signal:controller.signal,redirect:'error'});
      if(!response.ok){res.writeHead(502);res.end();return;}
      const body=await response.text();
      if(body.length>1_000_000){res.writeHead(502);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(body);
    }finally{clearTimeout(timer);}
  }catch{res.writeHead(503);res.end();}
}).listen(port,'0.0.0.0');
