import React, {useEffect, useRef, useState} from 'react';
import LiveMapControls from '../../../shared/ui/LiveMapControls.jsx';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const validPoint = point => Array.isArray(point) && point.length >= 2 &&
  Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
  Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const fixPoint = fix => fix && validPoint([Number(fix.lng), Number(fix.lat)])
  ? [Number(fix.lng), Number(fix.lat)] : null;
// UI-only marker; GPS coordinates continue to come exclusively from the device.
const markerElement=(emoji,label,background)=>{
  const outer=document.createElement('div');
  outer.setAttribute('role','img');outer.setAttribute('aria-label',label);
  outer.style.cssText='width:46px;height:46px;display:grid;place-items:center;border:3px solid white;border-radius:18px;box-shadow:0 7px 20px rgba(5,44,32,.28);font-size:23px;line-height:1;';
  outer.style.background=background;
  outer.textContent=emoji;
  return outer;
};
const routeFeature = geometry => {
  if (!geometry || geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
      geometry.coordinates.length > 10000 || !geometry.coordinates.every(validPoint)) return null;
  return {type: 'Feature', properties: {}, geometry};
};

export default function DeliveryMap({destination, fix, geometry, pickup, locationLabel, sharingConfirmed}) {
  const container = useRef(null);
  const map = useRef(null);
  const destinationMarker = useRef(null);
  const riderMarker = useRef(null);
  const cameraTouched = useRef(false);
  const framedEndpoints = useRef(false);
  const framedRoad = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [following, setFollowing] = useState(false);
  const destinationValid = validPoint(destination);
  const riderPosition = fixPoint(fix);
  const validRoute = routeFeature(geometry);

  useEffect(() => {
    if (!container.current || !destinationValid) return;
    let view;
    try {
      view = new maplibregl.Map({
        container: container.current,
        center: destination,
        zoom: 14,
        style: {
          version: 8,
          sources: {streets: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors'
          }},
          layers: [{id: 'streets', type: 'raster', source: 'streets'}]
        }
      });
      map.current = view;
      destinationMarker.current = new maplibregl.Marker({element:markerElement(pickup?'🏬':'📍',pickup?'Restaurant pickup':'Customer destination','#fff1ec'),anchor:'bottom'})
        .setLngLat(destination).setPopup(new maplibregl.Popup().setText(pickup?'Restaurant pickup':'Customer drop-off')).addTo(view);
      view.addControl(new maplibregl.NavigationControl({showCompass: true}), 'bottom-left');
      view.on('load', () => {setReady(true); setFailed(false);});
      // Manual navigation always takes priority over camera follow mode.
      const manualMove = event => {
        if(event.originalEvent){cameraTouched.current=true;setFollowing(false);}
      };
      view.on('movestart',manualMove);
      // MapLibre's canvas needs an explicit resize when the trip panel moves.
      const resize=()=>{if(map.current===view)view.resize();};
      const observer=typeof ResizeObserver!=='undefined'
        ? new ResizeObserver(resize) : null;
      observer?.observe(container.current);
      window.addEventListener('resize',resize);
      const onVisible=()=>{if(document.visibilityState==='visible')resize();};
      document.addEventListener('visibilitychange',onVisible);
      view.__gfDisposeResize=()=>{
        observer?.disconnect();
        window.removeEventListener('resize',resize);
        document.removeEventListener('visibilitychange',onVisible);
      };
      view.on('error', event => {if (event?.error) console.warn('Delivery map tile or style error:', event.error.message);});
    } catch {
      setFailed(true);
    }
    return () => {
      view?.__gfDisposeResize?.();
      view?.remove();
      map.current = null;
      destinationMarker.current = null;
      riderMarker.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (ready && destinationValid) destinationMarker.current?.setLngLat(destination);
  }, [ready, destination?.[0], destination?.[1]]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    if (!riderPosition) {
      riderMarker.current?.remove();
      riderMarker.current = null;
      setFollowing(false);
      return;
    }
    if (!riderMarker.current) {
      riderMarker.current = new maplibregl.Marker({element:markerElement('🛵','Current rider location','#e4f9eb'),anchor:'bottom'})
        .setLngLat(riderPosition)
        .setPopup(new maplibregl.Popup().setText('Your latest reported location'))
        .addTo(view);
    } else riderMarker.current.setLngLat(riderPosition);
    if (following) view.easeTo({center: riderPosition, duration: 350});
  }, [ready, riderPosition?.[0], riderPosition?.[1], following]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    const direct = riderPosition && destinationValid ? {type:'Feature', properties:{}, geometry:{type:'LineString',coordinates:[riderPosition,destination]}} : null;
    const data = {type:'FeatureCollection',features: validRoute ? [validRoute] : []};
    const directData = {type:'FeatureCollection',features: !validRoute && direct ? [direct] : []};
    const fallback = view.getSource('direct');
    if(fallback)fallback.setData(directData);
    else {
      view.addSource('direct',{type:'geojson',data:directData});
      view.addLayer({id:'direct',type:'line',source:'direct',paint:{'line-width':3,'line-color':'#087653','line-dasharray':[1,3]}});
    }
    const source = view.getSource('road');
    if (source) source.setData(data);
    else {
      view.addSource('road', {type: 'geojson', data});
      view.addLayer({id: 'road', type: 'line', source: 'road',
        paint: {'line-width': 6, 'line-color': '#087653', 'line-opacity': 0.94}});
    }
    if (validRoute && !cameraTouched.current && !framedRoad.current) {
      framedRoad.current=true;
      const bounds = new maplibregl.LngLatBounds();
      validRoute.geometry.coordinates.forEach(point => bounds.extend(point));
      view.fitBounds(bounds, {padding: 48, maxZoom: 16, duration: 0});
    }
    if(!validRoute && direct && !cameraTouched.current && !framedEndpoints.current){
      framedEndpoints.current=true;
      view.fitBounds(new maplibregl.LngLatBounds(destination,riderPosition),{padding:48,maxZoom:16,duration:0});
    }
  }, [ready, geometry, riderPosition?.[0], riderPosition?.[1], destination?.[0], destination?.[1]]);

  const centerOnRider = follow => {
    if (!riderPosition || !map.current) return;
    cameraTouched.current=true;
    setFollowing(follow);
    map.current.easeTo({center: riderPosition, zoom: Math.max(map.current.getZoom(), 15), duration: 300});
  };
  const showWholeRoute = () => {
    if (!map.current || !destinationValid) return;
    setFollowing(false);
    cameraTouched.current=true;
    const bounds = new maplibregl.LngLatBounds(destination, destination);
    if (riderPosition) bounds.extend(riderPosition);
    if (validRoute) validRoute.geometry.coordinates.forEach(point => bounds.extend(point));
    map.current.fitBounds(bounds, {padding: 48, maxZoom: 16, duration: 350});
  };

  if (!destinationValid) return <p role="status">Destination pin is unavailable. Confirm the address before navigating.</p>;
  return <section aria-label="Delivery navigation" style={{position:'relative',borderRadius:22,overflow:'hidden',background:'#eff7f3',boxShadow:'0 12px 35px rgba(0,0,0,.16)'}}>
    <div ref={container} aria-label="Delivery navigation map" style={{height:failed?0:'min(54vh,490px)',minHeight:failed?0:330,width:'100%'}}/>
    {!failed && <div style={{position:'absolute',top:12,left:12,right:74,pointerEvents:'none',zIndex:2}}>
      <span role="status" style={{display:'inline-flex',alignItems:'center',gap:8,borderRadius:16,padding:'10px 12px',background:'rgba(255,255,255,.96)',color:'#164638',fontWeight:800,fontSize:12,boxShadow:'0 6px 20px rgba(0,0,0,.12)'}}>
        <span aria-hidden="true" style={{height:8,width:8,borderRadius:'50%',background:sharingConfirmed?'#149667':'#e6a23c'}}/>
        {locationLabel}
      </span>
    </div>}
    {!failed && <LiveMapControls ready={ready} hasFix={Boolean(riderPosition)} following={following}
      onCenter={()=>centerOnRider(false)} onFollow={()=>following?setFollowing(false):centerOnRider(true)} onOverview={showWholeRoute}/>}
    {failed && <p role="alert" style={{padding:18}}>Map unavailable on this device. Use external navigation.</p>}
    <div style={{padding:'11px 14px',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',color:'#1b5241',fontSize:12,fontWeight:750}}>
      <span>Delivery route</span><span>{validRoute?'Road travel · no live traffic':riderPosition?'Road route unavailable · direct line':'Waiting for rider GPS'}</span>
    </div>
  </section>;
}
