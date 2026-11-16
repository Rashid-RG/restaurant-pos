import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch } from '../utils/api.js';
import {acquireBestLocation} from '../utils/location-acquisition.js';

// Colombo city centre — sensible default before the user picks.
const DEFAULT_CENTER = { lat: 6.9271, lng: 79.8612 };

// A pure-CSS pin so we don't depend on Leaflet's bundled marker PNGs
// (which break under Vite without extra config).
const pinIcon = L.divIcon({
  className: 'lp-pin',
  html: '<div class="lp-pin-dot">📍</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 30]
});

/**
 * Real interactive location picker (OpenStreetMap + Leaflet + Nominatim geocoding).
 * value: { lat, lng, label } | null
 * onChange: ({ lat, lng, label }) => void
 *
 * NOTE: renders NO <form> element — this component is used inside the checkout <form>,
 * and a nested form would make the search button submit the outer order form.
 */
export default function LocationPicker({ value, onChange, toast }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const debounceRef = useRef(null);
  const commitSequenceRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // Reverse-geocode a coordinate and push the result up.
  async function commit(lat, lng, knownLabel) {
    const sequence=++commitSequenceRef.current;
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
    const fallback=knownLabel || `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    // Store the chosen coordinate immediately; geocoding must never block the pin.
    onChange?.({lat,lng,label:fallback});
    if(knownLabel)return;
    try {
      const r=await apiFetch(`/public/reverse-geocode?lat=${lat}&lng=${lng}`);
      if(sequence===commitSequenceRef.current && typeof r?.label==='string' && r.label.trim())
        onChange?.({lat,lng,label:r.label.trim()});
    } catch { /* Keep the real pin when the geocoder is offline. */ }
  }

  function moveMarker(lat, lng, recenter = true) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current.getLatLng();
        commit(p.lat, p.lng);
      });
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
    if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }

  // Initialise the map once.
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const start = value && value.lat ? value : DEFAULT_CENTER;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true })
      .setView([start.lat, start.lng], value && value.lat ? 15 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    map.on('click', (e) => { moveMarker(e.latlng.lat, e.latlng.lng, false); commit(e.latlng.lat, e.latlng.lng); });
    mapRef.current = map;
    if (value && value.lat) moveMarker(value.lat, value.lng, false);
    // Leaflet needs a size recalc when mounted inside a sheet/animated container.
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external value changes (e.g. after "use my location").
  useEffect(() => {
    if (value && value.lat && mapRef.current) moveMarker(value.lat, value.lng, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  // Clean up the debounce timer on unmount.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current);commitSequenceRef.current++; }, []);

  async function runSearch(text) {
    const q = (text ?? query).trim();
    if (q.length < 3) return;
    setSearching(true);
    try {
      const list = await apiFetch(`/public/geocode?q=${encodeURIComponent(q)}`);
      setResults(list || []);
      if ((list || []).length === 0) toast && toast('No matching places found — try a nearby town or landmark.', 'info');
    } catch (err) {
      toast && toast(err.message || 'Search failed.', 'error');
    } finally {
      setSearching(false);
    }
  }

  // Live autocomplete: search a short delay after the user stops typing (Uber/PickMe style).
  function onQueryChange(text) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(() => runSearch(text), 450);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();          // never submit the outer checkout form
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runSearch();
    }
  }

  function pickResult(r) {
    setResults([]);
    setQuery(r.label);
    moveMarker(r.lat, r.lng, true);
    commit(r.lat, r.lng, r.label);
  }

  async function useMyLocation() {
    if (!window.isSecureContext) {
      toast?.('Device location requires HTTPS. Search your address or select a map pin.','warning');
      return;
    }
    setLocating(true);
    try {
      const fix=await acquireBestLocation();
      moveMarker(fix.lat,fix.lng,true);
      await commit(fix.lat,fix.lng);
      toast?.(`Location accuracy approximately ${fix.accuracy} metres. Verify the pin before placing an order.`,'info');
    } catch(error) {
      toast?.(error.message || 'Location unavailable. Use address search or the map pin.','warning');
    } finally {setLocating(false);}
  }

  return (
    <div className="location-picker">
      <div className="lp-search-row">
        <input
          className="form-control"
          type="text"
          inputMode="search"
          placeholder="Search address, road or town (e.g. Anuradhapura Road, Galgamuwa)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn-outline lp-btn" onClick={() => runSearch()} disabled={searching} title="Search">
          {searching ? '…' : '🔍'}
        </button>
        <button type="button" className="btn btn-outline lp-btn" onClick={useMyLocation} disabled={locating} title="Use my current location">
          {locating ? '…' : '📡'}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="lp-results">
          {results.map((r, i) => (
            <li key={i} onClick={() => pickResult(r)}>📍 {r.label}</li>
          ))}
        </ul>
      )}

      <div ref={mapEl} className="lp-map" />

      <div className="lp-hint">
        {value && value.label
          ? <>📍 <strong>{value.label}</strong></>
          : 'Type to search, tap a result, drag the pin, tap the map, or use 📡 for your current location.'}
      </div>
    </div>
  );
}
