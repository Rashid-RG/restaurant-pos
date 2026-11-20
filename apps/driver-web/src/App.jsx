import { AnimatedFeatureIcon } from '../../../shared/ui/AnimatedFeatureIcon.jsx';
import { Bike } from 'lucide-react';
import ProofOfDeliveryModal, { DeliveryProofViewer } from './ProofOfDeliveryModal.jsx';
import { ConnectionStatus } from '../../../shared/ui/Resilience.jsx';
import React, { useState, useEffect, useRef } from 'react';
import SystemUpdatePrompt from '../../customer-web/src/components/SystemUpdatePrompt.jsx';
import {shouldSendDriverFix} from './utils/gps-transmission.js';
import {Capacitor,CapacitorHttp,registerPlugin} from '@capacitor/core';
import {createNativeTrackingSession} from '../../driver-native/src/background-tracker.js';
import {createDispatchRequestGate,createDispatchTimeout,latestDispatchTickets} from './utils/dispatch-sync.js';


// ── Auth token storage ──
const TOKEN_KEY = 'gastrodriver_token';
const DRIVER_KEY = 'gastrodriver_profile';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

// API helper — attaches the driver JWT so the server can identify + tenant-scope the rider.
const apiFetch = async (url, opts = {}) => {
  const token = getToken();
  const nativeOrigin=import.meta.env.MODE==='native' ? import.meta.env.VITE_DRIVER_NATIVE_API_URL : null;
  if(import.meta.env.MODE==='native' &&
     (!nativeOrigin || !/^https:\/\/[a-z0-9.-]+(?::443)?\/?$/i.test(nativeOrigin)))
    throw new Error('Native driver API origin is not configured securely.');
  const base=nativeOrigin ? nativeOrigin.replace(/\/$/,'') : '';
  const res = await fetch(`${base}/api${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((new URLSearchParams(location.search).get('tenant') || new URLSearchParams(location.search).get('tenantId') || sessionStorage.getItem('gastrodriver_selected_tenant')) ? { 'X-Tenant-Id': new URLSearchParams(location.search).get('tenant') || new URLSearchParams(location.search).get('tenantId') || sessionStorage.getItem('gastrodriver_selected_tenant') } : {}),
      ...((new URLSearchParams(location.search).get('invite') || sessionStorage.getItem('gastrodriver_hiring_invite')) ? {'X-Driver-Invitation':new URLSearchParams(location.search).get('invite') || sessionStorage.getItem('gastrodriver_hiring_invite')} : {}),
      ...opts.headers
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

// ── Haversine distance helper (km) ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// ── Sri Lanka store coords default (Colombo) ──
const STORE_LAT = 6.9271;
const STORE_LNG = 79.8612;

function isRushHour(timeZone = 'Asia/Colombo') {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
}

export default function App() {
  const [driver, setDriver] = useState(JSON.parse(localStorage.getItem(DRIVER_KEY) || 'null'));
  const driverStatusRef=useRef(null);
  driverStatusRef.current=driver?.status||null;
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [restaurantTimeZone, setRestaurantTimeZone] = useState('Asia/Colombo');
  const [activeOrders, setActiveOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState({ completedToday: 0, cashToHandover: 0 });
  const [taskTab, setTaskTab] = useState('active');
  const [availableOrders, setAvailableOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const nativeTrackingRef=useRef(null);
  const nativeDriverBuild=import.meta.env.MODE==='native' && Capacitor.isNativePlatform();
  const [lastCoords, setLastCoords] = useState(null);
  const [gpsQuality, setGpsQuality] = useState('not_started');
  const [discoveryConsent,setDiscoveryConsent]=useState(false);
  const discoveryConsentRef=useRef(false);
  const lastPresenceSentRef=useRef(null);
  // Never advertise idle-rider location unless both pilot and explicit consent are enabled.
  const discoveryPilotEnabled=import.meta.env.VITE_RIDER_PRESENCE_PILOT==='true';
  const lastBroadcastRef = useRef(null);
  const lastFixRef = useRef(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [selectedDeliveryOrder, setSelectedDeliveryOrder] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);

  // Bug 1 fix: ref always holds current activeOrders so GPS watchPosition
  // callback (registered once) never reads a stale closure value.
  const activeOrdersRef = useRef([]);
  useEffect(() => { activeOrdersRef.current = activeOrders; }, [activeOrders]);

  // Bug 3 fix: ref instead of state so polling interval always reads
  // the latest count without a stale closure.
  const prevUnassignedCountRef = useRef(0);
  const dispatchGateRef=useRef(createDispatchRequestGate());
  const dispatchAbortRef=useRef(null);
  const [dispatchLastSynced,setDispatchLastSynced]=useState(null);
  const [dispatchSyncError,setDispatchSyncError]=useState(false);
  const [driverClock,setDriverClock]=useState(Date.now());
  useEffect(()=>{const i=setInterval(()=>setDriverClock(Date.now()),10000);return()=>clearInterval(i);},[]);

  // Bug 6 fix: store the toast auto-dismiss timer so it can be cancelled.
  const toastTimerRef = useRef(null);

  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Registration modal
  const [showRegModal, setShowRegModal] = useState(false);
  const [reg, setReg] = useState({ name: '', phone: '', email: '', verificationCode: '', password: '', vehicleType: 'Motorbike', plateNumber: '', privacyAccepted: false, identityConsent: false });
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [identityVerificationLink,setIdentityVerificationLink] = useState('');
  const [licenceVerificationLink,setLicenceVerificationLink] = useState('');
  const [selectedHiringRestaurant,setSelectedHiringRestaurant]=useState(null);
  const [hiringSearch,setHiringSearch]=useState('');
  const [hiringResults,setHiringResults]=useState([]);
  const [hiringBusy,setHiringBusy]=useState(false);
  const [invitationEntry,setInvitationEntry]=useState('');
  const [hiringMode,setHiringMode]=useState('search');
  const [hiringError,setHiringError]=useState('');
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [recoveryEmail,setRecoveryEmail]=useState('');
  const [recoveryCode,setRecoveryCode]=useState('');
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const [recoveryCodeSent,setRecoveryCodeSent]=useState(false);
  const [manualApplicationToken,setManualApplicationToken]=useState(sessionStorage.getItem('gastrodriver_manual_application')||'');
  const [manualEvidence,setManualEvidence]=useState({});
  const [selfieCandidate,setSelfieCandidate]=useState(null);
  const [manualUploading,setManualUploading]=useState('');
  const [manualConsent,setManualConsent]=useState(false);
  const [manualVehicleType,setManualVehicleType]=useState('Motorbike');
  const [sendingRegCode, setSendingRegCode] = useState(false);
  const [regCodeSentTo, setRegCodeSentTo] = useState('');

  // Bug 6 fix: cancel pending timer before setting a new one to prevent
  // setState-on-unmounted-component warnings and stale toast flashes.
  const showToast = (text, type = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ text, type });
    toastTimerRef.current = setTimeout(() => { setToastMsg(null); toastTimerRef.current = null; }, 3500);
  };

  // ── Auth ──
  const handleLogin = async (e) => {
    e.preventDefault();
    if(!selectedHiringRestaurant?.id){showToast('Choose your restaurant first.','warning');return;}
    if (!loginPhone || !loginPassword) { showToast('Enter your phone and password', 'warning'); return; }
    setLoggingIn(true);
    try {
      const res = await apiFetch('/driver/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone: loginPhone, password: loginPassword })
      });
      localStorage.setItem(TOKEN_KEY, res.token);
      // Bug 2 fix: only persist known safe fields — do not store raw server
      // response which may contain sensitive or unexpected keys.
      const { id, name, phone, vehicleType, plateNumber, status } = res.driver;
      const safeProfile = { id, name, phone, vehicleType, plateNumber, status };
      localStorage.setItem(DRIVER_KEY, JSON.stringify(safeProfile));
      setDriver(safeProfile);
      setLoginPassword('');
      showToast(`Welcome, ${res.driver.name}! 🛵`, 'success');
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if(nativeTrackingRef.current)await nativeTrackingRef.current.stop().catch(()=>{});
    nativeTrackingRef.current=null;
    if(discoveryPilotEnabled)await apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setIsGpsActive(false);
    setWatchId(null);
    setGpsQuality('not_started');
    lastBroadcastRef.current = null;
    lastFixRef.current = null;
    setDriver(null);
    // Bug 4 fix: clear order state so the next driver to log in on the
    // same device does not briefly see the previous driver's orders.
    setActiveOrders([]);
    setAvailableOrders([]);
    activeOrdersRef.current = [];
    prevUnassignedCountRef.current = 0;
    dispatchAbortRef.current?.cancel();dispatchAbortRef.current=null;
    dispatchGateRef.current.invalidate();
    setDispatchLastSynced(null);setDispatchSyncError(false);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DRIVER_KEY);
  };

  const updateAvailability = async () => {
    if (!driver || availabilityLoading) return;
    setAvailabilityLoading(true);
    try {
      const next = driver.status === 'offline' ? 'online' : 'offline';
      const response = await apiFetch('/public/driver/availability', { method:'POST', body:JSON.stringify({ availability: next }) });
      setDriver(previous => {
        const updated={ ...previous, status:response.status };
        localStorage.setItem(DRIVER_KEY,JSON.stringify(updated));
        return updated;
      });
      if(next==='offline'){
        if(nativeTrackingRef.current)void nativeTrackingRef.current.stop().catch(()=>{});
        nativeTrackingRef.current=null;
        setIsGpsActive(false);setGpsQuality('off');
        discoveryConsentRef.current=false;setDiscoveryConsent(false);
        lastPresenceSentRef.current=null;
        if(discoveryPilotEnabled)void apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
      }
      showToast(next==='online'?'Ready for new deliveries.':'You are offline for new deliveries.', 'success');
      fetchDriverOrders();
    } catch (error) { showToast(error.message || 'Could not update availability.', 'error'); }
    finally { setAvailabilityLoading(false); }
  };

  // ── High-Professional Driver Delivery Ringtone Alert ──
  const playDriverAlertRingtone = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [
        { freq: 783.99, time: 0, duration: 0.15 },    // G5
        { freq: 1046.50, time: 0.12, duration: 0.15 }, // C6
        { freq: 1318.51, time: 0.25, duration: 0.35 }  // E6
      ];

      [0, 0.5, 1.0].forEach((offset) => {
        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + offset + time);
          gain.gain.setValueAtTime(0.001, ctx.currentTime + offset + time);
          gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + offset + time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + time + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + offset + time);
          osc.stop(ctx.currentTime + offset + time + duration);
        });
      });
    } catch (_) {}
  };

  const [prevUnassignedCount, setPrevUnassignedCount] = useState(0);

  // ── Orders ──
  const fetchDriverOrders = async () => {
    if (!driver) return;
    const gate=dispatchGateRef.current;
    const request=gate.start();
    if(request===null)return;
    const timeout=createDispatchTimeout(12000);
    dispatchAbortRef.current=timeout;
    setLoading(true);
    try {
      const data = await apiFetch('/public/driver/orders',{signal:timeout.signal});
      if(!gate.isCurrent(request))return;
      const tickets=latestDispatchTickets(data);
      const newUnassigned=tickets.unassigned;
      const newAssigned=tickets.assigned;

      // Bug 3 fix: compare against ref (always current) not a stale state closure.
      // prevUnassignedCountRef.current is updated immediately after comparison
      // so every polling cycle sees the real previous value.
      if (newUnassigned.length > prevUnassignedCountRef.current && prevUnassignedCountRef.current > 0) {
        playDriverAlertRingtone();
        showToast('🔔 New Delivery Ticket Available!', 'info');
      }
      prevUnassignedCountRef.current = newUnassigned.length;

      setActiveOrders(newAssigned);
      setHistory(tickets.completed);
      setDispatchLastSynced(Date.now());setDispatchSyncError(false);
      setSummary(data.summary || { completedToday: 0, cashToHandover: 0 });
      if (data.timeZone) setRestaurantTimeZone(data.timeZone);
      setAvailableOrders(newUnassigned);
    } catch (err) {
      if(!gate.isCurrent(request))return;
      if (/token/i.test(err.message)) { handleLogout(); showToast('Session expired — please sign in again', 'warning'); }
      else setDispatchSyncError(true); // Preserve last confirmed tickets on a transient outage.
    } finally {
      timeout.finish();
      if(dispatchAbortRef.current===timeout)dispatchAbortRef.current=null;
      if(gate.isCurrent(request)){setLoading(false);gate.finish(request);}
    }
  };

  useEffect(() => {
    if (driver) {
      fetchDriverOrders();
      const interval = setInterval(fetchDriverOrders, 8000);
      const onResume=()=>{if(document.visibilityState==='visible')fetchDriverOrders();};
      const onOnline=()=>fetchDriverOrders();
      document.addEventListener('visibilitychange',onResume);
      window.addEventListener('online',onOnline);
      return () => {clearInterval(interval);document.removeEventListener('visibilitychange',onResume);window.removeEventListener('online',onOnline);dispatchAbortRef.current?.cancel();dispatchAbortRef.current=null;dispatchGateRef.current.invalidate();};
    }
  }, [driver?.id]);

  // Explicit opt-in, separate from location sharing for assigned deliveries.
  const toggleDiscoveryConsent = () => {
    if(!discoveryPilotEnabled)return;
    const next=!discoveryConsentRef.current;
    discoveryConsentRef.current=next;setDiscoveryConsent(next);
    nativeTrackingRef.current?.setDiscoveryEnabled(next);
    lastPresenceSentRef.current=null;
    if(!next)void apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
    else if(!isGpsActive){discoveryConsentRef.current=false;setDiscoveryConsent(false);
      showToast('Enable live location before sharing nearby availability.','warning');}
  };
  // ── GPS ──
  const toggleGps = () => {
    if(nativeDriverBuild){
      if(isGpsActive){
        if(nativeTrackingRef.current)void nativeTrackingRef.current.stop().catch(()=>{});
        nativeTrackingRef.current=null;
        setIsGpsActive(false);setGpsQuality('off');
        discoveryConsentRef.current=false;setDiscoveryConsent(false);
        return;
      }
      if(driverStatusRef.current==='offline'){
        showToast('Go online before starting native location tracking.','warning');return;
      }
      try{
        const session=createNativeTrackingSession({
          plugin:registerPlugin('BackgroundGeolocation'),
          httpPost:opts=>CapacitorHttp.post(opts),
          apiOrigin:import.meta.env.VITE_DRIVER_NATIVE_API_URL,
          getToken,getActiveOrders:()=>activeOrdersRef.current,
          onFix:fix=>{setLastCoords(fix);setGpsQuality('good');},
          onStatus:status=>{if(status==='location_error'||status==='upload_error')
            setGpsQuality('weak');}
        });
        nativeTrackingRef.current=session;
        setGpsQuality('searching');
        void session.start({onDuty:true,locationConsent:true,
          discoveryConsent:discoveryPilotEnabled&&discoveryConsentRef.current
        }).then(()=>setIsGpsActive(true)).catch(error=>{
          nativeTrackingRef.current=null;setGpsQuality('denied');
          showToast(error?.message||'Native location permission unavailable.','error');
        });
      }catch(error){
        setGpsQuality('denied');
        showToast(error?.message||'Native GPS is not configured.','error');
      }
      return;
    }
    if (isGpsActive) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setIsGpsActive(false);
      setWatchId(null);
      setGpsQuality('off');
      lastBroadcastRef.current = null;
      lastFixRef.current = null;
      lastPresenceSentRef.current=null;
      discoveryConsentRef.current=false;
      setDiscoveryConsent(false);
      if(discoveryPilotEnabled)void apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
      showToast('Location sharing stopped.', 'info');
      return;
    }
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      showToast('Use HTTPS and enable device location to share a live position.', 'error');
      return;
    }
    setIsGpsActive(true);
    setGpsQuality('searching');
    showToast('Searching for a reliable device location…', 'info');
    const id = navigator.geolocation.watchPosition((pos) => {
      // The OS normally fuses GPS, mobile signals, Wi-Fi and phone sensors.
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const accuracyMeters = pos.coords.accuracy;
      const recordedAt = pos.timestamp;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          !Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 150 ||
          !Number.isFinite(recordedAt) || Date.now() - recordedAt > 30000 ||
          recordedAt > Date.now() + 10000) {
        setGpsQuality('weak');
        return; // Never advertise a poor or stale fix as live.
      }
      const coords = { lat, lng, accuracyMeters, recordedAt };
      if (lastFixRef.current && recordedAt <= lastFixRef.current.recordedAt) return;
      lastFixRef.current = coords;
      setLastCoords(coords);
      setGpsQuality('good');
      if(discoveryPilotEnabled&&discoveryConsentRef.current&&
         ['available','active'].includes(String(driverStatusRef.current||'').toLowerCase())&&
         shouldSendDriverFix(coords,lastPresenceSentRef.current)){
        lastPresenceSentRef.current={...coords,sentAt:Date.now()};
        apiFetch('/public/driver/on-duty-location',{
          method:'POST',body:JSON.stringify({...coords,consent:true})
        }).catch(()=>{
          // Do not show an unverifiable rider as discoverable after failure.
          discoveryConsentRef.current=false;setDiscoveryConsent(false);
          void apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
          showToast('Nearby rider sharing stopped. Check your verification or connection.','warning');
        });
      }
      // Adaptive movement-based sends with heartbeat while stationary.
      // Never upload GPS unless an active delivery is assigned.
      const assigned=activeOrdersRef.current.filter(order => order?.id && !['delivered','completed','cancelled','rejected'].includes(String(order.status||'').toLowerCase()));
      if (!assigned.length || !shouldSendDriverFix(coords,lastBroadcastRef.current)) return;
      lastBroadcastRef.current={...coords,sentAt:Date.now()};
      assigned.forEach(order => {
        apiFetch('/public/driver/location', {
          method: 'POST',
          body: JSON.stringify({ orderId: order.id, ...coords })
        }).catch(err => {
          if (/location|accuracy|jump|fix/i.test(err.message || '')) setGpsQuality('weak');
          // A later new fix can be retried; don't replay stale GPS.
        });
      });
    }, err => {
      setGpsQuality(err?.code === 1 ? 'denied' : 'weak');
      showToast(err?.code === 1 ? 'Location permission denied. Enable it in device settings.' :
        'Location signal weak. Keep the app visible and move to a clearer area.', 'warning');
    }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
    setWatchId(id);
  };

  const handleClaim = async (orderId) => {
    try {
      await apiFetch('/public/driver/assign', { method: 'POST', body: JSON.stringify({ orderId }) });
      showToast('Delivery claimed! 🚀', 'success');
      fetchDriverOrders();
    } catch (err) {
      showToast(err.message || 'Failed to claim order', 'error');
    }
  };

  const handleUpdateStatus = async (orderId, newStatus, proof = null) => {
    try {
      const result = await apiFetch('/public/driver/status', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          status: newStatus,
          lat: lastCoords?.lat,
          lng: lastCoords?.lng,
          signature: proof?.signature,
          deliveryPhoto: proof?.photo,
          cashReceived: proof?.cashReceived
        })
      });
      if (newStatus === 'delivered' && !result.proof?.savedAt) throw new Error('No saved proof receipt was returned. Refresh to check this delivery.');
      showToast(newStatus === 'delivered' ? 'Delivery completed. Proof saved.' : 'Delivery status updated.', 'success');
      fetchDriverOrders();
    } catch (err) {
      if (newStatus === 'delivered') throw err;
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  const resolveRestaurantSelection=async(query)=>{
    setHiringError('');
    try{
      const result=await apiFetch('/public/drivers/restaurant'+query);
      if(!result.restaurant?.id)throw new Error('Restaurant not found.');
      const selected=result.restaurant;
      const prior=sessionStorage.getItem('gastrodriver_selected_tenant');
      if(prior && prior!==selected.id){
        setRegCodeSentTo('');
        setReg(previous=>({...previous,verificationCode:''}));
        // Never allow a pending evidence token for a different restaurant
        // to silently carry over when changing restaurants.
        sessionStorage.removeItem('gastrodriver_manual_application');
        setManualApplicationToken('');
        setManualEvidence({});
      }
      sessionStorage.setItem('gastrodriver_selected_tenant',selected.id);
      setSelectedHiringRestaurant(selected);
      setHiringResults([]);
      setHiringSearch('');
      const params=new URLSearchParams(window.location.search);
      params.set('tenant',selected.id);
      params.delete('tenantId');
      const invitation=params.get('invite');
      if(invitation){sessionStorage.setItem('gastrodriver_hiring_invite',invitation);params.delete('invite');}
      else if(prior && prior!==selected.id){sessionStorage.removeItem('gastrodriver_hiring_invite');}
      window.history.replaceState(null,'',window.location.pathname+'?'+params.toString());
      return selected;
    }catch(error){setHiringError(error.message||'Unable to verify restaurant.');return null;}
  };

  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    const invitation=params.get('invite');
    const tenant=params.get('tenant')||params.get('tenantId')||sessionStorage.getItem('gastrodriver_selected_tenant');
    if(invitation){
      setHiringMode('invite');
      void resolveRestaurantSelection('?invite='+encodeURIComponent(invitation));
    }else if(tenant){
      void resolveRestaurantSelection('?tenantId='+encodeURIComponent(tenant));
    }
  },[]);

  useEffect(()=>{
    const q=hiringSearch.trim();
    if(q.length<2){setHiringResults([]);setHiringError('');setHiringBusy(false);return;}
    let ignore=false;
    const timer=setTimeout(async()=>{
      setHiringBusy(true);
      setHiringError('');
      try{
        const response=await apiFetch('/public/drivers/restaurants?q='+encodeURIComponent(q));
        if(!ignore)setHiringResults(Array.isArray(response.restaurants)?response.restaurants:[]);
      }catch(error){
        if(!ignore){
          setHiringResults([]);
          setHiringError('Restaurant search could not load. '+(error.message||'Check your connection and try again.'));
        }
      }finally{if(!ignore)setHiringBusy(false);}
    },320);
    return()=>{ignore=true;clearTimeout(timer);};
  },[hiringSearch]);

  const useInvitation=async()=>{
    const invitation=invitationEntry.trim();
    if(!/^[A-Za-z0-9_-]{24}$/.test(invitation)){
      setHiringError('Enter the full invitation code supplied by the restaurant.');return;
    }
    const params=new URLSearchParams(location.search);
    params.set('invite',invitation);
    params.delete('tenant');params.delete('tenantId');
    window.history.replaceState(null,'',window.location.pathname+'?'+params.toString());
    const selected=await resolveRestaurantSelection('?invite='+encodeURIComponent(invitation));
    if(selected)setInvitationEntry('');
  };
  const resetHiringSelection=()=>{
    sessionStorage.removeItem('gastrodriver_selected_tenant');
    sessionStorage.removeItem('gastrodriver_hiring_invite');
    sessionStorage.removeItem('gastrodriver_manual_application');
    setSelectedHiringRestaurant(null);setManualApplicationToken('');
    setManualEvidence({});setRegCodeSentTo('');
    setReg(previous=>({...previous,verificationCode:''}));
    const params=new URLSearchParams(location.search);
    params.delete('tenant');params.delete('tenantId');params.delete('invite');
    window.history.replaceState(null,'',window.location.pathname+(params.size?'?'+params.toString():''));
  };

  const requestRecoveryCode=async()=>{
    if(!selectedHiringRestaurant?.id){showToast('Choose your restaurant first.','warning');return;}
    if(!recoveryEmail.trim()){showToast('Enter the email used for your application.','warning');return;}
    setRecoveryBusy(true);
    try{
      await apiFetch('/public/drivers/request-email-code',{
        method:'POST',body:JSON.stringify({email:recoveryEmail.trim()})
      });
      setRecoveryCodeSent(true);
      showToast('A fresh application code was sent to your email.','success');
    }catch(error){showToast(error.message,'error');}
    finally{setRecoveryBusy(false);}
  };
  const restorePendingApplication=async()=>{
    if(!selectedHiringRestaurant?.id)return;
    setRecoveryBusy(true);
    try{
      const result=await apiFetch('/public/drivers/recover-application',{
        method:'POST',body:JSON.stringify({email:recoveryEmail.trim(),verificationCode:recoveryCode.trim()})
      });
      sessionStorage.setItem('gastrodriver_manual_application',result.applicationToken);
      setManualApplicationToken(result.applicationToken);
      setManualVehicleType(result.vehicleType);
      setManualEvidence({});
      setManualConsent(false);
      setRecoveryOpen(false);
      setRecoveryCode('');
      showToast('Application restored. Complete your verification evidence.','success');
    }catch(error){showToast(error.message||'Could not restore application.','error');}
    finally{setRecoveryBusy(false);}
  };

  const handleSendRegCode = async () => {
    if (!selectedHiringRestaurant?.id) { showToast('Select your restaurant or enter a valid invitation first.', 'warning'); return; }
    if (!reg.email.trim()) { showToast('Enter your email address first.', 'warning'); return; }
    setSendingRegCode(true);
    try {
      const result = await apiFetch('/public/drivers/request-email-code', { method: 'POST', body: JSON.stringify({email:reg.email.trim()}) });
      setRegCodeSentTo(reg.email.trim().toLowerCase());
      showToast(result.message || 'Verification code sent.', 'success');
    } catch (err) { showToast(err.message || 'Unable to send verification code.', 'error'); }
    finally { setSendingRegCode(false); }
  };

  const handleSelfieCapture = (file) => {
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>2*1024*1024){
      showToast('Selfie must be JPEG, PNG or WebP and under 2 MB.', 'warning');return;
    }
    setSelfieCandidate(previous => {
      if(previous?.url)URL.revokeObjectURL(previous.url);
      return {file,url:URL.createObjectURL(file)};
    });
  };
  const clearSelfieCapture = () => {
    setSelfieCandidate(previous => {
      if(previous?.url)URL.revokeObjectURL(previous.url);
      return null;
    });
  };

  useEffect(() => {
    if(!manualApplicationToken)return;
    let ignore=false;
    apiFetch('/public/drivers/manual-application',{
      headers:{Authorization:'Bearer '+manualApplicationToken}
    }).then(data=>{
      if(ignore)return;
      const accepted=new Set(data.requiredKinds||[]);
      setManualVehicleType(accepted.has('licence_front')?'Motorbike':'Bicycle');
      setManualEvidence(Object.fromEntries((data.documents||[]).map(doc=>[doc.kind,true])));
    }).catch(()=>{});
    return()=>{ignore=true;};
  },[manualApplicationToken]);

  const submitManualEvidence = async (kind,file) => {
    if(!file || !manualApplicationToken)return;
    if(!manualConsent) { showToast('Please accept sensitive-document storage consent first.','warning');return; }
    if(file.size>2*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)){
      showToast('Choose a JPEG, PNG or WebP photo no larger than 2 MB.','warning');return;
    }
    setManualUploading(kind);
    try {
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(new Error('Unable to read selected image.'));
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const uploaded=await apiFetch('/public/drivers/manual-document', {
        method:'POST',
        headers:{Authorization:'Bearer '+manualApplicationToken},
        body:JSON.stringify({kind,contentType:file.type,data,consent:true})
      });
      setManualEvidence(previous=>({...previous,[kind]:true}));
      if(kind==='selfie')clearSelfieCapture();
      showToast(uploaded.message||'Encrypted evidence submitted.','success');
    }catch(error){showToast(error.message||'Evidence upload failed.','error');}
    finally{setManualUploading('');}
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if(!selectedHiringRestaurant?.id){showToast('Confirm the restaurant before registering.','warning');return;}
    if (!reg.name || !reg.phone || !reg.email || !reg.password || !reg.verificationCode) { showToast('Enter your details and the emailed verification code.', 'warning'); return; }
    if (regCodeSentTo !== reg.email.trim().toLowerCase()) { showToast('Request a verification code for this email first.', 'warning'); return; }
    if (reg.password.length < 10) { showToast('Password must be at least 10 characters.', 'warning'); return; }
    if (!reg.privacyAccepted) { showToast('Review and acknowledge the application privacy notice.', 'warning'); return; }
    try {
      setRegSubmitting(true);
      const res = await apiFetch('/public/drivers/register', { method: 'POST', body: JSON.stringify(reg) });
      showToast(res.message || 'Application submitted for restaurant review.', 'success');
      if(res.applicationToken) {
        sessionStorage.setItem('gastrodriver_manual_application',res.applicationToken);
        setManualApplicationToken(res.applicationToken);
        setManualVehicleType(reg.vehicleType);
        setManualEvidence({});
        clearSelfieCapture();
        setManualConsent(false);
      }
      if(res.identityVerificationUrl) setIdentityVerificationLink(res.identityVerificationUrl);
      if(res.licenceVerificationUrl) setLicenceVerificationLink(res.licenceVerificationUrl);
      setShowRegModal(false);
      setRegCodeSentTo('');
      setLoginPhone(reg.phone);
      setReg({ name: '', phone: '', email: '', password: '', vehicleType: 'Motorbike', plateNumber: '', privacyAccepted: false, identityConsent: false });
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setRegSubmitting(false);
    }
  };

  // COD cash the rider still needs to hand over (delivered + cash/COD, not yet collected).
  // Bug 8 fix: only include activeOrders (this driver's assigned orders).
  // availableOrders are unassigned and can never be 'delivered', so including
  // them was a logic error that could produce wrong totals if status semantics change.
  const cashToHandover = Number(summary.cashToHandover || 0);
  const visibleOrders = taskTab === 'history' ? history : activeOrders;

  return (
    <div className="driver-app-shell"><ConnectionStatus/>
      <SystemUpdatePrompt />


      {toastMsg && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 99999,
          background: toastMsg.type === 'error' ? '#ef4444' : toastMsg.type === 'success' ? '#10b981' : toastMsg.type === 'warning' ? '#f59e0b' : '#3b82f6',
          color: '#fff', padding: '10px 20px', borderRadius: 20, fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
        }}>
          {toastMsg.text}
        </div>
      )}

      <header className="driver-header">
        <img src={`${import.meta.env.BASE_URL}driver-logo.svg`} alt="GastroDriver" className="driver-logo-img" />
        <span className="driver-title">GastroDriver</span>
        <ConnectionStatus compact/><span className="driver-badge">DELIVERY PARTNER</span>
      </header>

      <main className="driver-content">
        {!driver ? (
          /* ── Login screen ── */
          <div>
            <div className="driver-login-intro" style={{ textAlign: 'center', margin: '20px 0 24px' }}>
              <div className="driver-welcome-icon"><Bike size={40}/></div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Your next delivery awaits.</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 4 }}>
                Sign in with your registered phone and password
              </p>
            </div>

            <section className="card" aria-label="Select recruiting restaurant" style={{display:'flex',flexDirection:'column',gap:12,padding:18,marginBottom:18,border:'1px solid var(--border-color)',borderRadius:16}}>
              <div style={{display:'flex',gap:9,alignItems:'center',justifyContent:'space-between'}}>
                <div><strong style={{fontSize:15}}>Your restaurant</strong><p style={{margin:'3px 0 0',fontSize:12,color:'var(--text-muted)'}}>One GastroDriver app. Private restaurant-specific application.</p></div>
                <span style={{fontSize:24}} aria-hidden="true">🏪</span>
              </div>
              {selectedHiringRestaurant ? <>
                <div style={{padding:12,background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.3)',borderRadius:12}}>
                  <strong style={{display:'block'}}>{selectedHiringRestaurant.name}</strong>
                  <small style={{color:'var(--text-muted)'}}>Verified restaurant selection · {selectedHiringRestaurant.subdomain}</small>
                </div>
                <button type="button" className="btn-outline" onClick={resetHiringSelection}>Choose a different restaurant</button>
              </> : <>
                <div style={{display:'flex',gap:8}}>
                  <button type="button" className={hiringMode==='search'?'btn-emerald':'btn-outline'} onClick={()=>setHiringMode('search')} style={{flex:1}}>Find restaurant</button>
                  <button type="button" className={hiringMode==='invite'?'btn-emerald':'btn-outline'} onClick={()=>setHiringMode('invite')} style={{flex:1}}>Invitation code</button>
                </div>
                {hiringMode==='search'?<>
                  <label style={{fontSize:12,fontWeight:700}}>Search restaurants accepting applications</label>
                  <input className="input-field" value={hiringSearch} onChange={e=>setHiringSearch(e.target.value)} placeholder="Type at least 2 letters" autoComplete="off"/>
                  {hiringBusy&&<span role="status" style={{fontSize:12}}>Searching…</span>}
                  {hiringResults.length>0&&<div style={{display:'grid',gap:7,maxHeight:210,overflowY:'auto'}}>
                    {hiringResults.map(restaurant=><button type="button" key={restaurant.id} className="btn-outline" onClick={()=>resolveRestaurantSelection('?tenantId='+encodeURIComponent(restaurant.id))} style={{textAlign:'left',padding:12,borderRadius:10}}>
                      <strong>{restaurant.name}</strong><br/><small>{restaurant.subdomain}</small>
                    </button>)}
                  </div>}
                  {!hiringBusy&&hiringSearch.trim().length>=2&&hiringResults.length===0&&!hiringError&&<small style={{color:'var(--text-muted)'}}>No restaurants accepting public rider applications match this search. Try another spelling or request an invitation code.</small>}
                </>:<>
                  <label style={{fontSize:12,fontWeight:700}}>Restaurant invitation code</label>
                  <input className="input-field" value={invitationEntry} onChange={e=>setInvitationEntry(e.target.value)} placeholder="Paste your private hiring code" autoCapitalize="off" autoComplete="off"/>
                  <button type="button" className="btn-emerald" onClick={useInvitation} disabled={!invitationEntry.trim()}>Verify invitation</button>
                </>}
                {hiringError&&<small role="alert" style={{color:'#dc2626'}}>{hiringError}</small>}
              </>}
            </section>

            <form onSubmit={handleLogin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, margin: 0 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Phone Number</label>
                <input className="input-field" type="tel" inputMode="tel" value={loginPhone}
                  onChange={e => setLoginPhone(e.target.value)} placeholder="e.g. 0771234567" required />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Password</label>
                <input className="input-field" type="password" value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" required />
              </div>
              <button type="submit" className="btn-emerald" disabled={loggingIn} style={{ padding: 14, fontSize: '0.95rem' }}>
                {loggingIn ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {selectedHiringRestaurant && !manualApplicationToken && <section className="card" aria-label="Resume pending rider application" style={{padding:16,marginTop:12,borderRadius:15}}>
              <button type="button" className="btn-outline" style={{width:'100%'}} onClick={()=>setRecoveryOpen(value=>!value)}>
                {recoveryOpen?'Close recovery':'Already applied? Resume document submission'}
              </button>
              {recoveryOpen&&<div style={{display:'grid',gap:10,marginTop:12}}>
                <p style={{fontSize:12,color:'var(--text-muted)',margin:0}}>Use the same restaurant and email from your pending application. We will email a fresh verification code.</p>
                <input className="input-field" type="email" value={recoveryEmail} onChange={e=>{setRecoveryEmail(e.target.value);setRecoveryCodeSent(false);}} placeholder="Registered email" autoComplete="email"/>
                <button className="btn-outline" type="button" disabled={recoveryBusy||!recoveryEmail.trim()} onClick={requestRecoveryCode}>{recoveryBusy?'Processing…':'Send email code'}</button>
                {recoveryCodeSent&&<>
                  <input className="input-field" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value.replace(/[^0-9]/g,''))} placeholder="Six-digit email code"/>
                  <button className="btn-emerald" type="button" disabled={recoveryBusy||recoveryCode.length!==6} onClick={restorePendingApplication}>Restore secure application</button>
                </>}
              </div>}
            </section>}
            {manualApplicationToken && <section className="card" aria-label="Secure manual identity document submission" style={{marginTop:12,display:'flex',flexDirection:'column',gap:12}}>
              <strong>Secure manual NIC / passport, selfie and driving-licence submission</strong>
              <p style={{fontSize:12,margin:0,color:'var(--text-muted)'}}>
                Use this when automated verification is not available. Photos are encrypted in the restaurant database, visible only to managers during review, and deleted after the final approval decision. Uploading photos is not identity verification or official DMT clearance.
              </p>
              <label style={{fontSize:13,display:'flex',gap:8,alignItems:'start'}}>
                <input type="checkbox" checked={manualConsent} onChange={e=>setManualConsent(e.target.checked)}/>
                I consent to encrypted storage of my NIC/passport, selfie photo and driving-licence evidence (if applicable) for restricted restaurant-manager review. I understand a selfie photograph is not automated liveness verification.
              </label>
              <div style={{display:'flex',flexDirection:'column',gap:8,border:'1px solid var(--border-color)',borderRadius:10,padding:12}}>
                <strong style={{fontSize:13}}>Selfie photo {manualEvidence.selfie?'✓ Submitted':''}</strong>
                <p style={{fontSize:12,margin:0,color:'var(--text-muted)'}}>Take a clear front-facing selfie with your entire face visible, good lighting and no sunglasses. Your manager will compare it to your ID image. This is not an automated biometric or liveness check.</p>
                <label style={{fontSize:12}}>Take selfie with front camera
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" disabled={!manualConsent || Boolean(manualUploading)} onChange={e=>{const file=e.target.files?.[0];if(file)handleSelfieCapture(file);e.target.value='';}}/>
                </label>
                {selfieCandidate && <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
                  <img src={selfieCandidate.url} alt="Preview of selfie awaiting submission" style={{width:'min(230px,80%)',aspectRatio:'3 / 4',objectFit:'cover',borderRadius:10,border:'1px solid var(--border-color)'}}/>
                  <div style={{display:'flex',gap:8}}>
                    <button type="button" className="btn-outline" onClick={clearSelfieCapture}>Retake</button>
                    <button type="button" className="btn-emerald" disabled={!manualConsent || Boolean(manualUploading)} onClick={()=>submitManualEvidence('selfie',selfieCandidate.file)}>{manualUploading==='selfie'?'Uploading…':'Confirm and submit selfie'}</button>
                  </div>
                </div>}
              </div>
              {[
                ['identity_front','NIC front / passport photo page'],
                ['identity_back','NIC back / passport supporting page'],
                ...(manualVehicleType==='Bicycle'?[]:[
                  ['licence_front','Driving-licence front'],
                  ['licence_back','Driving-licence back']
                ])
              ].map(([kind,label])=><label key={kind} style={{display:'flex',flexDirection:'column',gap:5,fontSize:12}}>
                <strong>{label} {manualEvidence[kind]?'✓ Submitted':''}</strong>
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!manualConsent||Boolean(manualUploading)} onChange={e=>{const file=e.target.files?.[0];if(file) void submitManualEvidence(kind,file);e.target.value='';}}/>
                {manualUploading===kind && <span role="status">Encrypting and submitting…</span>}
              </label>)}
              <small style={{color:'var(--text-muted)'}}>Maximum 2 MB per photo. On mobile, the front-camera capture is device-dependent and does not prove liveness. Use secure HTTPS. Never send identity evidence through chat or email.</small>
            </section>}
            {licenceVerificationLink && <div className="card" role="status" style={{marginTop:12}}>
              <strong>Sri Lankan driving-licence check</strong>
              <p style={{fontSize:12}}>Continue secure document authenticity verification on Veriff. The restaurant still needs to confirm your vehicle category, expiry and legal driving eligibility before approval.</p>
              <a className="btn-emerald" href={licenceVerificationLink} target="_blank" rel="noopener noreferrer">Verify driving licence</a>
            </div>}
            {identityVerificationLink && <div className="card" role="status" style={{marginTop:12}}><strong>Identity verification is ready</strong><p style={{fontSize:12}}>Continue on Veriff's secure document and selfie verification page. This does not automatically grant delivery access.</p><a className="btn-emerald" href={identityVerificationLink} target="_blank" rel="noopener noreferrer">Continue identity verification</a></div>}
            <button className="btn-outline" onClick={() => setShowRegModal(true)}
              style={{ width: '100%', padding: 14, marginTop: 16, fontSize: '0.92rem' }}>
              ➕ New rider? Self-register
            </button>
          </div>
        ) : (
          /* ── Rider dashboard ── */
          <div>
            <section className="driver-welcome"><span>YOUR DAY, IN MOTION</span><h1>Let’s make every<br/>delivery a good one.</h1><p>Welcome back, {driver.name?.split(' ')[0]}. Your assigned orders and pickup opportunities are all here.</p><ConnectionStatus compact/></section>
            <div className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}><div><strong>{driver.status === 'offline' ? 'Offline — no new delivery offers' : 'Online — available for dispatch'}</strong><div style={{ fontSize:12, color:'var(--text-muted)', marginTop:5 }}>Current deliveries remain assigned even when you stop accepting new work.</div></div><button type="button" className="btn-emerald" onClick={updateAvailability} disabled={availabilityLoading}>{availabilityLoading ? 'Updating…' : driver.status === 'offline' ? 'Go online' : 'Go offline'}</button></div>
            <div className="driver-dispatch-sync" role="status" aria-live="polite"><strong>{dispatchSyncError || !dispatchLastSynced || driverClock-dispatchLastSynced>25000 ? 'Checking dispatch connection' : 'Dispatch synced'}</strong><span>{dispatchLastSynced ? 'Last confirmed '+new Date(dispatchLastSynced).toLocaleTimeString() : 'Waiting for first update'}</span>{dispatchSyncError && <button type="button" onClick={fetchDriverOrders}>Retry now</button>}</div>
            <div className="driver-metrics"><div><small>Active deliveries</small><strong>{activeOrders.length}</strong></div><div><small>Completed today</small><strong>{summary.completedToday}</strong></div><div><small>Available pickups</small><strong>{availableOrders.length}</strong></div></div>

            <div className="card driver-controls-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#ffffff' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>🛵 {driver.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {driver.vehicleType || 'Motorbike'} ({driver.plateNumber || 'Active'}) · {gpsQuality === 'good' && lastCoords ? `Device location ±${Math.round(lastCoords.accuracyMeters)}m · ${new Date(lastCoords.recordedAt).toLocaleTimeString()}` : gpsQuality === 'weak' ? 'Weak location signal · not sharing' : gpsQuality === 'denied' ? 'Location permission denied' : 'Live location inactive'}
                </div>
              </div>
              <div className="driver-controls-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => { playDriverAlertRingtone(); showToast('🔔 Playing delivery ringer sound test!', 'info'); }}
                  className="btn-outline"
                  style={{ padding: '8px 12px', fontSize: '0.9rem' }}
                  title="Test Delivery Ringer Sound"
                >
                  🔔
                </button>
                {discoveryPilotEnabled&&<label style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}>
                  <input type="checkbox" checked={discoveryConsent} onChange={toggleDiscoveryConsent}
                    disabled={!isGpsActive||driver?.status==='offline'} />
                  Visible to restaurant dispatch while on duty
                </label>}
                <button onClick={toggleGps} className="btn-emerald"
                  style={{ padding: '8px 14px', borderRadius: 20, fontSize: '0.8rem', background: isGpsActive ? '#10b981' : '#64748b' }}>
                  {isGpsActive ? (gpsQuality === 'good' ? '📍 Location active' : '⌛ Finding location') : '📍 Share location'}
                </button>
                <button onClick={handleLogout} className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.9rem' }} title="Sign out">🚪</button>
              </div>
            </div>

            {/* COD cash summary */}
            {cashToHandover > 0 && (
              <div className="card" style={{ marginTop: 16, padding: 14, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 700 }}>💰 Cash to hand over to manager</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#b45309' }}>Rs. {cashToHandover.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', color: '#a16207', marginTop: 2 }}>Settle at the counter — the manager confirms handover.</div>
              </div>
            )}

            <div className="driver-task-nav" role="tablist" aria-label="Delivery view">{[['active', 'My route'], ['available', 'Available'], ['history', 'Completed']].map(([id, label]) => <button key={id} role="tab" aria-selected={taskTab === id} onClick={() => setTaskTab(id)}>{label}</button>)}</div>
            {/* Available to claim */}
            {taskTab === 'available' && availableOrders.length === 0 && <div className="driver-empty"><strong>You’re all caught up.</strong>Available pickups will appear here automatically.</div>}
            {taskTab === 'available' && availableOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '1.0rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
                  🟢 Available to Claim ({availableOrders.length})
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                  {availableOrders.map(ord => {
                    // Calculate driver-to-destination distance
                    const dropKm = (lastCoords && ord.deliveryLat && ord.deliveryLng)
                      ? haversineKm(lastCoords.lat, lastCoords.lng, ord.deliveryLat, ord.deliveryLng)
                      : (ord.deliveryLat && ord.deliveryLng)
                        ? haversineKm(STORE_LAT, STORE_LNG, ord.deliveryLat, ord.deliveryLng)
                        : null;

                    return (
                    <div key={ord.id} className="card" style={{ margin: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1rem' }}>Order #{ord.id.slice(-4).toUpperCase()}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            📍 {ord.deliveryAddress || 'Store Pickup'} · Rs. {ord.total?.toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          {dropKm !== null && (
                            <span style={{ background: dropKm <= 5 ? '#10b98122' : '#f59e0b22', color: dropKm <= 5 ? '#10b981' : '#f59e0b', border: `1px solid ${dropKm <= 5 ? '#10b981' : '#f59e0b'}44`, padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 800 }}>
                              🗺️ {dropKm} km drop
                            </span>
                          )}
                          {isRushHour(restaurantTimeZone) && (
                            <span style={{ background: '#f59e0b22', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700 }}>⏰ Peak</span>
                          )}
                        </div>
                      </div>
                      <button className="btn-emerald" style={{ padding: '10px 14px', fontSize: '0.82rem' }} onClick={() => handleClaim(ord.id)}>Claim Delivery</button>
                    </div>
                    );
                  })}
                </div>
              </>
            )}

            {taskTab !== 'available' && <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
              {taskTab === 'history' ? 'Completed deliveries' : 'My route'} ({visibleOrders.length})
            </h3>

            {visibleOrders.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>{taskTab === 'history' ? 'Completed deliveries will appear here.' : 'No active deliveries. Check Available for your next pickup.'}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {visibleOrders.map(ord => {
                  const itemsStr = Array.isArray(ord.items) ? ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Delivery Items';
                  const customerPhone = ord.customerPhone || 'N/A';
                  // Bug 7 fix: convert Sri Lankan local prefix 0771... → +94771...
                  // The previous regex stripped '+' which made +94 numbers work,
                  // but left 07x numbers without a country code — WhatsApp couldn't resolve them.
                  const waPhone = customerPhone.replace(/[\s-]/g, '').replace(/^0/, '+94');
                  const waLink = `https://wa.me/${waPhone}?text=Hi%20${encodeURIComponent(ord.customerName || 'Customer')},%20I%20am%20your%20GastroFlow%20rider%20for%20Order%20%23${ord.id.slice(-4).toUpperCase()}`;
                  const navLink = (ord.deliveryLat && ord.deliveryLng)
                    ? `https://www.google.com/maps/dir/?api=1&destination=${ord.deliveryLat},${ord.deliveryLng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.deliveryAddress || '')}`;

                  return (
                    <div key={ord.id} className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--text-main)' }}>Order #{ord.id.slice(-4).toUpperCase()}</span>
                        <span style={{ background: ord.status === 'delivered' ? '#d1fae5' : ord.status === 'out_for_delivery' ? '#dbeafe' : '#fef3c7', color: ord.status === 'delivered' ? '#065f46' : ord.status === 'out_for_delivery' ? '#1e40af' : '#92400e', padding: '4px 10px', borderRadius: 12, fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {ord.status?.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div>👤 <strong>{ord.customerName || 'Customer'}</strong></div>
                        <div>📞 <strong>{customerPhone}</strong></div>
                        <div>📍 <strong>{ord.deliveryAddress || 'Store Location'}</strong></div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📦 {itemsStr}</div>
                        <div>{ord.paymentStatus === 'paid' ? 'Payment verified' : ['cash', 'cod'].includes(ord.paymentMethod) ? 'Cash to collect' : 'Awaiting payment confirmation'}: <strong style={{ color: 'var(--brand-emerald)', fontSize: '1rem' }}>Rs. {Number(ord.total).toFixed(2)}</strong> ({ord.paymentMethod || 'Unknown method'})</div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a href={navLink} target="_blank" rel="noopener noreferrer"
                          style={{ flex: '1 1 45%', background: '#3b82f6', color: '#fff', padding: 10, borderRadius: 10, textDecoration: 'none', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
                          🧭 Navigate
                        </a>
                        <a href={waLink} target="_blank" rel="noopener noreferrer"
                          style={{ flex: '1 1 45%', background: '#25D366', color: '#fff', padding: 10, borderRadius: 10, textDecoration: 'none', textAlign: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
                          💬 WhatsApp
                        </a>
                        {['ready', 'picked_up'].includes(ord.status) && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem', background: '#3b82f6' }}
                            onClick={() => handleUpdateStatus(ord.id, 'out_for_delivery')}>
                            <AnimatedFeatureIcon kind="delivery" size={28} active={false}/> Start Delivery (Out for Delivery)
                          </button>
                        )}
                        {['out_for_delivery', 'arrived'].includes(ord.status) && (
                          <button className="btn-emerald" style={{ flex: '1 1 100%', padding: 10, fontSize: '0.82rem' }}
                            onClick={() => setSelectedDeliveryOrder(ord)}>
                            ✓ Mark Delivered (Signature & Proof)
                          </button>
                        )}
                        {ord.status === 'delivered' && (ord.proofSavedAt ? <button className="btn-outline" onClick={async () => {
                          try { setProofPreview(await apiFetch(`/public/driver/orders/${encodeURIComponent(ord.id)}/proof`)); }
                          catch (error) { showToast(error.message, 'error'); }
                        }}>View saved proof</button> : <span>Legacy delivery: no proof recorded</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </>}
          </div>
        )}

        {/* Proof of Delivery Signature & Photo Modal */}
        {selectedDeliveryOrder && (
          <ProofOfDeliveryModal
            order={selectedDeliveryOrder}
            onClose={() => setSelectedDeliveryOrder(null)}
            onConfirm={(ordId, proofData) => handleUpdateStatus(ordId, 'delivered', proofData)}
          />
        )}

        {proofPreview && <DeliveryProofViewer proof={proofPreview} onClose={() => setProofPreview(null)} />}

        {/* Self-registration modal */}
        {showRegModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="card device-dialog" role="dialog" aria-modal="true" aria-label="Driver application" style={{ maxWidth: 440, width: '100%', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', margin: 0, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>🛵 Rider Self-Registration</h3>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>{selectedHiringRestaurant?.name||'Select a restaurant before registering'}</span>
                <button aria-label="Close driver application" onClick={() => setShowRegModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
              </div>

              <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input className="input-field" type="text" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} placeholder="Full name" required />
                <input className="input-field" type="tel" inputMode="tel" value={reg.phone} onChange={e => setReg({ ...reg, phone: e.target.value })} placeholder="Phone (e.g. 0771234567)" required />
                <input className="input-field" type="email" autoComplete="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} placeholder="Email address for verification" required />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input className="input-field" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={reg.verificationCode} onChange={e => setReg({ ...reg, verificationCode: e.target.value.replace(/[^0-9]/g, '') })} placeholder="6-digit email code" required /><button type="button" className="btn-outline" onClick={handleSendRegCode} disabled={sendingRegCode || !reg.email} style={{ whiteSpace: 'nowrap' }}>{sendingRegCode ? 'Sending…' : 'Email code'}</button></div>
                {regCodeSentTo && <small role="status" style={{ color: 'var(--text-muted)' }}>Code requested for {regCodeSentTo}. Check inbox or spam. Expires after 10 minutes.</small>}
                <input className="input-field" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={reg.password} onChange={e => setReg({ ...reg, password: e.target.value })} placeholder="Create a password (10–72 characters)" required />
                <select className="input-field" value={reg.vehicleType} onChange={e => setReg({ ...reg, vehicleType: e.target.value })}>
                  <option value="Motorbike">🛵 Motorbike / Scooter</option>
                  <option value="TukTuk">🛺 Three Wheeler / TukTuk</option>
                  <option value="Car">🚗 Car / Van</option>
                  <option value="Bicycle">🚲 Bicycle</option>
                </select>
                <input className="input-field" type="text" value={reg.plateNumber} onChange={e => setReg({ ...reg, plateNumber: e.target.value })} placeholder="Plate number (e.g. WP BZ-9988)" />
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--text-muted)' }}><input type="checkbox" checked={reg.privacyAccepted} onChange={e => setReg({ ...reg, privacyAccepted: e.target.checked })} required style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }} /><span>I understand my details will be shared with the selected restaurant for review. Email verification proves email control only; phone, identity, licence and vehicle eligibility still require checks.</span></label>
                <label style={{display:'flex',gap:10,alignItems:'flex-start',fontSize:'0.78rem',lineHeight:1.5}}><input type="checkbox" checked={reg.identityConsent===true} onChange={e=>setReg({...reg,identityConsent:e.target.checked})} style={{marginTop:4,width:18,height:18}}/><span>I consent to optional third-party identity verification, which may process my NIC/passport image, selfie and biometric information under that provider's notice. If the provider is unavailable, the restaurant must arrange a separate secure review.</span></label>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button type="button" className="btn-outline" onClick={() => setShowRegModal(false)} style={{ flex: 1 }}>Cancel</button>
                  <button type="submit" className="btn-emerald" disabled={regSubmitting||!selectedHiringRestaurant} style={{ flex: 2 }}>
                    {regSubmitting ? 'Submitting…' : 'Submit Application'}
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Applications are pending review. The restaurant must check identity, licence and vehicle eligibility before approving delivery access. Do not upload identity documents through this form.</p>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
