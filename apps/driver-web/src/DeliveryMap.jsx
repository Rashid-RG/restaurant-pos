import React, {useEffect, useRef, useState} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const validPoint = point => Array.isArray(point) && point.length >= 2 &&
  Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
  Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const fixPoint = fix => fix && validPoint([Number(fix.lng), Number(fix.lat)])
  ? [Number(fix.lng), Number(fix.lat)] : null;
const routeFeature = geometry => {
  if (!geometry || geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
      geometry.coordinates.length > 10000 || !geometry.coordinates.every(validPoint)) return null;
  return {type: 'Feature', properties: {}, geometry};
};

export default function DeliveryMap({destination, fix, geometry}) {
  const container = useRef(null);
  const map = useRef(null);
  const destinationMarker = useRef(null);
  const riderMarker = useRef(null);
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
      destinationMarker.current = new maplibregl.Marker({color: '#b3443b'})
        .setLngLat(destination).setPopup(new maplibregl.Popup().setText('Destination')).addTo(view);
      view.addControl(new maplibregl.NavigationControl({showCompass: true}), 'top-right');
      view.on('load', () => {setReady(true); setFailed(false);});
      view.on('error', event => {if (event?.error) console.warn('Delivery map tile or style error:', event.error.message);});
    } catch {
      setFailed(true);
    }
    return () => {
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
      riderMarker.current = new maplibregl.Marker({color: '#087b61'})
        .setLngLat(riderPosition)
        .setPopup(new maplibregl.Popup().setText('Your latest reported location'))
        .addTo(view);
    } else riderMarker.current.setLngLat(riderPosition);
    if (following) view.easeTo({center: riderPosition, duration: 350});
  }, [ready, riderPosition?.[0], riderPosition?.[1], following]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    const data = {type: 'FeatureCollection', features: validRoute ? [validRoute] : []};
    const source = view.getSource('road');
    if (source) source.setData(data);
    else {
      view.addSource('road', {type: 'geojson', data});
      view.addLayer({id: 'road', type: 'line', source: 'road',
        paint: {'line-width': 6, 'line-color': '#087653', 'line-opacity': 0.94}});
    }
    if (validRoute && !following) {
      const bounds = new maplibregl.LngLatBounds();
      validRoute.geometry.coordinates.forEach(point => bounds.extend(point));
      view.fitBounds(bounds, {padding: 48, maxZoom: 16, duration: 0});
    }
  }, [ready, geometry, following]);

  const centerOnRider = () => {
    if (!riderPosition || !map.current) return;
    setFollowing(true);
    map.current.easeTo({center: riderPosition, zoom: Math.max(map.current.getZoom(), 15), duration: 300});
  };
  const showWholeRoute = () => {
    if (!map.current || !destinationValid) return;
    setFollowing(false);
    const bounds = new maplibregl.LngLatBounds(destination, destination);
    if (riderPosition) bounds.extend(riderPosition);
    if (validRoute) validRoute.geometry.coordinates.forEach(point => bounds.extend(point));
    map.current.fitBounds(bounds, {padding: 48, maxZoom: 16, duration: 350});
  };

  if (!destinationValid) return <p role="status">Destination pin is unavailable. Confirm the address before navigating.</p>;
  return <section aria-label="Delivery navigation" style={{position:'relative',borderRadius:22,overflow:'hidden',background:'#eff7f3',boxShadow:'0 12px 35px rgba(0,0,0,.16)'}}>
    <div ref={container} aria-label="Delivery navigation map" style={{height:failed?0:'min(54vh,490px)',minHeight:failed?0:330,width:'100%'}}/>
    <div style={{position:'absolute',top:12,left:12,right:74,pointerEvents:'none',zIndex:2}}>
      <span role="status" style={{display:'inline-flex',alignItems:'center',gap:8,borderRadius:16,padding:'10px 12px',background:'rgba(255,255,255,.96)',color:'#164638',fontWeight:800,fontSize:12,boxShadow:'0 6px 20px rgba(0,0,0,.12)'}}>
        <span aria-hidden="true" style={{height:8,width:8,borderRadius:'50%',background:riderPosition?'#149667':'#e6a23c'}}/>
        {!riderPosition?'Waiting for fresh GPS':!validRoute?'GPS available · road route unavailable':'Confirmed GPS · road route shown'}
      </span>
    </div>
    <div style={{position:'absolute',right:12,top:102,display:'grid',gap:9,zIndex:3}}>
      <button type="button" onClick={centerOnRider} disabled={!ready||!riderPosition} aria-pressed={following}
        aria-label={following?'Following my location':'Follow my location'}
        style={{background:following?'#087653':'white',color:following?'white':'#154b3e',border:0,borderRadius:15,padding:'13px 14px',fontSize:18,fontWeight:900,opacity:riderPosition?1:.5,boxShadow:'0 5px 17px rgba(0,0,0,.15)'}}>◎</button>
      <button type="button" onClick={showWholeRoute} disabled={!ready} aria-label="Show whole route"
        style={{background:'white',color:'#154b3e',border:0,borderRadius:15,padding:'13px 14px',fontSize:18,fontWeight:900,boxShadow:'0 5px 17px rgba(0,0,0,.15)'}}>⌖</button>
    </div>
    {failed && <p role="alert" style={{padding:18}}>Map unavailable on this device. Use external navigation.</p>}
    <div style={{padding:'11px 14px',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',color:'#1b5241',fontSize:12,fontWeight:750}}>
      <span>Delivery route</span><span>{validRoute?'Road travel · no live traffic':'Navigation route unavailable'}</span>
    </div>
  </section>;
}
