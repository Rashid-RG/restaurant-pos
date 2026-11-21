const DeliveryMap = React.lazy(()=>import('./DeliveryMap.jsx'));
import RiderEvidenceWizard from './RiderEvidenceWizard.jsx';
import RiderRegistrationWizard from './RiderRegistrationWizard.jsx';
import './rider-wizard.css';
import { AnimatedFeatureIcon } from '../../../shared/ui/AnimatedFeatureIcon.jsx';
import { Bike, House, ClipboardList, Wallet, UserRound, Navigation, MapPin, PackageCheck, Bell, LogOut, MessageCircle, Phone, User, Package, Check, CircleCheck, Truck, Clock3 } from 'lucide-react';
import ProofOfDeliveryModal, { DeliveryProofViewer } from './ProofOfDeliveryModal.jsx';
import { ConnectionStatus } from '../../../shared/ui/Resilience.jsx';
import React, { useState, useEffect, useRef } from 'react';
import SystemUpdatePrompt from '../../customer-web/src/components/SystemUpdatePrompt.jsx';
import {shouldSendDriverFix,validDriverFix} from './utils/gps-transmission.js';
import {Capacitor,CapacitorHttp,registerPlugin} from '@capacitor/core';
import {createNativeTrackingSession} from '../../driver-native/src/background-tracker.js';
import {createDispatchRequestGate,createDispatchTimeout,latestDispatchTickets} from './utils/dispatch-sync.js';
import {offerSecondsRemaining,offerExpired} from './utils/offer-clock.js';
import {driverLanguages,driverText,driverThemeChoice} from './utils/driver-locale.js';
import {offlineUpdateKey,sanitizePendingUpdates,queuePendingStatus,removePendingStatus} from './utils/offline-status.js';


// ── Auth token storage ──
const TOKEN_KEY = 'gastrodriver_token';
const DRIVER_KEY = 'gastrodriver_profile';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
const restoredDriverProfile = () => {
  try {
    // The cached profile is cosmetic only; the server authenticates the JWT
    // and verifies the rider/restaurant before returning any private orders.
    if(!getToken())return null;
    const profile=JSON.parse(localStorage.getItem(DRIVER_KEY)||'null');
    if(!profile || typeof profile!=='object' || typeof profile.id!=='string' ||
       !profile.id || typeof profile.name!=='string')return null;
    const {id,tenant_id,name,phone,vehicleType,plateNumber,status}=profile;
    return {id,tenant_id,name,phone,vehicleType,plateNumber,status};
  }catch{return null;}
};

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

function isRushHour(timeZone = 'Asia/Colombo') {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
}

export default function App() {
  const [driver, setDriver] = useState(restoredDriverProfile);
  const [pendingOfflineUpdates,setPendingOfflineUpdates]=useState([]);
  const [retryingOfflineUpdates,setRetryingOfflineUpdates]=useState(false);
  const [offlineRetryError,setOfflineRetryError]=useState('');
  const offlineScope=driver?.id?offlineUpdateKey(driver.tenant_id||sessionStorage.getItem('gastrodriver_selected_tenant')||'default_tenant',driver.id):null;
  useEffect(()=>{
    if(!offlineScope){setPendingOfflineUpdates([]);return;}
    try{
      const stored=sanitizePendingUpdates(JSON.parse(localStorage.getItem(offlineScope)||'[]'));
      setPendingOfflineUpdates(stored);
      localStorage.setItem(offlineScope,JSON.stringify(stored));
    }catch{setPendingOfflineUpdates([]);localStorage.removeItem(offlineScope);}
  },[offlineScope]);
  const storeOfflineUpdates=(updates)=>{
    if(!offlineScope)return;
    setPendingOfflineUpdates(updates);
    localStorage.setItem(offlineScope,JSON.stringify(updates));
  };
  const driverStatusRef=useRef(null);
  driverStatusRef.current=driver?.status||null;
  const driverStatusIdentityRef=useRef(null);
  driverStatusIdentityRef.current=driver?.id||null;
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [restaurantTimeZone, setRestaurantTimeZone] = useState('Asia/Colombo');
  const [activeOrders, setActiveOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState({ completedToday: 0, cashToHandover: 0 });
  const [cashSummary,setCashSummary]=useState(null);
  const [approvedEarnings,setApprovedEarnings]=useState(null);
  const [earningsLoading,setEarningsLoading]=useState(false);
  const [earningsError,setEarningsError]=useState('');
  const [mapOrder,setMapOrder]=useState(null);
  const [roadEstimates,setRoadEstimates]=useState({});
  const [roadLoadingId,setRoadLoadingId]=useState(null);
  const roadRequestEpochRef=useRef(0);
  const [cashLoading,setCashLoading]=useState(false);
  const cashRequestVersionRef=useRef(0);
  const [cashError,setCashError]=useState('');
  const [cashDetailsOpen,setCashDetailsOpen]=useState(false);
  const [taskTab, setTaskTab] = useState('active');
  const [driverScreen,setDriverScreen]=useState('home');
  const [driverLanguage,setDriverLanguage]=useState('en');
  const [driverTheme,setDriverTheme]=useState('system');
  const [prefersDark,setPrefersDark]=useState(()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches===true);
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    if(!media)return;
    const update=()=>setPrefersDark(media.matches);
    media.addEventListener?.('change',update);
    return()=>media.removeEventListener?.('change',update);
  },[]);
  useEffect(()=>{
    if(!driver?.id){setDriverLanguage('en');setDriverTheme('system');return;}
    const language=localStorage.getItem(`gastrodriver:language:${driver.id}`);
    setDriverLanguage(driverLanguages.includes(language)?language:'en');
    setDriverTheme(driverThemeChoice(localStorage.getItem(`gastrodriver:theme:${driver.id}`)));
  },[driver?.id]);
  const setDriverPreference=(name,value)=>{
    if(!driver?.id)return;
    localStorage.setItem(`gastrodriver:${name}:${driver.id}`,value);
    if(name==='language')setDriverLanguage(value);
    if(name==='theme')setDriverTheme(value);
  };
  const tx=key=>driverText(driverLanguage,key);
  const isDark=driverTheme==='dark'||(driverTheme==='system'&&prefersDark);
  const [ownDriverProfile,setOwnDriverProfile]=useState(null);
  const [profileLoading,setProfileLoading]=useState(false);
  const [profileError,setProfileError]=useState('');
  useEffect(()=>{
    if(driverScreen!=='profile'||!driver?.id)return;
    let cancelled=false;
    const id=driver.id;
    setProfileLoading(true);setProfileError('');
    apiFetch('/public/driver/profile',{cache:'no-store'}).then(data=>{
      if(cancelled||driverStatusIdentityRef.current!==id)return;
      if(!data.profile||data.profile.id!==id)throw new Error('Invalid driver profile response.');
      setOwnDriverProfile(data.profile);
    }).catch(error=>{if(!cancelled)setProfileError(error.message||'Could not load profile.');})
      .finally(()=>{if(!cancelled)setProfileLoading(false);});
    return()=>{cancelled=true;};
  },[driver?.id,driverScreen]);
  useEffect(()=>{
    if(driverScreen!=='earnings'||!driver?.id)return;
    let cancelled=false;
    const driverId=driver.id;
    setEarningsLoading(true);setEarningsError('');
    apiFetch('/public/driver/earnings',{cache:'no-store'}).then(data=>{
      if(cancelled||driverStatusIdentityRef.current!==driverId)return;
      if(data.currency!=='LKR'||!Number.isSafeInteger(data.totalApprovedCents)||data.totalApprovedCents<0||
         !Array.isArray(data.entries))throw new Error('Unexpected approved earnings data.');
      setApprovedEarnings(data);
    }).catch(error=>{
      if(!cancelled)setEarningsError(error.message||'Could not load earnings.');
    }).finally(()=>{if(!cancelled)setEarningsLoading(false);});
    return()=>{cancelled=true;};
  },[driver?.id,driverScreen]);
  // Preferences belong to the authenticated rider on this device.
  const [soundAlertsEnabled,setSoundAlertsEnabled]=useState(true);
  useEffect(()=>{
    if(!driver?.id){setSoundAlertsEnabled(true);return;}
    setSoundAlertsEnabled(localStorage.getItem(`gastrodriver:sound:${driver.id}`)!=='off');
  },[driver?.id]);
  const [accessibility,setAccessibility]=useState({largeText:false,highContrast:false,reducedMotion:false});
  useEffect(()=>{
    if(!driver?.id){setAccessibility({largeText:false,highContrast:false,reducedMotion:false});return;}
    try{
      const settings=JSON.parse(localStorage.getItem(`gastrodriver:accessibility:${driver.id}`)||'{}');
      setAccessibility({
        largeText:settings.largeText===true,
        highContrast:settings.highContrast===true,
        reducedMotion:settings.reducedMotion===true
      });
    }catch{setAccessibility({largeText:false,highContrast:false,reducedMotion:false});}
  },[driver?.id]);
  const changeAccessibility=(name,enabled)=>{
    if(!driver?.id)return;
    const next={...accessibility,[name]:enabled};
    localStorage.setItem(`gastrodriver:accessibility:${driver.id}`,JSON.stringify(next));
    setAccessibility(next);
  };
  const toggleSoundAlerts=()=>{
    if(!driver?.id)return;
    const next=!soundAlertsEnabled;
    localStorage.setItem(`gastrodriver:sound:${driver.id}`,next?'on':'off');
    setSoundAlertsEnabled(next);
  };
  const [supportCategory,setSupportCategory]=useState('delivery');
  const [supportMessage,setSupportMessage]=useState('');
  const [supportOrderId,setSupportOrderId]=useState('');
  const [supportHistory,setSupportHistory]=useState([]);
  const [supportBusy,setSupportBusy]=useState(false);
  const [supportError,setSupportError]=useState('');
  const supportRequestEpochRef=useRef(0);
  const [orderSearch,setOrderSearch]=useState('');
  const [availableOrders, setAvailableOrders] = useState([]);
  const [pickupLocation,setPickupLocation]=useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingOrderId,setPendingOrderId]=useState(null);
  const pendingOrderRef=useRef(null);
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const nativeTrackingRef=useRef(null);
  // Reject callbacks from tracking sessions stopped by logout, going offline,
  // permission changes, or a newer GPS session.
  const locationSessionEpochRef=useRef(0);
  const nativeDriverBuild=import.meta.env.MODE==='native' && Capacitor.isNativePlatform();
  const [lastCoords, setLastCoords] = useState(null);
  const [gpsQuality, setGpsQuality] = useState('not_started');
  const [gpsUploadStatus,setGpsUploadStatus]=useState('idle'); // Device GPS != server-accepted location
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
  const previouslyAssignedIdsRef=useRef(null);
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
  const [applicationIdentityType,setApplicationIdentityType]=useState(null);
  const [identityTypeSaving,setIdentityTypeSaving]=useState(false);
  const [sendingRegCode, setSendingRegCode] = useState(false);
  const [regCodeSentTo, setRegCodeSentTo] = useState('');
  const [regVerificationToken,setRegVerificationToken]=useState('');
  const [verifyingRegCode,setVerifyingRegCode]=useState(false);
  const [regEmailError,setRegEmailError]=useState('');

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

  const handleLogout = () => {
    locationSessionEpochRef.current+=1;
    // Start device / presence cleanup but never hold visible customer data on
    // screen while background tracking or the network takes time to stop.
    const tracking=nativeTrackingRef.current;
    nativeTrackingRef.current=null;
    if(tracking) void tracking.stop().catch(()=>{});
    if(discoveryPilotEnabled) void apiFetch('/public/driver/off-duty-location',{method:'POST'}).catch(()=>{});
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    // Revoke local credentials immediately; no pending asynchronous cleanup
    // is allowed to delay sign-out on shared devices.
    if(offlineScope)localStorage.removeItem(offlineScope);
    setPendingOfflineUpdates([]);setOfflineRetryError('');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DRIVER_KEY);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setIsGpsActive(false);
    setWatchId(null);
    setGpsQuality('not_started');
    setLastCoords(null);
    discoveryConsentRef.current=false;
    setDiscoveryConsent(false);
    lastPresenceSentRef.current=null;
    lastBroadcastRef.current = null;
    lastFixRef.current = null;
    setDriver(null);
    // Bug 4 fix: clear order state so the next driver to log in on the
    // same device does not briefly see the previous driver's orders.
    setActiveOrders([]);
    setAvailableOrders([]);
    setPickupLocation(null);
    setHistory([]);
    setSummary({ completedToday: 0, cashToHandover: 0 });
    setTaskTab('active');
    setDriverScreen('home');
    setOwnDriverProfile(null);setProfileLoading(false);setProfileError('');
    supportRequestEpochRef.current+=1;
    setSupportCategory('delivery');setSupportMessage('');setSupportOrderId('');
    setSupportHistory([]);setSupportError('');setSupportBusy(false);
    setOrderSearch('');
    setSelectedDeliveryOrder(null);
    setProofPreview(null);
    setPendingOrderId(null);
    pendingOrderRef.current=null;
    roadRequestEpochRef.current+=1;
    setRoadEstimates({});setMapOrder(null);setRoadLoadingId(null);
    cashRequestVersionRef.current+=1; // Invalidates any in-flight result from the previous rider.
    setCashSummary(null);setCashLoading(false);setCashDetailsOpen(false);setCashError('');
    setApprovedEarnings(null);setEarningsLoading(false);setEarningsError('');
    activeOrdersRef.current = [];
    previouslyAssignedIdsRef.current=null;
    prevUnassignedCountRef.current = 0;
    dispatchAbortRef.current?.cancel();dispatchAbortRef.current=null;
    dispatchGateRef.current.invalidate();
    setDispatchLastSynced(null);setDispatchSyncError(false);
    setLoading(false);
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
      if(response.status==='offline'){
        locationSessionEpochRef.current+=1;
        // Availability is authoritative: stop both native tracking and browser GPS
        // when going offline, so a background watch cannot keep sending fixes.
        if(watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
        lastBroadcastRef.current=null;
        lastFixRef.current=null;
        if(nativeTrackingRef.current)void nativeTrackingRef.current.stop().catch(()=>{});
        nativeTrackingRef.current=null;
        setIsGpsActive(false);setGpsQuality('off');setLastCoords(null);setGpsUploadStatus('idle');
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
  const playDriverAlertRingtone = (manualTest=false) => {
    if(!manualTest && !soundAlertsEnabled) return;
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
      const nowAssignedIds=new Set(newAssigned.map(order=>order.id));
      const completedIds=new Set(tickets.completed.map(order=>order.id));
      const removed=previouslyAssignedIdsRef.current
        ? [...previouslyAssignedIdsRef.current].filter(id=>!nowAssignedIds.has(id)&&!completedIds.has(id))
        : [];
      previouslyAssignedIdsRef.current=nowAssignedIds;
      if(removed.length){
        showToast('An assigned delivery is no longer on your route. Refresh and contact restaurant dispatch before continuing.','warning');
      }

      setActiveOrders(newAssigned);
      setHistory(tickets.completed);
      setDispatchLastSynced(Date.now());setDispatchSyncError(false);
      setSummary(data.summary || { completedToday: 0, cashToHandover: 0 });
      if (data.timeZone) setRestaurantTimeZone(data.timeZone);
      setAvailableOrders(newUnassigned);
      setPickupLocation(data.pickupLocation && Number.isFinite(data.pickupLocation.lat) && Number.isFinite(data.pickupLocation.lng) ? data.pickupLocation : null);
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
    if (!isGpsActive && driverStatusRef.current === 'offline') {
      showToast('Go online before sharing location.','warning');
      return;
    }
    if(nativeDriverBuild){
      if(isGpsActive || nativeTrackingRef.current){
        locationSessionEpochRef.current+=1;
        if(nativeTrackingRef.current)void nativeTrackingRef.current.stop().catch(()=>{});
        nativeTrackingRef.current=null;
        setIsGpsActive(false);setGpsQuality('off');setLastCoords(null);
        discoveryConsentRef.current=false;setDiscoveryConsent(false);
        return;
      }
      if(driverStatusRef.current==='offline'){
        showToast('Go online before starting native location tracking.','warning');return;
      }
      try{
        const locationEpoch=++locationSessionEpochRef.current;
        const session=createNativeTrackingSession({
          plugin:registerPlugin('BackgroundGeolocation'),
          httpPost:opts=>CapacitorHttp.post(opts),
          apiOrigin:import.meta.env.VITE_DRIVER_NATIVE_API_URL,
          getToken,getActiveOrders:()=>activeOrdersRef.current,
          onFix:fix=>{
            if(locationSessionEpochRef.current!==locationEpoch || !getToken() || driverStatusRef.current==='offline') return;
            setLastCoords(fix);setGpsQuality('good');
          },
          onStatus:status=>{
            if(locationSessionEpochRef.current!==locationEpoch) return;
            if(status==='location_error') setGpsQuality('weak');
            if(status==='upload_error') setGpsUploadStatus('failed');
            if(status==='upload_success') setGpsUploadStatus('accepted');
            if(status==='off') setGpsUploadStatus('idle');
          }
        });
        nativeTrackingRef.current=session;
        setGpsQuality('searching');
        void session.start({onDuty:true,locationConsent:true,
          discoveryConsent:discoveryPilotEnabled&&discoveryConsentRef.current
        }).then(started=>{
          if(locationSessionEpochRef.current!==locationEpoch || nativeTrackingRef.current!==session || !getToken() || driverStatusRef.current==='offline'){
            void session.stop().catch(()=>{});
            return;
          }
          if(started) setIsGpsActive(true);
          else setGpsQuality('off');
        }).catch(error=>{
          if(locationSessionEpochRef.current!==locationEpoch || nativeTrackingRef.current!==session) return;
          nativeTrackingRef.current=null;setIsGpsActive(false);setGpsQuality('denied');
          showToast(error?.message||'Native location permission unavailable.','error');
        });
      }catch(error){
        setGpsQuality('denied');
        showToast(error?.message||'Native GPS is not configured.','error');
      }
      return;
    }
    if (isGpsActive) {
      locationSessionEpochRef.current+=1;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      setIsGpsActive(false);
      setWatchId(null);
      setLastCoords(null);
      setGpsQuality('off');setGpsUploadStatus('idle');
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
    const locationEpoch=++locationSessionEpochRef.current;
    setIsGpsActive(true);
    setGpsQuality('searching');
    showToast('Searching for a reliable device location…', 'info');
    const id = navigator.geolocation.watchPosition((pos) => {
      if(locationSessionEpochRef.current!==locationEpoch || !getToken() || driverStatusRef.current==='offline') return;
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
      setGpsUploadStatus('sending');
      Promise.allSettled(assigned.map(order => apiFetch('/public/driver/location', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, ...coords })
      }))).then(results => {
        if(locationSessionEpochRef.current!==locationEpoch || !getToken() || driverStatusRef.current==='offline') return;
        setGpsUploadStatus(results.every(result=>result.status==='fulfilled')?'accepted':'failed');
      });
    }, err => {
      if(locationSessionEpochRef.current!==locationEpoch || !getToken() || driverStatusRef.current==='offline') return;
      if (err?.code === 1) {
        locationSessionEpochRef.current+=1;
        navigator.geolocation.clearWatch(id);
        setWatchId(null);
        setIsGpsActive(false);
        setLastCoords(null);
        discoveryConsentRef.current=false;
        setDiscoveryConsent(false);
        setGpsQuality('denied');
      } else {
        setGpsQuality('weak');
      }
      showToast(err?.code === 1 ? 'Location permission denied. Enable it in device settings.' :
        'Location signal weak. Keep the app visible and move to a clearer area.', 'warning');
    }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
    setWatchId(id);
  };

  const loadCashSummary = async () => {
    if(cashLoading || !driver) return;
    const requestVersion=++cashRequestVersionRef.current;
    const requestedDriverId=driver.id;
    setCashLoading(true);setCashError('');
    try {
      const result=await apiFetch('/public/driver/cash-summary',{cache:'no-store'});
      if(requestVersion!==cashRequestVersionRef.current || requestedDriverId!==driverStatusIdentityRef.current) return;
      const centsFields=['cashReceivedCents','cashHandoverPendingCents','cashHandedOverCents'];
      if(result.currency!=='LKR' || !centsFields.every(key=>Number.isSafeInteger(result[key]) && result[key]>=0)
        || !Number.isSafeInteger(result.deliveredCodOrders) || result.deliveredCodOrders<0) {
        throw new Error('The settlement figures could not be verified. Please retry.');
      }
      setCashSummary(result);
    } catch(error) {
      if(requestVersion!==cashRequestVersionRef.current || requestedDriverId!==driverStatusIdentityRef.current) return;
      setCashError(error.message || 'Could not retrieve cash settlement.');
      setCashSummary(null);
    } finally {
      if(requestVersion===cashRequestVersionRef.current) setCashLoading(false);
    }
  };

  const requestRoadEstimate = async (orderId) => {
    if(!driver || roadLoadingId!==null) return;
    const currentEpoch=++roadRequestEpochRef.current;
    const riderId=driver.id;
    setRoadLoadingId(orderId);
    try {
      const result=await apiFetch(`/public/driver/orders/${encodeURIComponent(orderId)}/road-eta?geometry=1`,{cache:'no-store'});
      if(roadRequestEpochRef.current!==currentEpoch || riderId!==driverStatusIdentityRef.current) return;
      const validResult=result.available===true && result.source==='road' &&
        Number.isFinite(result.distanceKm) && result.distanceKm>=0 &&
        Number.isFinite(result.travelMinutes) && result.travelMinutes>=0;
      setRoadEstimates(prev=>({...prev,[orderId]:validResult ?
        {available:true,distanceKm:result.distanceKm,travelMinutes:result.travelMinutes,estimatedAt:result.estimatedAt,basedOnFixAt:result.basedOnFixAt,geometry:result.geometry} :
        {available:false,message:typeof result.reason==='string' ? result.reason : 'No verified route estimate is available.'}}));
    } catch(error) {
      if(roadRequestEpochRef.current===currentEpoch && riderId===driverStatusIdentityRef.current)
        setRoadEstimates(prev=>({...prev,[orderId]:{available:false,message:error.message||'Road estimate unavailable.'}}));
    } finally {
      if(roadRequestEpochRef.current===currentEpoch) setRoadLoadingId(null);
    }
  };

  const handleDecline = async (orderId) => {
    if(pendingOrderRef.current || !driver || driverStatusRef.current==='offline')return;
    if(dispatchSyncError || !dispatchLastSynced || Date.now()-dispatchLastSynced>25000){
      showToast('Refresh dispatch before declining an outdated offer.','warning');
      return;
    }
    pendingOrderRef.current=orderId;setPendingOrderId(orderId);
    try{
      await apiFetch('/public/driver/decline',{method:'POST',body:JSON.stringify({orderId})});
      setAvailableOrders(previous=>previous.filter(order=>order.id!==orderId));
      showToast('Offer declined for your account. The restaurant order remains available to other riders.','info');
      void fetchDriverOrders();
    }catch(error){
      showToast(error.message||'Could not decline offer. Please retry.','error');
    }finally{
      pendingOrderRef.current=null;setPendingOrderId(null);
    }
  };

  const handleClaim = async (orderId) => {
    if(pendingOrderRef.current || driverStatusRef.current === 'offline') return;
    if(dispatchSyncError || !dispatchLastSynced || Date.now()-dispatchLastSynced>25000) {
      showToast('Dispatch data is outdated. Refresh before claiming this order.','warning');
      return;
    }
    pendingOrderRef.current=orderId;setPendingOrderId(orderId);
    try {
      await apiFetch('/public/driver/assign', { method: 'POST', body: JSON.stringify({ orderId }) });
      showToast('Delivery claimed! 🚀', 'success');
      fetchDriverOrders();
    } catch (err) {
      showToast(err.message || 'Failed to claim order', 'error');
    } finally {
      pendingOrderRef.current=null;setPendingOrderId(null);
    }
  };

  const retryOfflineUpdates=async()=>{
    if(!driver||retryingOfflineUpdates||!navigator.onLine||pendingOrderRef.current)return;
    setRetryingOfflineUpdates(true);setOfflineRetryError('');
    let remaining=[...pendingOfflineUpdates];
    try {
      for(const update of pendingOfflineUpdates){
        if(driverStatusIdentityRef.current!==driver.id)break;
        try{
          await apiFetch('/public/driver/status',{method:'POST',body:JSON.stringify({orderId:update.orderId,status:update.status})});
          if(driverStatusIdentityRef.current!==driver.id || !getToken())break;
          remaining=removePendingStatus(remaining,update.orderId);
          storeOfflineUpdates(remaining);
        }catch(error){
          setOfflineRetryError(error.message||'Update not accepted. Check the latest order status.');
          break;
        }
      }
      if(driverStatusIdentityRef.current!==driver.id || !getToken())return;
      if(remaining.length===0)showToast('Saved progress updates have been confirmed by the server.','success');
      void fetchDriverOrders();
    }finally{setRetryingOfflineUpdates(false);}
  };
  const discardOfflineUpdate=orderId=>{
    const next=removePendingStatus(pendingOfflineUpdates,orderId);
    storeOfflineUpdates(next);
  };

  const handleUpdateStatus = async (orderId, newStatus, proof = null) => {
    if(pendingOrderRef.current) {
      const busyError=new Error('Another delivery update is still processing. Try again after it finishes.');
      if(newStatus==='delivered') throw busyError;
      showToast(busyError.message,'warning');
      return;
    }
    pendingOrderRef.current=orderId;setPendingOrderId(orderId);
    try {
      const fix = isGpsActive && gpsQuality === 'good' && validDriverFix(lastCoords) ? lastCoords : null;
      const result = await apiFetch('/public/driver/status', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          status: newStatus,
          lat: fix?.lat,
          lng: fix?.lng,
          signature: proof?.signature,
          deliveryPhoto: proof?.photo,
          cashReceived: proof?.cashReceived,
          deliveryPin: proof?.deliveryPin
        })
      });
      if (newStatus === 'delivered' && !result.proof?.savedAt) throw new Error('No saved proof receipt was returned. Refresh to check this delivery.');
      if(newStatus==='delivered') setCashSummary(null); // Settlement must be reloaded after cash delivery.
      if(pendingOfflineUpdates.some(item=>item.orderId===orderId)){
        storeOfflineUpdates(removePendingStatus(pendingOfflineUpdates,orderId));
      }
      showToast(newStatus === 'delivered' ? 'Delivery completed. Proof saved.' : 'Delivery status updated.', 'success');
      fetchDriverOrders();
    } catch (err) {
      if (newStatus === 'delivered') throw err;
      if(err instanceof TypeError || navigator.onLine===false){
        try{
          const next=queuePendingStatus(pendingOfflineUpdates,orderId,newStatus);
          storeOfflineUpdates(next);
          showToast('Network unavailable. Progress saved on this device; open Orders to review and retry.','warning');
        }catch(queueError){
          showToast(queueError.message||'Could not queue progress. Check your connection.','warning');
        }
      }else{
        showToast(err.message || 'Failed to update status', 'error');
      }
    } finally {
      pendingOrderRef.current=null;setPendingOrderId(null);
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
        method:'POST',body:JSON.stringify({email:recoveryEmail.trim(),flow:'recover'})
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
      setApplicationIdentityType(null);
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
    setRegEmailError('');
    setSendingRegCode(true);
    try {
      const result = await apiFetch('/public/drivers/request-email-code', { method: 'POST', body: JSON.stringify({email:reg.email.trim()}) });
      setRegVerificationToken('');
      setRegCodeSentTo(reg.email.trim().toLowerCase());
      showToast(result.message || 'Verification code sent.', 'success');
    } catch (err) { setRegEmailError(err.message || 'Unable to send verification code.');showToast(err.message || 'Unable to send verification code.', 'error'); }
    finally { setSendingRegCode(false); }
  };

  const handleVerifyRegCode = async () => {
    if(regCodeSentTo!==reg.email.trim().toLowerCase() || !/^\\d{6}$/.test(reg.verificationCode)) {
      showToast('Enter the six-digit code sent to this email.','warning');return;
    }
    setRegEmailError('');
    setVerifyingRegCode(true);
    try{
      const result=await apiFetch('/public/drivers/verify-email-code',{
        method:'POST',body:JSON.stringify({email:reg.email.trim(),verificationCode:reg.verificationCode})
      });
      if(!result.verificationToken)throw new Error('Email confirmation is unavailable.');
      setRegVerificationToken(result.verificationToken);
      showToast('Email verified successfully.','success');
    }catch(error){setRegVerificationToken('');setRegEmailError(error.message||'Email verification failed.');showToast(error.message||'Email verification failed.','error');}
    finally{setVerifyingRegCode(false);}
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
      setApplicationIdentityType(data.identityKind||null);
      setManualEvidence(Object.fromEntries((data.documents||[]).map(doc=>[doc.kind,true])));
    }).catch(()=>{});
    return()=>{ignore=true;};
  },[manualApplicationToken]);

  const saveApplicationIdentityType=async(identityKind)=>{
    if(!manualApplicationToken)return false;
    setIdentityTypeSaving(true);
    try{
      await apiFetch('/public/drivers/identity-type',{
        method:'POST',headers:{Authorization:'Bearer '+manualApplicationToken},
        body:JSON.stringify({identityKind})
      });
      setApplicationIdentityType(identityKind);
      return true;
    }catch(error){
      showToast(error.message||'Unable to save identity document choice.','error');
      return false;
    }finally{setIdentityTypeSaving(false);}
  };

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
    if (!reg.name || !reg.phone || !reg.email || !reg.password || !regVerificationToken) { showToast('Verify your email and complete the required details.', 'warning'); return; }
    if (regCodeSentTo !== reg.email.trim().toLowerCase()) { showToast('Request a verification code for this email first.', 'warning'); return; }
    if (reg.password.length < 10) { showToast('Password must be at least 10 characters.', 'warning'); return; }
    if (!reg.privacyAccepted) { showToast('Review and acknowledge the application privacy notice.', 'warning'); return; }
    try {
      setRegSubmitting(true);
      const res = await apiFetch('/public/drivers/register', { method: 'POST', body: JSON.stringify({...reg,verificationToken:regVerificationToken}) });
      showToast(res.message || 'Application submitted for restaurant review.', 'success');
      if(res.applicationToken) {
        sessionStorage.setItem('gastrodriver_manual_application',res.applicationToken);
        setManualApplicationToken(res.applicationToken);
        setManualVehicleType(reg.vehicleType);
        setManualEvidence({});
        setApplicationIdentityType(null);
        // Keep the locally previewed selfie so the rider can consent and
        // securely confirm its upload on the first document step.
        setManualConsent(false);
      }
      if(res.identityVerificationUrl) setIdentityVerificationLink(res.identityVerificationUrl);
      if(res.licenceVerificationUrl) setLicenceVerificationLink(res.licenceVerificationUrl);
      setShowRegModal(false);
      setRegCodeSentTo('');
      setRegVerificationToken('');
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
  const matchesOrderSearch = (order) => {
    const needle=orderSearch.trim().toLocaleLowerCase();
    if(!needle) return true;
    return [order.id,order.customerName,order.deliveryAddress,order.status]
      .some(value=>String(value ?? '').toLocaleLowerCase().includes(needle));
  };
  const filteredOrders=visibleOrders.filter(matchesOrderSearch);
  const filteredAvailableOrders=availableOrders.filter(matchesOrderSearch);
  const loadDriverSupport=async()=>{
    if(!driver || supportBusy)return;
    const epoch=++supportRequestEpochRef.current,owner=driver.id;
    setSupportBusy(true);setSupportError('');
    try{
      const data=await apiFetch('/public/driver/support',{cache:'no-store'});
      if(epoch!==supportRequestEpochRef.current || owner!==driverStatusIdentityRef.current)return;
      setSupportHistory(Array.isArray(data.requests)?data.requests:[]);
    }catch(error){
      if(epoch===supportRequestEpochRef.current)setSupportError(error.message||'Unable to load support requests.');
    }finally{if(epoch===supportRequestEpochRef.current)setSupportBusy(false);}
  };
  const submitDriverSupport=async(event)=>{
    event.preventDefault();
    if(!driver || supportBusy)return;
    const epoch=++supportRequestEpochRef.current,owner=driver.id;
    setSupportBusy(true);setSupportError('');
    try {
      const result=await apiFetch('/public/driver/support',{
        method:'POST',body:JSON.stringify({category:supportCategory,message:supportMessage.trim(),orderId:supportOrderId.trim()||null})
      });
      if(epoch!==supportRequestEpochRef.current || owner!==driverStatusIdentityRef.current)return;
      setSupportHistory(previous=>[result.request,...previous]);
      setSupportMessage('');setSupportOrderId('');
      showToast('Support request saved. You can review it below.','success');
    }catch(error){
      if(epoch===supportRequestEpochRef.current)setSupportError(error.message||'Unable to save support request.');
    }finally{if(epoch===supportRequestEpochRef.current)setSupportBusy(false);}
  };
  const goToDriverScreen=(target, tab='active')=>{
    setDriverScreen(target);
    if(target==='home') setTaskTab('active');
    if(target==='orders') setTaskTab(tab);
    window.scrollTo({top:0,behavior:'instant'});
  };
  const dispatchFresh = !dispatchSyncError && dispatchLastSynced !== null
    && driverClock - dispatchLastSynced <= 25000;
  const dispatchHealthLabel = dispatchSyncError ? 'Dispatch connection interrupted'
    : !dispatchLastSynced ? 'Connecting to dispatch'
    : dispatchFresh ? 'Dispatch connected'
    : 'Dispatch update delayed';
  const hasFreshLocation = isGpsActive && gpsQuality === 'good' && validDriverFix(lastCoords,driverClock);
  const isServerConfirmedLocation = hasFreshLocation && gpsUploadStatus==='accepted';
  const routeRequest = useRef(requestRoadEstimate);
  useEffect(()=>{routeRequest.current=requestRoadEstimate;});
  const showLiveRoute = driverScreen==='orders' && taskTab==='active' && hasFreshLocation &&
    activeOrders.some(order=>order.id===mapOrder && ['picked_up','out_for_delivery','arrived'].includes(order.status));
  useEffect(()=>{
    if(!showLiveRoute)return;
    const refresh=()=>{if(!document.hidden && navigator.onLine!==false)routeRequest.current(mapOrder);};
    refresh();
    const timer=setInterval(refresh,20000);
    return ()=>clearInterval(timer);
  },[showLiveRoute,mapOrder]);
  const locationLabel = gpsQuality === 'denied' ? 'Location permission denied'
    : !isGpsActive ? 'Location sharing is off'
    : gpsQuality === 'searching' ? 'Finding an accurate location'
    : !hasFreshLocation ? 'Location unavailable or outdated'
    : activeOrders.length && gpsUploadStatus==='failed' ? 'GPS upload failed · customer tracking delayed'
    : activeOrders.length && !isServerConfirmedLocation ? 'GPS accurate · awaiting server confirmation'
    : isServerConfirmedLocation ? 'Location accepted for customer tracking'
    : 'Accurate GPS available · no active delivery to share';
  const locationHelp = gpsQuality === 'denied' ? 'Allow location access in iPhone Settings, then try sharing again.'
    : !isGpsActive ? 'Enable location only when you are ready to share it for delivery operations.'
    : !hasFreshLocation ? 'Keep Location Services enabled and use a clear GPS signal. The app will not treat an old fix as live.'
    : activeOrders.length && gpsUploadStatus==='failed' ? 'The location was not accepted by the server. Keep the app open, check your connection and retry a new GPS fix.'
    : `Last fix ${Math.max(0,Math.round((driverClock-lastCoords.recordedAt)/1000))} seconds ago · ±${Math.round(lastCoords.accuracyMeters)} m accuracy`;

  return (
    <div className={`driver-app-shell ${accessibility.largeText?'driver-large-text':''} ${accessibility.highContrast?'driver-high-contrast':''} ${accessibility.reducedMotion?'driver-reduced-motion':''} ${isDark?'driver-theme-dark':'driver-theme-light'}`}><ConnectionStatus/>
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
            {manualApplicationToken && <RiderEvidenceWizard
              evidence={manualEvidence} vehicleType={manualVehicleType}
              identityType={applicationIdentityType} savingIdentityType={identityTypeSaving}
              onIdentityChange={saveApplicationIdentityType}
              consent={manualConsent} setConsent={setManualConsent} uploading={manualUploading}
              onUpload={submitManualEvidence} selfieCandidate={selfieCandidate}
              onSelfieCapture={handleSelfieCapture} onClearSelfie={clearSelfieCapture}
            />}
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
          <div className="driver-workspace">
            {driverScreen === 'home' && <>
            <section className="driver-welcome driver-welcome-compact driver-home-greeting"><span>GASTRODRIVER · TODAY</span><h1>Hi, {driver.name?.split(' ')[0]}.</h1></section>
            <div className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}><div><strong>{driver.status === 'offline' ? 'Offline — no new delivery offers' : 'Online — available for dispatch'}</strong><div style={{ fontSize:12, color:'var(--text-muted)', marginTop:5 }}>Current deliveries remain assigned even when you stop accepting new work.</div></div><button type="button" className="btn-emerald" onClick={updateAvailability} disabled={availabilityLoading}>{availabilityLoading ? 'Updating…' : driver.status === 'offline' ? 'Go online' : 'Go offline'}</button></div>
            <section className="driver-home-focus" aria-label="Current delivery">
              <div className="driver-home-focus-header"><strong>{activeOrders.length ? tx('currentDelivery') : tx('nextDelivery')}</strong><span>{activeOrders.length ? `${activeOrders.length} assigned` : tx('noJob')}</span></div>
              {activeOrders.length > 0 ? <>
                <div className="driver-home-order-line"><span>Order #{String(activeOrders[0].id).slice(-4).toUpperCase()}</span><strong>{String(activeOrders[0].status||'assigned').replace(/_/g,' ')}</strong></div>
                <p className="driver-home-destination"><MapPin size={17} aria-hidden="true"/>{activeOrders[0].deliveryAddress || 'Customer destination not yet provided'}</p>
                <div className="driver-home-focus-actions">
                  <button type="button" className="btn-emerald" onClick={()=>goToDriverScreen('orders','active')}><PackageCheck size={18} aria-hidden="true"/> {tx('openDelivery')}</button>
                  <button type="button" className="btn-outline" onClick={()=>goToDriverScreen('orders','available')}>Other pickups</button>
                </div>
              </> : <>
                <p className="driver-home-destination">Assigned deliveries appear here when you accept a pickup.</p>
                <button type="button" className="btn-emerald" onClick={()=>goToDriverScreen('orders','available')}><Navigation size={17} aria-hidden="true"/> Browse available pickups ({availableOrders.length})</button>
              </>}
            </section>
            <nav className="driver-quick-nav" aria-label="Quick delivery actions">
              <button type="button" onClick={()=>goToDriverScreen('orders','active')}>My route <strong>{activeOrders.length}</strong></button>
              <button type="button" onClick={()=>goToDriverScreen('orders','available')}>Available <strong>{availableOrders.length}</strong></button>
              <button type="button" onClick={()=>goToDriverScreen('orders','history')}>Completed <strong>{summary.completedToday}</strong></button>
            </nav>
            </>}
            {(driverScreen === 'home' || driverScreen === 'orders') && <>
            <div className={`driver-dispatch-sync ${dispatchFresh ? 'driver-dispatch-healthy' : 'driver-dispatch-stale'}`} role="status" aria-live="polite">
              <div className="driver-dispatch-copy"><strong>{dispatchHealthLabel}</strong><span>{dispatchLastSynced ? 'Last confirmed '+new Date(dispatchLastSynced).toLocaleTimeString() : 'Waiting for first update'}{!dispatchFresh && dispatchLastSynced ? ' · Displayed orders may be outdated' : ''}</span></div>
              <button type="button" onClick={fetchDriverOrders} disabled={loading}>{loading ? 'Checking…' : dispatchFresh ? 'Refresh' : 'Retry connection'}</button>
            </div>
            </>}
            {driverScreen === 'profile' && <>
            <h2 className="driver-screen-heading">Profile &amp; location</h2>
            <section className="card driver-verification-summary" aria-label="My rider verification">
              <h3>Account &amp; licence verification</h3>
              {profileLoading && <p role="status">Checking your restaurant verification record…</p>}
              {profileError && <p role="alert" className="driver-cash-error">{profileError}</p>}
              {ownDriverProfile && <>
                <dl>
                  <div><dt>Account</dt><dd>{ownDriverProfile.status||'Not available'}</dd></div>
                  <div><dt>Application review</dt><dd>{ownDriverProfile.manualReviewStatus||'No manual review on record'}</dd></div>
                  <div><dt>Licence</dt><dd>{ownDriverProfile.licenseReviewRequired
                    ? (ownDriverProfile.licenseVerifiedUntil && Number(ownDriverProfile.licenseVerifiedUntil)>Date.now() ? 'Manager verified' : 'Review required or expired')
                    : 'No outstanding licence review requirement on record'}</dd></div>
                  {ownDriverProfile.licenseVerifiedUntil && <div><dt>Licence verified until</dt><dd>{new Date(Number(ownDriverProfile.licenseVerifiedUntil)).toLocaleDateString()}</dd></div>}
                  {ownDriverProfile.licenseVerifiedClass && <div><dt>Verified class</dt><dd>{ownDriverProfile.licenseVerifiedClass}</dd></div>}
                  {ownDriverProfile.email && <div><dt>Registered email</dt><dd>{ownDriverProfile.email}</dd></div>}
                </dl>
                <p>Restaurant management controls approval and document reviews. Sensitive identity files are not shown here.</p>
              </>}
            </section>
            <section className="card driver-preferences" aria-label="Driver display and language settings">
              <h3>{tx('settings')}</h3>
              <label htmlFor="driver-ui-language"><span><strong>{tx('language')}</strong><small>Core navigation and settings. Operational screens are not yet fully translated.</small></span>
                <select id="driver-ui-language" value={driverLanguage}
                  onChange={event=>setDriverPreference('language',event.target.value)}>
                  <option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option>
                </select>
              </label>
              <label htmlFor="driver-ui-theme"><span><strong>{tx('theme')}</strong><small>Choose your device theme or set a light/dark appearance.</small></span>
                <select id="driver-ui-theme" value={driverTheme}
                  onChange={event=>setDriverPreference('theme',event.target.value)}>
                  <option value="system">{tx('system')}</option><option value="light">{tx('light')}</option><option value="dark">{tx('dark')}</option>
                </select>
              </label>
            </section>
            <section className="card driver-preferences" aria-label="Driver notification preferences">
              <h3>{tx('preferences')}</h3>
              <label><span><strong>{tx('sound')}</strong><small>Play an audible alert when new pickup offers appear while the app is open. Phone silent-mode rules still apply.</small></span>
                <input type="checkbox" checked={soundAlertsEnabled} onChange={toggleSoundAlerts} aria-label="Enable delivery alert sounds"/>
              </label>
              <p>Preferences are saved for this rider on this device. Native background push notifications require separate device permission and Firebase configuration.</p>
            </section>
            <section className="card driver-preferences" aria-label="Driver accessibility settings">
              <h3>{tx('accessibility')}</h3>
              {[
                ['largeText',tx('largeText'),'Increase text size across driver cards and actions.'],
                ['highContrast',tx('highContrast'),'Strengthen card borders and labels for easier reading.'],
                ['reducedMotion',tx('reducedMotion'),'Disable decorative animations and smooth transitions.']
              ].map(([name,label,help])=><label key={name}>
                <span><strong>{label}</strong><small>{help}</small></span>
                <input type="checkbox" checked={accessibility[name]}
                  onChange={event=>changeAccessibility(name,event.target.checked)} aria-label={label}/>
              </label>)}
            </section>
            <div className={`driver-location-health ${hasFreshLocation ? 'good' : 'needs-attention'}`} role="status" aria-live="polite"><div className="driver-location-health-head"><strong>Location health</strong><span>{locationLabel}</span></div><p>{locationHelp}</p></div>
            </>}
            {driverScreen === 'home' && <div className="driver-metrics"><div><small>Active deliveries</small><strong>{activeOrders.length}</strong></div><div><small>Completed today</small><strong>{summary.completedToday}</strong></div><div><small>Available pickups</small><strong>{availableOrders.length}</strong></div></div>}
            {driverScreen === 'profile' && <>

            <div className="card driver-controls-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: '#ffffff' }}>
              <div>
                <div className="driver-profile-name"><Bike size={20} aria-hidden="true"/> <span>{driver.name}</span></div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {driver.vehicleType || 'Motorbike'} ({driver.plateNumber || 'Active'}) · {hasFreshLocation ? `Device location ±${Math.round(lastCoords.accuracyMeters)}m · ${new Date(lastCoords.recordedAt).toLocaleTimeString()}` : locationLabel}
                </div>
              </div>
              <div className="driver-controls-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => { playDriverAlertRingtone(true); showToast('Playing delivery notification sound test.', 'info'); }}
                  className="btn-outline"
                  style={{ padding: '8px 12px', fontSize: '0.9rem' }}
                  title="Test Delivery Ringer Sound"
                >
                  <Bell size={18} aria-hidden="true"/><span>Test sound</span>
                </button>
                {discoveryPilotEnabled&&<label style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}>
                  <input type="checkbox" checked={discoveryConsent} onChange={toggleDiscoveryConsent}
                    disabled={!isGpsActive||driver?.status==='offline'} />
                  Visible to restaurant dispatch while on duty
                </label>}
                <button onClick={toggleGps} className="btn-emerald"
                  style={{ padding: '8px 14px', borderRadius: 20, fontSize: '0.8rem', background: isGpsActive ? '#10b981' : '#64748b' }}>
                  <MapPin size={18} aria-hidden="true"/><span>{isGpsActive ? (hasFreshLocation ? (isServerConfirmedLocation ? 'Location sharing confirmed' : 'GPS ready · verifying upload') : 'Location on · no reliable fix') : 'Share location'}</span>
                </button>
                <button type="button" onClick={handleLogout} className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.9rem' }} title="Sign out"><LogOut size={18} aria-hidden="true"/><span>Sign out</span></button>
              </div>
            </div>
            <section className="driver-support card" aria-label="Driver support">
              <h3>Support &amp; safety</h3>
              <p>Send a request to your restaurant's support records. This is not an emergency-response service.</p>
              <form onSubmit={submitDriverSupport}>
                <label htmlFor="driver-support-category">Issue type</label>
                <select id="driver-support-category" value={supportCategory} onChange={e=>setSupportCategory(e.target.value)}>
                  <option value="delivery">Delivery problem</option>
                  <option value="payment">Payment or settlement</option>
                  <option value="safety">Safety concern</option>
                  <option value="account">Account or verification</option>
                  <option value="other">Other issue</option>
                </select>
                <label htmlFor="driver-support-order">Assigned order ID (optional)</label>
                <input id="driver-support-order" value={supportOrderId} maxLength={128} onChange={e=>setSupportOrderId(e.target.value)} placeholder="Exact order ID"/>
                <label htmlFor="driver-support-message">Describe the issue</label>
                <textarea id="driver-support-message" value={supportMessage} maxLength={1000} rows={4} required minLength={12} onChange={e=>setSupportMessage(e.target.value)} placeholder="What happened, and what assistance do you need?"/>
                <button type="submit" className="btn-emerald" disabled={supportBusy || supportMessage.trim().length<12}>{supportBusy?'Saving…':'Save support request'}</button>
              </form>
              {supportError && <p role="alert" className="driver-support-error">{supportError}</p>}
              <div className="driver-support-history">
                <div className="driver-support-history-head"><strong>My requests</strong><button type="button" className="btn-outline" disabled={supportBusy} onClick={loadDriverSupport}>{supportBusy?'Loading…':'Refresh'}</button></div>
                {supportHistory.length ? <ul>{supportHistory.map(request=><li key={request.id}><strong>{String(request.category||'other').replace(/_/g,' ')} · {String(request.status||'open').replace(/_/g,' ')}</strong><span>{request.message}</span>{request.managerReply && <div className="driver-support-reply"><strong>Restaurant response</strong><span>{request.managerReply}</span><small>{request.repliedAt ? new Date(request.repliedAt).toLocaleString() : ''}</small></div>}</li>)}</ul> : <p>Refresh to view saved requests for this driver.</p>}
              </div>
              <p className="driver-support-emergency">For immediate danger, contact local emergency services directly. A saved support request is not monitored as an emergency channel.</p>
            </section>

            </>}
            {driverScreen === 'earnings' && <>
            <h2 className="driver-screen-heading">Cash &amp; earnings</h2>
            <section className="driver-approved-earnings card" aria-label="Restaurant-approved rider earnings">
              <h3>Approved delivery earnings</h3>
              <p>Only amounts explicitly approved by your restaurant appear here. Customer cash and delivery fees are not your wages.</p>
              {earningsLoading && <p role="status">Loading approved earnings…</p>}
              {earningsError && <p role="alert" className="driver-cash-error">{earningsError}</p>}
              {approvedEarnings && !earningsLoading && <>
                <strong className="driver-approved-total">Rs. {(approvedEarnings.totalApprovedCents/100).toFixed(2)}</strong>
                <small>{approvedEarnings.totalApprovedDeliveries||0} approved deliveries · LKR</small>
                {Number.isSafeInteger(approvedEarnings.todayApprovedCents) && Number.isSafeInteger(approvedEarnings.last7DaysApprovedCents) && (
                  <div className="driver-earnings-breakdown">
                    <div><span>Approved today ({approvedEarnings.timeZone||'restaurant time'})</span><strong>Rs. {(approvedEarnings.todayApprovedCents/100).toFixed(2)}</strong></div>
                    <div><span>Approved in the last 7 days</span><strong>Rs. {(approvedEarnings.last7DaysApprovedCents/100).toFixed(2)}</strong></div>
                  </div>
                )}
                {Number.isSafeInteger(approvedEarnings.recordedPaidCents) && Number.isSafeInteger(approvedEarnings.outstandingCents) && (
                  <div className="driver-earnings-breakdown">
                    <div><span>Manager-recorded external payouts</span><strong>Rs. {(approvedEarnings.recordedPaidCents/100).toFixed(2)}</strong></div>
                    <div><span>Outstanding approved earnings</span><strong>Rs. {(approvedEarnings.outstandingCents/100).toFixed(2)}</strong></div>
                  </div>
                )}
                <ul>{approvedEarnings.entries.slice(0,20).map(entry=><li key={entry.orderId}><span>Order #{String(entry.orderId).slice(-8)} · {entry.payoutId?'Manager-recorded paid':'Approved, not yet recorded paid'}</span><strong>Rs. {(entry.amountCents/100).toFixed(2)}</strong></li>)}</ul>
                {!approvedEarnings.entries.length && <p>No delivery compensation approved yet. Ask your restaurant manager about your agreed rate.</p>}
              </>}
              <p className="driver-earnings-payout-note">GastroFlow does not transfer money. A recorded payout means your restaurant manager declared an external payment and saved a reference; it does not independently verify a bank or cash transfer. Contact your manager about discrepancies.</p>
            </section>
            <section className="driver-settlement card" aria-label="Driver cash settlement">
              <div className="driver-settlement-head">
                <div><strong>Cash settlement</strong><p>Collected customer cash, not driver earnings or payout.</p></div>
                <button type="button" className="btn-outline" aria-expanded={cashDetailsOpen} aria-controls="driver-cash-details" onClick={() => {
                  const next=!cashDetailsOpen;setCashDetailsOpen(next);
                  if(next) void loadCashSummary();
                }}>{cashDetailsOpen ? 'Hide details' : 'View cash details'}</button>
              </div>
              {cashDetailsOpen && <div id="driver-cash-details">
                {cashLoading && <p role="status">Loading verified cash figures…</p>}
                {cashError && <p role="alert" className="driver-cash-error">{cashError}</p>}
                {cashSummary && !cashLoading && <>
                  <div className="driver-cash-grid">
                    <div><small>Received from customers</small><strong>Rs. {(cashSummary.cashReceivedCents/100).toFixed(2)}</strong></div>
                    <div><small>Pending manager handover</small><strong>Rs. {(cashSummary.cashHandoverPendingCents/100).toFixed(2)}</strong></div>
                    <div><small>Already handed over</small><strong>Rs. {(cashSummary.cashHandedOverCents/100).toFixed(2)}</strong></div>
                  </div>
                  <p className="driver-cash-footnote">{cashSummary.deliveredCodOrders} confirmed cash deliveries. Figures show recorded settlement state, not payment to the driver.</p>
                </>}
                <button type="button" className="btn-outline driver-cash-refresh" disabled={cashLoading} onClick={loadCashSummary}>{cashLoading ? 'Refreshing…' : 'Refresh cash summary'}</button>
              </div>}
            </section>
            {/* COD cash summary */}
            {cashToHandover > 0 && (
              <div className="card" style={{ marginTop: 16, padding: 14, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 700 }}>💰 Cash to hand over to manager</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#b45309' }}>Rs. {cashToHandover.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', color: '#a16207', marginTop: 2 }}>Settle at the counter — the manager confirms handover.</div>
              </div>
            )}

            </>}
            {driverScreen === 'orders' && <>
            <h2 className="driver-screen-heading">My deliveries</h2>
            <section role="status" aria-label="Live rider location health" style={{margin:'10px 0 16px',padding:'14px 16px',borderRadius:20,background:hasFreshLocation&&isServerConfirmedLocation?'#e9fbf2':'#fff8e8',border:'1px solid '+(hasFreshLocation&&isServerConfirmedLocation?'#b5e9d0':'#f2dab0'),color:'#153c32'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span aria-hidden="true" style={{display:'inline-block',width:10,height:10,borderRadius:'50%',background:isServerConfirmedLocation?'#159865':'#df9c32'}}/>
                  <div><strong style={{display:'block',fontSize:15}}>{isServerConfirmedLocation?'Live GPS sharing confirmed':'Delivery location needs attention'}</strong>
                    <small style={{display:'block',marginTop:3,color:'#536c61'}}>{locationLabel}</small></div>
                </div>
                <button type="button" onClick={toggleGps} disabled={driverStatusRef.current==='offline'&&!isGpsActive}
                  aria-label={isGpsActive?'Stop sharing delivery location':'Enable delivery location sharing'}
                  style={{border:0,borderRadius:14,padding:'12px 16px',background:isGpsActive?'#244c3e':'#087653',color:'white',fontWeight:800,cursor:'pointer'}}>
                  {isGpsActive?'Stop GPS':'Enable GPS'}
                </button>
              </div>
              {!isServerConfirmedLocation&&<p style={{margin:'9px 0 0',fontSize:12,lineHeight:1.5,color:'#6b5a3e'}}>{locationHelp} Customer tracking only works after this phone shares a fresh location accepted by the server.</p>}
            </section>
            {pendingOfflineUpdates.length>0 && <section className="card driver-offline-queue" aria-label="Saved offline progress updates">
              <h3>Progress waiting for server confirmation ({pendingOfflineUpdates.length})</h3>
              <p>These are saved on this device only. They do not change restaurant or customer order status until the server accepts them. Final handover evidence is never stored in this queue.</p>
              <ul>{pendingOfflineUpdates.map(update=><li key={update.orderId}>
                <span>Order #{String(update.orderId).slice(-8)} · {update.status.replace(/_/g,' ')}</span>
                <button type="button" className="btn-outline" disabled={retryingOfflineUpdates}
                  onClick={()=>discardOfflineUpdate(update.orderId)}>Discard</button>
              </li>)}</ul>
              <button type="button" className="btn-emerald" disabled={retryingOfflineUpdates || !navigator.onLine}
                onClick={retryOfflineUpdates}>{retryingOfflineUpdates?'Checking updates…':'Review and retry saved updates'}</button>
              {offlineRetryError && <p role="alert">{offlineRetryError}</p>}
            </section>}
            {driverScreen === 'orders' && <div id="driver-tasks" className="driver-task-nav" role="tablist" aria-label="Delivery view">{[['active', 'My route'], ['available', 'Available'], ['history', 'Completed']].map(([id, label]) => <button key={id} role="tab" aria-selected={taskTab === id} onClick={() => setTaskTab(id)}>{label}</button>)}</div>}
            {driverScreen === 'orders' && <div className="driver-order-search"><label htmlFor="driver-order-search-input">Find a delivery</label><div><input id="driver-order-search-input" className="input-field" type="search" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} placeholder="Order number, customer or address" autoComplete="off"/>{orderSearch && <button type="button" className="btn-outline" onClick={()=>setOrderSearch('')}>Clear</button>}</div></div>}
            {/* Available to claim */}
            {taskTab === 'available' && filteredAvailableOrders.length === 0 && <div className="driver-empty"><strong>{orderSearch.trim() ? 'No matching pickups.' : 'You’re all caught up.'}</strong>{orderSearch.trim() ? 'Try a different order number or clear your search.' : 'Available pickups will appear here automatically.'}</div>}
            {taskTab === 'available' && filteredAvailableOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '1.0rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
                  Available pickups ({filteredAvailableOrders.length})
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                  {filteredAvailableOrders.map(ord => {
                    const offerExpiry=Number(ord.offerExpiresAt)||null;
                    const secondsLeft=offerSecondsRemaining(offerExpiry,driverClock);
                    const timedOfferExpired=offerExpired(offerExpiry,driverClock);
                    // Pickup proximity requires the restaurant's configured pin.
                    // This is straight-line distance, not an OSRM driving ETA.
                    const pickupKm = (isGpsActive && gpsQuality==='good' && validDriverFix(lastCoords,driverClock) && pickupLocation)
                      ? haversineKm(lastCoords.lat,lastCoords.lng,pickupLocation.lat,pickupLocation.lng)
                      : null;

                    return (
                    <article key={ord.id} className="card driver-delivery-card" style={{ margin: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1rem' }}>Order #{ord.id.slice(-4).toUpperCase()}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            <MapPin size={15} aria-hidden="true"/> {ord.deliveryAddress || 'Customer address unavailable'} · Rs. {Number(ord.total||0).toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          {pickupKm === null && <span className="driver-distance-unavailable">Pickup distance unavailable · check restaurant pin and GPS</span>}
                          {pickupKm !== null && (
                            <span className="driver-pickup-distance"><MapPin size={14} aria-hidden="true"/>{pickupKm.toFixed(1)} km to restaurant · straight line</span>
                          )}
                          {isRushHour(restaurantTimeZone) && (
                            <span style={{ background: '#f59e0b22', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700 }}>⏰ Peak</span>
                          )}
                        </div>
                      </div>
                      {offerExpiry && <p className="driver-offer-countdown" role="status" aria-live="off">
                        <Clock3 size={16} aria-hidden="true"/>
                        {timedOfferExpired?'This individual offer has expired. Refresh orders.' : `Individual offer · ${secondsLeft} seconds remaining`}
                      </p>}
                      <div className="driver-offer-actions">
                        <button type="button" className="btn-emerald" disabled={driver.status === 'offline' || pendingOrderId !== null || !dispatchFresh || timedOfferExpired} onClick={() => handleClaim(ord.id)}>{driver.status === 'offline' ? 'Go online to claim' : !dispatchFresh ? 'Refresh dispatch to claim' : pendingOrderId===ord.id ? 'Working…' : 'Accept delivery'}</button>
                        <button type="button" className="btn-outline" disabled={driver.status === 'offline' || pendingOrderId !== null || !dispatchFresh || timedOfferExpired} onClick={() => handleDecline(ord.id)}>{pendingOrderId===ord.id ? 'Working…' : 'Decline offer'}</button>
                      </div>
                    </article>
                    );
                  })}
                </div>
              </>
            )}

            {taskTab !== 'available' && <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 24, marginBottom: 12 }}>
              {taskTab === 'history' ? 'Completed deliveries' : 'My route'} ({filteredOrders.length})
            </h3>

            {filteredOrders.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>{orderSearch.trim() ? 'No deliveries match your search. Clear the search to see all orders.' : taskTab === 'history' ? 'Completed deliveries will appear here.' : 'No active deliveries. Check Available for your next pickup.'}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {filteredOrders.map(ord => {
                  const itemsStr = Array.isArray(ord.items) ? ord.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Delivery Items';
                  const customerPhone = ord.customerPhone || 'N/A';
                  // Never offer a contact link for a missing or malformed customer number.
                  const phoneRaw = String(customerPhone).replace(/[\s().-]/g, '');
                  const internationalPhone = phoneRaw.startsWith('0') ? '94' + phoneRaw.slice(1) : phoneRaw.replace(/^\+/, '');
                  const waPhone = /^\d{8,15}$/.test(internationalPhone) ? internationalPhone : null;
                  const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${ord.customerName || 'Customer'}, I am your GastroFlow rider for Order #${String(ord.id).slice(-4).toUpperCase()}`)}` : null;
                  const hasDropCoordinates = ord.deliveryLat != null && ord.deliveryLng != null
                    && Number.isFinite(Number(ord.deliveryLat)) && Number.isFinite(Number(ord.deliveryLng))
                    && Math.abs(Number(ord.deliveryLat)) <= 90 && Math.abs(Number(ord.deliveryLng)) <= 180;
                  const navigatingToPickup = ['pending','confirmed','preparing','ready'].includes(ord.status) && pickupLocation;
                  const navLink = navigatingToPickup ? `https://www.google.com/maps/dir/?api=1&destination=${pickupLocation.lat},${pickupLocation.lng}` : hasDropCoordinates
                    ? `https://www.google.com/maps/dir/?api=1&destination=${Number(ord.deliveryLat)},${Number(ord.deliveryLng)}`
                    : ord.deliveryAddress?.trim()
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.deliveryAddress)}`
                      : null;
                  const progressStage = ord.status === 'delivered' ? 5
                    : ord.status === 'arrived' ? 4
                    : ord.status === 'out_for_delivery' ? 3
                    : ord.status === 'picked_up' ? 2 : ord.status === 'ready' ? 1 : 0;
                  const nextStep = ord.status === 'ready' ? 'Confirm collection from the restaurant before starting delivery.'
                    : ord.status === 'picked_up' ? 'Order collected. Start the trip when leaving the restaurant.'
                    : ord.status === 'out_for_delivery' ? 'Once you reach the customer, confirm arrival before handover.'
                    : ord.status === 'arrived' ? 'You are at the destination. Collect any required payment and save delivery proof.'
                    : ord.status === 'delivered' ? 'This delivery has been completed.'
                    : 'Wait until the restaurant marks the order ready for pickup.';

                  return (
                    <article key={ord.id} className="card driver-delivery-card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--text-main)' }}>Order #{ord.id.slice(-4).toUpperCase()}</span>
                        <span style={{ background: ord.status === 'delivered' ? '#d1fae5' : ord.status === 'out_for_delivery' ? '#dbeafe' : '#fef3c7', color: ord.status === 'delivered' ? '#065f46' : ord.status === 'out_for_delivery' ? '#1e40af' : '#92400e', padding: '4px 10px', borderRadius: 12, fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {ord.status?.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <ol className="driver-progress-steps" aria-label="Delivery progress">
                        {['Ready', 'Picked up', 'On the way', 'Arrived', 'Delivered'].map((label, index) => <li key={label} className={progressStage >= index + 1 ? 'complete' : ''} aria-current={progressStage === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
                      </ol>
                      <div className="driver-next-step"><strong>Next step</strong><span>{nextStep}</span></div>
                      <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="driver-order-detail"><User size={16} aria-hidden="true"/><strong>{ord.customerName || 'Customer'}</strong></div>
                        <div className="driver-order-detail"><Phone size={16} aria-hidden="true"/><strong>{customerPhone}</strong></div>
                        <div className="driver-order-detail"><MapPin size={16} aria-hidden="true"/><strong>{ord.deliveryAddress || 'Destination unavailable'}</strong></div>
                        <div className="driver-order-detail" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}><Package size={16} aria-hidden="true"/><span>{itemsStr}</span></div>
                        <div>{ord.paymentStatus === 'paid' ? 'Payment verified' : ['cash', 'cod'].includes(ord.paymentMethod) ? 'Cash to collect' : 'Awaiting payment confirmation'}: <strong style={{ color: 'var(--brand-emerald)', fontSize: '1rem' }}>Rs. {Number(ord.total).toFixed(2)}</strong> ({ord.paymentMethod || 'Unknown method'})</div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {ord.status !== 'delivered' && (progressStage<=1 ? pickupLocation : hasDropCoordinates) && <>
                          <button type="button" className="btn-outline" onClick={()=>setMapOrder(id=>id===ord.id?null:ord.id)}>{mapOrder===ord.id?'Close map':progressStage<=1?'View pickup map':'View delivery map'}</button>
                          {mapOrder===ord.id && <React.Suspense fallback={<p>Loading map…</p>}><DeliveryMap
                            key={ord.id+'-'+(progressStage<=1?'pickup':'customer')}
                            destination={progressStage<=1 && pickupLocation?[pickupLocation.lng,pickupLocation.lat]:[Number(ord.deliveryLng),Number(ord.deliveryLat)]}
                            fix={hasFreshLocation?lastCoords:null}
                            geometry={hasFreshLocation && progressStage>1 && driverClock-roadEstimates[ord.id]?.basedOnFixAt<=30000 ? roadEstimates[ord.id]?.geometry : null}/></React.Suspense>}
                        </>}
                        {navLink ? <a className="driver-order-action driver-order-navigate" href={navLink} target="_blank" rel="noopener noreferrer" aria-label={`Navigate to ${navigatingToPickup ? 'pickup' : 'customer drop-off'} for order ${String(ord.id).slice(-4)}`}><Navigation size={17} aria-hidden="true"/> {navigatingToPickup ? 'Restaurant pickup' : 'Customer drop-off'}</a> : <span className="driver-order-action-unavailable">Destination not provided</span>}
                        {waLink ? <a className="driver-order-action driver-order-contact" href={waLink} target="_blank" rel="noopener noreferrer" aria-label={`Contact customer for order ${String(ord.id).slice(-4)} using WhatsApp`}><MessageCircle size={17} aria-hidden="true"/> WhatsApp</a> : <span className="driver-order-action-unavailable">Customer contact unavailable</span>}
                        {hasDropCoordinates && ['picked_up','out_for_delivery','arrived'].includes(ord.status) && (
                          <div className="driver-road-eta">
                            <div><strong>Road travel estimate</strong><small>Road routing only · not a traffic-aware arrival guarantee</small></div>
                            <button type="button" className="btn-outline" disabled={roadLoadingId!==null}
                              onClick={()=>requestRoadEstimate(ord.id)}>{roadLoadingId===ord.id ? 'Calculating…' : roadEstimates[ord.id] ? 'Refresh estimate' : 'Check road ETA'}</button>
                            {roadEstimates[ord.id]?.available ? <p role="status">{roadEstimates[ord.id].distanceKm.toFixed(1)} km · about {roadEstimates[ord.id].travelMinutes} min driving</p>
                              : roadEstimates[ord.id] && <p role="status" className="driver-eta-unavailable">{roadEstimates[ord.id].message}</p>}
                          </div>
                        )}
                        {ord.status === 'ready' && (
                          <button type="button" className="btn-emerald" style={{ flex: '1 1 100%', padding: 12, fontSize: '0.85rem' }}
                            disabled={pendingOrderId!==null} onClick={() => handleUpdateStatus(ord.id, 'picked_up')}>
                            <Check size={17} aria-hidden="true"/>{pendingOrderId===ord.id ? 'Confirming pickup…' : 'Confirm order picked up'}
                          </button>
                        )}
                        {ord.status === 'picked_up' && (
                          <button type="button" className="btn-emerald" style={{ flex: '1 1 100%', padding: 12, fontSize: '0.85rem', background: '#2563eb' }}
                            disabled={pendingOrderId!==null} onClick={() => handleUpdateStatus(ord.id, 'out_for_delivery')}>
                            <Truck size={18} aria-hidden="true"/>{pendingOrderId===ord.id ? 'Updating delivery…' : 'Start delivery'}
                          </button>
                        )}
                        {ord.status === 'out_for_delivery' && (
                          <button type="button" className="btn-emerald" style={{ flex: '1 1 100%', padding: 12, fontSize: '0.85rem', background: '#2563eb' }}
                            disabled={pendingOrderId!==null} onClick={() => handleUpdateStatus(ord.id, 'arrived')}>
                            <MapPin size={17} aria-hidden="true"/>{pendingOrderId===ord.id ? 'Confirming arrival…' : 'Confirm arrived at customer'}
                          </button>
                        )}
                        {ord.status === 'arrived' && (
                          <button type="button" className="btn-emerald" style={{ flex: '1 1 100%', padding: 12, fontSize: '0.85rem' }}
                            disabled={pendingOrderId!==null} onClick={() => setSelectedDeliveryOrder(ord)}>
                            <CircleCheck size={18} aria-hidden="true"/> Complete handover
                          </button>
                        )}
                        {ord.status === 'delivered' && (ord.proofSavedAt ? <button className="btn-outline" onClick={async () => {
                          try { setProofPreview(await apiFetch(`/public/driver/orders/${encodeURIComponent(ord.id)}/proof`)); }
                          catch (error) { showToast(error.message, 'error'); }
                        }}>View saved proof</button> : <span>Legacy delivery: no proof recorded</span>)}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            </>}
            </>}
            <nav className="driver-bottom-nav" aria-label="Driver app navigation">
              {[['home',tx('home'),House],['orders',tx('orders'),ClipboardList],['earnings',tx('cash'),Wallet],['profile',tx('profile'),UserRound]].map(([id,label,Icon])=>
                <button type="button" key={id} className={driverScreen===id?'selected':''}
                  aria-current={driverScreen===id?'page':undefined} onClick={()=>goToDriverScreen(id)}>
                  <Icon size={20} strokeWidth={driverScreen===id?2.6:2}/><span>{label}</span>
                  {id==='orders' && availableOrders.length>0 && <small aria-label={`${availableOrders.length} available pickups`}>{availableOrders.length>99?'99+':availableOrders.length}</small>}
                </button>)}
            </nav>
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

        {/* Guided registration: email → profile → vehicle → review. Server validates OTP on submission. */}
        {showRegModal && <RiderRegistrationWizard
          reg={reg} setReg={setReg} restaurant={selectedHiringRestaurant}
          onSendCode={handleSendRegCode} codeSentTo={regCodeSentTo}
          sendingCode={sendingRegCode} onVerifyCode={handleVerifyRegCode}
          verifyingCode={verifyingRegCode} verificationToken={regVerificationToken}
          emailError={regEmailError} onClearEmailError={()=>setRegEmailError('')}
          selfieCandidate={selfieCandidate} onSelfieCapture={handleSelfieCapture} onClearSelfie={clearSelfieCapture}
          onSubmit={handleRegisterSubmit}
          submitting={regSubmitting} onClose={()=>{setShowRegModal(false);clearSelfieCapture();}}
        />}
      
      </main>
    </div>
  );
}
