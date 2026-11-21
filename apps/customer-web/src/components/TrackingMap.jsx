import React, {useEffect,useRef,useState} from 'react';
import {LocateFixed} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function emojiIcon(emoji,cls) {
  return L.divIcon({className:`tm-icon ${cls}`,html:`<div class="tm-emoji">${emoji}</div>`,iconSize:[38,38],iconAnchor:[19,34]});
}
const valid=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const distanceMeters=(a,b)=>{
  if(!valid(a)||!valid(b))return Infinity;
  const rad=Math.PI/180,dl=(b.lat-a.lat)*rad, dg=(b.lng-a.lng)*rad;
  const h=Math.sin(dl/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dg/2)**2;
  return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
};

/**
 * Last confirmed GPS positions on OpenStreetMap. Marker animation is a short
 * visual interpolation, not predicted rider movement or a navigable road route.
 */
export default function TrackingMap({store,dest,driver,route,gpsState}) {
  const roadPoints=React.useMemo(()=>{
    const coordinates=route?.geometry?.coordinates;
    const hasRoad=route?.available===true && route.geometry?.type==='LineString' &&
      Array.isArray(coordinates) && coordinates.length>=2 && coordinates.length<=10000 &&
      coordinates.every(c=>Array.isArray(c) && c.length>=2 &&
        Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
        Math.abs(c[0])<=180 && Math.abs(c[1])<=90);
    return hasRoad ? coordinates.map(([lng,lat])=>[lat,lng]) : null;
  },[route]);
  const el=useRef(null),map=useRef(null),markers=useRef({});
  const routeLine=useRef(null),accuracyCircle=useRef(null),animation=useRef(null);
  const fitted=useRef(false),driverRef=useRef(null);
  const [followRider,setFollowRider]=useState(false);
  const followingRef=useRef(false);
  const setFollowing=value=>{followingRef.current=value;setFollowRider(value);};

  useEffect(()=>{
    if(map.current||!el.current)return;
    const center=valid(dest)?dest:valid(store)?store:{lat:6.9271,lng:79.8612};
    const m=L.map(el.current,{zoomControl:false,attributionControl:true}).setView([center.lat,center.lng],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors'
    }).addTo(m);

    map.current=m;
    // User gestures stop automatic centering. Never move a marker without a new GPS fix.
    const stopFollowing=()=>setFollowing(false);
    m.on('dragstart',stopFollowing);
    const userZoom=event=>{if(event?.originalEvent)stopFollowing();};
    m.on('zoomstart',userZoom);
    const invalidate=()=>{if(map.current===m)m.invalidateSize({pan:false});};
    const timeout=window.setTimeout(invalidate,200);
    // Expanding the journey sheet, rotating the phone, or restoring Safari
    // can change the map viewport without triggering Leaflet's own resize.
    const observer=typeof ResizeObserver!=='undefined'
      ? new ResizeObserver(invalidate) : null;
    if(observer)observer.observe(el.current);
    window.addEventListener('resize',invalidate);
    const onVisible=()=>{if(document.visibilityState==='visible')invalidate();};
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      window.clearTimeout(timeout);
      observer?.disconnect();
      window.removeEventListener('resize',invalidate);
      document.removeEventListener('visibilitychange',onVisible);
      if(animation.current!==null){window.cancelAnimationFrame(animation.current);animation.current=null;}
      m.off('dragstart',stopFollowing);m.off('zoomstart',userZoom);
      m.remove();map.current=null;markers.current={};routeLine.current=null;
      accuracyCircle.current=null;fitted.current=false;driverRef.current=null;
    };
  },[]);

  useEffect(()=>{
    const m=map.current;if(!m)return;
    driverRef.current=valid(driver)?driver:null;
    if(!driverRef.current)setFollowing(false);
    const upsert=(key,point,emoji,cls,label)=>{
      const existing=markers.current[key];
      if(!valid(point)){
        if(existing){m.removeLayer(existing);delete markers.current[key];}
        return;
      }
      if(!existing){
        markers.current[key]=L.marker([point.lat,point.lng],{icon:emojiIcon(emoji,cls)})
          .addTo(m).bindTooltip(label,{direction:'top'});
      }else if(key!=='driver'){
        existing.setLatLng([point.lat,point.lng]);
      }
    };
    upsert('store',store,'🏬','tm-store','Restaurant');
    upsert('dest',dest,'📍','tm-dest','Delivery destination');
    upsert('driver',driver,'🛵','tm-driver','Last confirmed rider position');

    if(animation.current!==null){window.cancelAnimationFrame(animation.current);animation.current=null;}
    if(valid(driver)&&markers.current.driver){
      const marker=markers.current.driver;
      const from=marker.getLatLng();
      const next={lat:driver.lat,lng:driver.lng};
      const distance=distanceMeters(from,next);
      const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if(distance>1&&distance<=500&&!reduceMotion){
        const started=performance.now(),duration=1100;
        const animate=(now)=>{
          if(!map.current)return;
          const t=Math.min(1,(now-started)/duration);
          const eased=t*t*(3-2*t);
          marker.setLatLng([from.lat+(next.lat-from.lat)*eased,from.lng+(next.lng-from.lng)*eased]);
          if(t<1)animation.current=window.requestAnimationFrame(animate);
          else animation.current=null;
        };
        animation.current=window.requestAnimationFrame(animate);
      }else marker.setLatLng([next.lat,next.lng]);
      if(followingRef.current && distance>0){
        // Camera follows only measured positions; never interpolate beyond the latest fix.
        m.panTo([next.lat,next.lng],{animate:true,duration:.6});
      }
    }

    // Route geometry is external data: reject malformed coordinates before
    // giving them to Leaflet, and avoid a large accidental browser render.
    const points=roadPoints;
    const hasRoad=Boolean(points);
    const from=valid(driver)?driver:valid(store)?store:null;
    if(points || (from&&valid(dest))){
      const ends=points || [[from.lat,from.lng],[dest.lat,dest.lng]];
      if(!routeLine.current)routeLine.current=L.polyline(ends,{color:'#171b25',weight:hasRoad?4:2,opacity:hasRoad?.85:.6,dashArray:hasRoad?null:'3,9'}).addTo(m);
      else {
        routeLine.current.setLatLngs(ends);
        routeLine.current.setStyle({weight:hasRoad?4:2,opacity:hasRoad?.85:.6,dashArray:hasRoad?null:'3,9'});
      }
    }else if(routeLine.current){m.removeLayer(routeLine.current);routeLine.current=null;}

    // GPS accuracy circle is a measurement from the device, not a location guarantee.
    const accuracy=Number(driver?.accuracyMeters);
    if(valid(driver)&&Number.isFinite(accuracy)&&accuracy>0&&accuracy<=150){
      if(!accuracyCircle.current)accuracyCircle.current=L.circle([driver.lat,driver.lng],{
        radius:accuracy,color:'#087653',weight:1,fillColor:'#10b981',fillOpacity:.075,interactive:false
      }).addTo(m);
      else accuracyCircle.current.setLatLng([driver.lat,driver.lng]).setRadius(accuracy);
    }else if(accuracyCircle.current){m.removeLayer(accuracyCircle.current);accuracyCircle.current=null;}

    if(!fitted.current){
      const pts=[store,dest,driver].filter(valid);
      if(points)pts.push(...points.map(([lat,lng])=>({lat,lng})));
      if(pts.length>1){
        m.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])).pad(.24),{maxZoom:16});
        fitted.current=true;
      }else if(pts.length===1){m.setView([pts[0].lat,pts[0].lng],15);fitted.current=true;}
    }
  },[store?.lat,store?.lng,dest?.lat,dest?.lng,driver?.lat,driver?.lng,driver?.accuracyMeters,route]);

  const locateRider=(follow)=>{
    const p=driverRef.current;
    if(!map.current||!valid(p))return;
    setFollowing(follow);
    map.current.flyTo([p.lat,p.lng],Math.max(14,map.current.getZoom()),{duration:.65});
  };
  const showJourney=()=>{
    setFollowing(false);
    const m=map.current;
    if(!m)return;
    const points=[store,dest,driverRef.current].filter(valid);
    if(routeLine.current)points.push(...routeLine.current.getLatLngs());
    if(points.length>1)m.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng])).pad(.18),{maxZoom:16});
    else if(points.length===1)m.setView([points[0].lat,points[0].lng],14);
  };

  return <>
    <div ref={el} className="tm-map" aria-label="Delivery route map"/>
    <span className="gf-trip-map-state">{gpsState.state==='fresh' && roadPoints ? '' : [gpsState.label, !roadPoints && (valid(driver)||valid(store))?'Direct line · road route unavailable':''].filter(Boolean).join(' · ')}</span>
    <button type="button" className="gf-trip-center" aria-label={followRider?'Show entire route':valid(driver)?'Recenter and follow rider':'Show entire route'}
      aria-pressed={followRider} onClick={()=>valid(driver)&&!followRider?locateRider(true):showJourney()}><LocateFixed size={19}/></button>
  </>;
}
