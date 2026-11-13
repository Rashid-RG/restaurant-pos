import React, {useEffect,useRef} from 'react';
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
export default function TrackingMap({store,dest,driver}) {
  const el=useRef(null),map=useRef(null),markers=useRef({});
  const routeLine=useRef(null),accuracyCircle=useRef(null),animation=useRef(null);
  const fitted=useRef(false),driverRef=useRef(null);

  useEffect(()=>{
    if(map.current||!el.current)return;
    const center=valid(dest)?dest:valid(store)?store:{lat:6.9271,lng:79.8612};
    const m=L.map(el.current,{zoomControl:true,attributionControl:true}).setView([center.lat,center.lng],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors'
    }).addTo(m);
    map.current=m;
    const timeout=window.setTimeout(()=>m.invalidateSize(),200);
    return()=>{
      window.clearTimeout(timeout);
      if(animation.current!==null){window.cancelAnimationFrame(animation.current);animation.current=null;}
      m.remove();map.current=null;markers.current={};routeLine.current=null;
      accuracyCircle.current=null;fitted.current=false;driverRef.current=null;
    };
  },[]);

  useEffect(()=>{
    const m=map.current;if(!m)return;
    driverRef.current=valid(driver)?driver:null;
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
    }

    const from=valid(driver)?driver:valid(store)?store:null;
    if(from&&valid(dest)){
      const ends=[[from.lat,from.lng],[dest.lat,dest.lng]];
      if(!routeLine.current)routeLine.current=L.polyline(ends,{color:'#0c8a63',weight:2,opacity:.6,dashArray:'3,9'}).addTo(m);
      else routeLine.current.setLatLngs(ends);
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
      if(pts.length>1){
        m.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])).pad(.24),{maxZoom:16});
        fitted.current=true;
      }else if(pts.length===1){m.setView([pts[0].lat,pts[0].lng],15);fitted.current=true;}
    }
  },[store?.lat,store?.lng,dest?.lat,dest?.lng,driver?.lat,driver?.lng,driver?.accuracyMeters]);

  const locateRider=()=>{
    const p=driverRef.current;
    if(map.current&&valid(p))map.current.flyTo([p.lat,p.lng],Math.max(14,map.current.getZoom()),{duration:.65});
  };

  return <div className="customer-delivery-map gf-modern-live-map">
    <div className="gf-map-toolbar">
      <span className="gf-map-label">Delivery map · last confirmed GPS</span>
      <button type="button" onClick={locateRider} disabled={!valid(driver)} aria-label="Center map on latest rider location">◎ Locate rider</button>
    </div>
    <div ref={el} className="tm-map" role="img" aria-label="Map showing restaurant, destination and latest rider GPS fix"/>
    <small className="customer-map-note">Marker movement is smoothed between received fixes, not predicted. The dotted line shows straight-line proximity, not a road route. Location and accuracy depend on the rider's phone.</small>
  </div>;
}
