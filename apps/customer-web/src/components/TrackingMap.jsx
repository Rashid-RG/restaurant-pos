import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function emojiIcon(emoji, cls) {
  return L.divIcon({
    className: `tm-icon ${cls}`,
    html: `<div class="tm-emoji">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 32]
  });
}

/**
 * Real live delivery map (OpenStreetMap + Leaflet).
 *  store:  { lat, lng } | null   — restaurant/kitchen
 *  dest:   { lat, lng } | null   — customer delivery pin
 *  driver: { lat, lng } | null   — live GPS from the rider (updates in real time)
 */
export default function TrackingMap({ store, dest, driver }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const routeLine = useRef(null);
  const hasFitted=useRef(false);

  useEffect(() => {
    if (map.current || !el.current) return;
    const center = dest || store || { lat: 6.9271, lng: 79.8612 };
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 200);
    return () => { m.remove(); map.current = null; markers.current = {}; routeLine.current = null;hasFitted.current=false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep markers in sync with props on every render where coords change.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const upsert = (key, point, emoji, cls, label) => {
      if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') {
        if (markers.current[key]) { m.removeLayer(markers.current[key]); delete markers.current[key]; }
        return;
      }
      if (!markers.current[key]) {
        markers.current[key] = L.marker([point.lat, point.lng], { icon: emojiIcon(emoji, cls) }).addTo(m);
        if (label) markers.current[key].bindTooltip(label, { permanent: false, direction: 'top' });
      } else {
        markers.current[key].setLatLng([point.lat, point.lng]);
      }
    };

    upsert('store', store, '🏬', 'tm-store', 'Restaurant');
    upsert('dest', dest, '📍', 'tm-dest', 'Your location');
    upsert('driver', driver, '🛵', 'tm-driver', 'Driver');

    // Dashed straight-line proximity indicator. This is NOT a road route or driving ETA.
    const from = driver || store;
    if (from && dest) {
      const latlngs = [[from.lat, from.lng], [dest.lat, dest.lng]];
      if (!routeLine.current) {
        routeLine.current = L.polyline(latlngs, { color: '#257b54', weight: 3, opacity: 0.65, dashArray: '4,10' }).addTo(m);
      } else {
        routeLine.current.setLatLngs(latlngs);
      }
    } else if (routeLine.current) {
      m.removeLayer(routeLine.current); routeLine.current = null;
    }

    // Fit all known points into view.
    const pts = [store, dest, driver].filter(p => p && typeof p.lat === 'number');
    if (!hasFitted.current && pts.length === 1) {
      m.setView([pts[0].lat, pts[0].lng], 15);hasFitted.current=true;
    } else if (!hasFitted.current && pts.length > 1) {
      m.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.25));hasFitted.current=true;
    }
  }, [store?.lat, store?.lng, dest?.lat, dest?.lng, driver?.lat, driver?.lng]);

  return <div className="customer-delivery-map"><div ref={el} className="tm-map" role="img" aria-label="Map of restaurant, delivery destination and last available driver location"/><small className="customer-map-note">The dotted line shows straight-line proximity, not a navigable road route. Driver location appears only when a recent GPS update is available.</small></div>;
}
