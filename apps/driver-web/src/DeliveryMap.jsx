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
        paint: {'line-width': 5, 'line-color': '#2369c9', 'line-opacity': 0.88}});
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
  return <section aria-label="Delivery navigation">
    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8}}>
      <button type="button" onClick={centerOnRider} disabled={!ready || !riderPosition}
        aria-pressed={following}>Follow my location</button>
      <button type="button" onClick={showWholeRoute} disabled={!ready}>Show whole route</button>
      <small role="status">{!riderPosition ? 'GPS unavailable or stale' :
        !validRoute ? 'Road route unavailable — map pins only' : 'Road route shown · not live traffic'}</small>
    </div>
    {failed && <p role="alert">Map unavailable on this device. Use the external navigation link.</p>}
    <div ref={container} aria-label="Delivery navigation map" style={{height: failed ? 0 : 300, borderRadius: 12, overflow: 'hidden'}}/>
  </section>;
}
