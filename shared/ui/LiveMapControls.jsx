import React from 'react';
import { LocateFixed, Navigation, Route } from 'lucide-react';
import './live-map-controls.css';

export default function LiveMapControls({hasFix, following, onFollow, onCenter, onOverview, ready = true}) {
  return <div className="gf-camera-controls" role="group" aria-label="Map camera">
    <button type="button" disabled={!ready || !hasFix} onClick={onCenter} title="Recenter" aria-label="Recenter on rider"><LocateFixed size={20}/></button>
    <button type="button" disabled={!ready || !hasFix} onClick={onFollow} aria-pressed={following && hasFix} title="Follow rider" aria-label="Follow rider"><Navigation size={20}/></button>
    <button type="button" disabled={!ready} onClick={onOverview} title="Route overview" aria-label="Show entire delivery route"><Route size={20}/></button>
  </div>;
}
