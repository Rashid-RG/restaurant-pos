import React from 'react';
import './feature-icons.css';

// Decorative motion accompanies visible status text; the server remains the
// source of order state. No external animation assets or network calls.
export function AnimatedFeatureIcon({ kind = 'cooking', size = 42, active = true, className = '' }) {
  return <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`feature-icon feature-icon-${kind} ${active ? 'feature-icon-active' : ''} ${className}`}>
    {kind === 'cooking' ? <>
      <path className="feature-steam feature-steam-one" d="M22 23c-7-7 6-9 0-16"/><path className="feature-steam feature-steam-two" d="M33 21c-7-7 6-9 0-16"/><path className="feature-steam feature-steam-three" d="M44 23c-7-7 6-9 0-16"/>
      <g className="feature-pot"><path d="M13 31h38l-3 17c-.5 4-4 6-8 6H24c-4 0-7.5-2-8-6z" fill="currentColor" fillOpacity=".09"/><path d="M17 38H9v-7m38 7h8v-7M11 29h42M25 54v4m14-4v4"/><path className="feature-spoon" d="m37 30 9-14"/></g>
      <path className="feature-flame" d="M29 58c-3-3 3-5 3-9 6 5 7 9 0 12" stroke="#d69139"/>
    </> : kind === 'delivery' ? <g className="feature-rider"><circle cx="17" cy="48" r="8"/><circle cx="49" cy="48" r="8"/><path d="M17 48 28 29l12 19H17m23 0 5-24h7M27 29h12M37 18h-8"/><path d="M8 26h10M5 33h10" className="feature-speed"/></g> : kind === 'ready' ? <><path d="M10 45h44M15 43a17 17 0 0 1 34 0M28 23h8M32 23v-4"/><path className="feature-check" d="m23 53 6 5 12-11"/></> : <><path d="M18 8h28v48l-7-4-7 4-7-4-7 4z" fill="currentColor" fillOpacity=".07"/><path d="M25 20h14m-14 8h14m-14 8h8"/><path className="feature-check" d="m26 43 4 4 9-9"/></>}
  </svg>;
}
export function CookingIcon(props) { return <AnimatedFeatureIcon {...props} kind="cooking"/>; }
