import { platformPublisher } from '../../../../shared/platform-brand.js';
import { getActiveTenant } from '../utils/tenant.js';
import { AnimatedFeatureIcon } from '../../../../shared/ui/AnimatedFeatureIcon.jsx';
import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { selectTrackableOrders } from '../utils/gastromate-tracking.js';
import CustomerTripScreen from '../components/CustomerTripScreen.jsx';
import {orderPriceBreakdown} from '../utils/order-price-breakdown.js';
import RiderChatSheet from '../components/RiderChatSheet.jsx';
import DeliveryPulseCard from '../components/DeliveryPulseCard.jsx';
import {contactLinks} from '../utils/contact-actions.js';
import { canUseHostedOrderStream, canUseHostedWebPush } from '../utils/native-tracking-policy.js';
import { shouldRefreshNativeTrackingOnResume } from '../utils/native-tracking-resume.js';
import {trackingProgress,trackingHeroMessage,trackingEtaMinutes,normalizeDriverFix,isNewerDriverFix,driverFreshness,validGeoPoint,shouldClearRiderMarker,shouldRefreshOnStreamReconnect,shouldPollTrackingSnapshot,TRACKING_UPDATE_STALE_MS,createTrackingSnapshotGate} from '../utils/tracking-presentation.js';
import {shouldRetainTrackedOrder,shouldClearTrackedOrder} from '../../../driver-web/src/utils/dispatch-sync.js';

export default function OrderTrackingView({ orderId, onSupport, onSelectOrder, onBack, toast = () => {} }) {
  const { t, dict: tr } = useLang();
  const isPackagedNative = import.meta.env.MODE === 'native';
  const {customer, getToken} = useCustomerAuth();
  const token = getToken();
  const [recent, setRecent] = useState(null);
  useEffect(() => {
    if (!customer || !token || orderId) return;
    const controller = new AbortController();
    apiFetch('/customer/orders', {headers:{Authorization:`Bearer ${token}`}, signal:controller.signal, cache:'no-store'})
      .then(data => {
        if (!controller.signal.aborted) setRecent({customer, choices:selectTrackableOrders(data)});
      })
      .catch(() => { if (!controller.signal.aborted) setRecent(null); });
    return () => controller.abort();
  }, [customer, token, orderId]);
  const [trackId, setTrackId] = useState(orderId || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingMins, setRemainingMins] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [handoverPin,setHandoverPin]=useState(null);
  const [handoverPinBusy,setHandoverPinBusy]=useState(false);
  const [handoverPinError,setHandoverPinError]=useState('');
  useEffect(()=>{setHandoverPin(null);setHandoverPinError('');},[order?.id]);
  const requestHandoverPin=async()=>{
    if(!order?.id||handoverPinBusy)return;
    setHandoverPinBusy(true);setHandoverPinError('');
    try{
      const data=await apiFetch(`/public/orders/${encodeURIComponent(order.id)}/handover-pin`,{method:'POST',cache:'no-store'});
      if(!/^[0-9]{6}$/.test(String(data.pin||''))||!Number.isFinite(Number(data.expiresAt)))
        throw new Error('Invalid handover code response.');
      setHandoverPin({orderId:order.id,pin:data.pin,expiresAt:data.expiresAt});
    }catch(error){setHandoverPinError(error.message||'Could not generate delivery handover code.');}
    finally{setHandoverPinBusy(false);}
  };
  const [storeInfo, setStoreInfo] = useState(null);   // { lat, lng, name, ... }
  const [driverLoc, setDriverLoc] = useState(null);    // live { lat, lng, driverName }
  const [driverLastSeen,setDriverLastSeen]=useState(null);
  const [nowClock,setNowClock]=useState(Date.now());
  useEffect(() => { const id=window.setInterval(()=>setNowClock(Date.now()),10000); return ()=>window.clearInterval(id); },[]);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushEnabled,setPushEnabled]=useState(false);
  const [lastUpdate,setLastUpdate]=useState(null);
  const [streamConnected,setStreamConnected]=useState(false);
  const driverFixRef=useRef(null);
  const activeTrackedIdRef=useRef(null);
  const trackingGateRef=useRef(createTrackingSnapshotGate());
  const streamHealthyRef=useRef(false);
  const lastSnapshotRef=useRef(null);
  const [connectionWarning,setConnectionWarning]=useState('');
  const [stageAnnouncement,setStageAnnouncement]=useState('');
  useEffect(()=>{
    if(!stageAnnouncement)return;
    const timer=window.setTimeout(()=>setStageAnnouncement(''),4500);
    return ()=>window.clearTimeout(timer);
  },[stageAnnouncement]);

  // Uber Eats-grade Dynamic ETA & Live Driver Chat states
  const [dynamicETA, setDynamicETA] = useState(null);
  const [roadRoute,setRoadRoute]=useState(null);
  const [driverChatOpen, setDriverChatOpen] = useState(false);
  const [journeySheet,setJourneySheet]=useState('compact');
  const journeyTouchStart=useRef(null);
  const onJourneyTouchStart=event=>{
    if(event.target.closest('button, a, input, textarea, select')){journeyTouchStart.current=null;return;}
    journeyTouchStart.current=event.touches[0]?.clientY??null;
  };
  const onJourneyTouchEnd=event=>{
    const from=journeyTouchStart.current;
    journeyTouchStart.current=null;
    if(from===null)return;
    const delta=(event.changedTouches[0]?.clientY??from)-from;
    if(Math.abs(delta)<55)return;
    const levels=['compact','half','full'];
    setJourneySheet(current=>levels[Math.min(2,Math.max(0,levels.indexOf(current)+(delta<0?1:-1)))]);
  };
  useEffect(()=>{setJourneySheet('compact');},[order?.id]);
  const receiptDetailsRef=useRef(null);
  const [driverMessages, setDriverMessages] = useState([]);
  const [driverInputMsg, setDriverInputMsg] = useState('');
  const [sendingDriverMsg, setSendingDriverMsg] = useState(false);

  // Bug 7 fix: keep a ref that always holds the current order so polling
  // intervals and SSE callbacks don't capture a stale closure value.
  const orderRef = useRef(null);

  // ── Real-time Driver Dispatch Status ──
  const [dispatchStatus, setDispatchStatus] = useState(null);

  // Load store info once
  useEffect(() => {
    apiFetch('/public/store-info').then(setStoreInfo).catch(() => {});
  }, []);

  // Fetch dynamic ETA
  useEffect(() => {
    let active = true;
    setDynamicETA(null);
    if (order && order.id) {
      apiFetch(`/public/orders/${order.id}/eta`)
        .then(result => { if (active) setDynamicETA(result); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [order?.id, order?.status]);

  // Optional dedicated routing provider: refresh only for active deliveries.
  useEffect(()=>{
    const id=order?.id;
    const type=String(order?.orderType||order?.diningType||'').toLowerCase();
    const status=String(order?.status||'').toLowerCase();
    if(!id || type!=='delivery' || ['cancelled','rejected','refunded','partially_refunded','completed','delivered'].includes(status)){setRoadRoute(null);return;}
    let disposed=false;
    let pending=false;
    let routeGeneration=0;
    const fetchRoute=()=>{
      // One request at a time avoids older road geometry replacing a newer journey.
      if(disposed || pending || document.visibilityState==='hidden' || navigator.onLine===false)return;
      pending=true;
      const generation=++routeGeneration;
      apiFetch(`/public/orders/${encodeURIComponent(id)}/road-route`,{cache:'no-store'}).then(data=>{
        if(!disposed && generation===routeGeneration)setRoadRoute(data?.available===true?data:null);
      }).catch(()=>{
        if(!disposed && generation===routeGeneration)setRoadRoute(null);
      }).finally(()=>{pending=false;});
    };
    setRoadRoute(null);
    fetchRoute();
    const timer=setInterval(fetchRoute,15000);
    const resume=()=>{if(document.visibilityState==='visible')fetchRoute();};
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',fetchRoute);
    return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',fetchRoute);};
  },[order?.id,order?.status,order?.orderType,order?.diningType]);

  // ── Poll Dispatch Status every 8 seconds ──
  useEffect(() => {
    if (!order || !order.id) return;
    const s = (order.status || '').toLowerCase();
    if (['completed','delivered','cancelled','rejected','refunded','partially_refunded'].includes(s)) return;

    const fetchDispatch = () => {
      apiFetch(`/public/orders/${order.id}/dispatch-status`)
        .then(setDispatchStatus)
        .catch(() => {});
    };
    fetchDispatch();
    const interval = setInterval(fetchDispatch, 8000);
    return () => clearInterval(interval);
  }, [order?.id, order?.status]);

  // Load & listen to Driver Chat messages
  const fetchDriverMessages = async (id) => {
    if (!id) return;
    try {
      const data = await apiFetch(`/orders/${encodeURIComponent(id)}/driver-chat`,{cache:'no-store'});
      // A delayed chat response from a previous order must never be shown
      // under the next order, even when switching tracked deliveries quickly.
      if(String(activeTrackedIdRef.current||'')!==String(id))return;
      if(Array.isArray(data))setDriverMessages(data.slice(-150));
    } catch (_) {
      // Keep already retrieved messages visible during temporary disconnects.
    }
  };
  useEffect(()=>{
    if(!driverChatOpen || !order?.id)return;
    const id=order.id;
    const refresh=()=>{if(document.visibilityState==='visible' && navigator.onLine!==false)void fetchDriverMessages(id);};
    refresh();
    const timer=window.setInterval(refresh,8000);
    const onVisible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('online',refresh);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{window.clearInterval(timer);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',onVisible);};
  },[driverChatOpen,order?.id]);

  const handleSendDriverMsg = async (e) => {
    e.preventDefault();
    if (!driverInputMsg.trim() || !order?.id) return;
    setSendingDriverMsg(true);
    try {
      await apiFetch(`/orders/${order.id}/driver-chat`, {
        method: 'POST',
        body: JSON.stringify({
          senderType: 'customer',
          senderName: order.customerName || 'Customer',
          message: driverInputMsg.trim()
        })
      });
      setDriverInputMsg('');
      void fetchDriverMessages(order.id);
    } catch (err) {
      toast(err.message || 'Failed to send message to driver', 'error');
    } finally {
      setSendingDriverMsg(false);
    }
  };

  // Star Rating feedback states
  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // ── High-Professional Customer Order Chime ──
  const playCustomerChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [
        { freq: 523.25, time: 0, duration: 0.20 },   // C5
        { freq: 659.25, time: 0.15, duration: 0.20 },  // E5
        { freq: 783.99, time: 0.30, duration: 0.40 }   // G5
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + time);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + time);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + time);
        osc.stop(ctx.currentTime + time + duration);
      });
    } catch (_) {}
  };

  const applyOrderUpdate = (update) => {
    if (update?.id && activeTrackedIdRef.current && String(update.id)!==String(activeTrackedIdRef.current)) return;
    let items = update.items ?? orderRef.current?.items ?? [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    const data = { ...orderRef.current, ...update, items: Array.isArray(items) ? items : [] };
    if (orderRef.current?.status && data.status !== orderRef.current.status) {
      const stage=trackingProgress(data.status, String(data.orderType||data.diningType||'').toLowerCase()==='delivery'?'delivery':'takeaway');
      const label=stage.terminal?'Order closed':stage.done?'Order completed':stage.steps[stage.currentIndex]?.label||'Order updated';
      setStageAnnouncement(label);
    }
    orderRef.current = data;
    setOrder(data);
    lastSnapshotRef.current=Date.now();
    setLastUpdate(lastSnapshotRef.current);
    const fix=normalizeDriverFix(data.driver);
    // An authoritative snapshot explicitly returning no assigned rider GPS
    // revokes the old marker. Event-only order updates omit driver entirely.
    if(shouldClearRiderMarker(update,fix)){
      driverFixRef.current=null;
      setDriverLoc(null);setDriverLastSeen(null);
    }else if(isNewerDriverFix(fix,driverFixRef.current)){
      driverFixRef.current=fix;setDriverLoc(fix);setDriverLastSeen(fix.updatedAt);
    }
  };

  const fetchOrder = async (id,{silent=false}={}) => {
    const request=trackingGateRef.current.start(id);
    if(!request)return;
    if (activeTrackedIdRef.current !== id) {
      activeTrackedIdRef.current=id;
      driverFixRef.current=null;orderRef.current=null;lastSnapshotRef.current=null;
      setDriverLoc(null);setDriverLastSeen(null);setDispatchStatus(null);setDynamicETA(null);setRoadRoute(null);setStageAnnouncement('');
      setDriverChatOpen(false);setDriverMessages([]);setRemainingMins(null);
    }
    if(!silent)setLoading(true);
    if(!silent)setError('');
    try {
      const data = await apiFetch(`/public/orders/${encodeURIComponent(id)}`,{signal:request.signal});
      if(!trackingGateRef.current.isCurrent(request)||activeTrackedIdRef.current!==id)return;
      applyOrderUpdate(data);
      setConnectionWarning('');
      setFeedbackSubmitted(false);
    } catch (err) {
      if(!trackingGateRef.current.isCurrent(request)||activeTrackedIdRef.current!==id)return;
      if(shouldClearTrackedOrder(err)){
        // A revoked/expired link or unknown order must not leave the previous
        // customer's private details on the screen or keep the SSE open.
        orderRef.current=null;
        driverFixRef.current=null;
        lastSnapshotRef.current=null;
        streamHealthyRef.current=false;
        setOrder(null);setDriverLoc(null);setDriverLastSeen(null);
        setDispatchStatus(null);setDynamicETA(null);setRoadRoute(null);
        setDriverChatOpen(false);setDriverMessages([]);
        setConnectionWarning('');
        if(Number(err?.status)===401)localStorage.removeItem('gastroflow_order_access_'+id);
        setError('This order tracking link is unavailable or has expired. Sign in to the owning account or open your original private order confirmation.');
      }else if(orderRef.current && shouldRetainTrackedOrder(err))setConnectionWarning('Connection interrupted. Showing the last confirmed order status.');
      else if(!orderRef.current){setError(err.message||'Unable to load order.');setOrder(null);}
      else setConnectionWarning('Unable to refresh this order. Please retry.');
    } finally {
      if(trackingGateRef.current.finish(request) && !silent)setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      setTrackId(orderId);
      fetchOrder(orderId);
    } else {
      // Moving from an order-specific AI deep link to the generic tracking
      // page must clear the previous customer's status and rider position.
      activeTrackedIdRef.current = null;
      trackingGateRef.current.invalidate();
      orderRef.current = null;
      driverFixRef.current = null;
      lastSnapshotRef.current = null;
      setTrackId('');
      setOrder(null);
      setDriverLoc(null);
      setDriverLastSeen(null);
      setDispatchStatus(null);
      setDynamicETA(null);
      setRoadRoute(null);
      setError('');
    }
  }, [orderId]);

  // Live SSE Stream Listener for instant updates + 5s polling fallback
  useEffect(() => {
    if (!order || !order.id) return;

    const status = (order.status || '').toLowerCase();
    if (['delivered','completed','cancelled','rejected','refunded','partially_refunded'].includes(status)) return;

    // SSE Stream setup
    let es;
    let missedConnection=false;
    try {
      // Native cross-origin SSE cannot rely on the PWA's Strict same-site cookie.
      // Poll with the existing private tracking token until a native stream is audited.
      if (!canUseHostedOrderStream(isPackagedNative)) throw new Error('Use authenticated snapshot polling in native mode');
      const stream = new URL(`/api/stream/orders/${order.id}`, window.location.origin); stream.searchParams.set('tenantId', getActiveTenant() || 'default_tenant');
      const streamUrl = stream.href;
      es = new EventSource(streamUrl);
      es.onopen=()=>{
        streamHealthyRef.current=true;setStreamConnected(true);
        // An SSE reconnection is not an event replay. Recover the canonical
        // snapshot after a transport gap so missed status changes are visible.
        if(shouldRefreshOnStreamReconnect(missedConnection))fetchOrder(order.id,{silent:true});
        missedConnection=false;
      };
      es.onerror=()=>{missedConnection=true;streamHealthyRef.current=false;setStreamConnected(false);};
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg && msg.type === 'driver_location') {
            const fix=normalizeDriverFix(msg);
            if(isNewerDriverFix(fix,driverFixRef.current)){
              driverFixRef.current=fix;setDriverLoc(fix);setDriverLastSeen(fix.updatedAt);
            }
          } else if (msg?.type==='driver_assigned' && msg.orderId===orderRef.current?.id) {
            // Invalidate the prior rider position until a new authorized fix arrives.
            driverFixRef.current=null;
            setDriverLoc(null);setDriverLastSeen(null);setRoadRoute(null);
            fetchOrder(msg.orderId,{silent:true});
          } else if (msg && msg.id) {
            applyOrderUpdate(msg);
          }
        } catch (err) {}
      };
    } catch (err) {}

    // On installed Android/iOS devices background timers are suspended. The
    // latest authoritative private snapshot must be fetched upon foreground
    // return or network recovery, without synthetic order/rider updates.
    let lastNativeResumeAt=0;
    const refreshOnNativeResume=()=>{
      const current=orderRef.current;
      const now=Date.now();
      if(!shouldRefreshNativeTrackingOnResume({
        nativeBuild:isPackagedNative,orderId:current?.id,status:current?.status,
        visible:document.visibilityState!=='hidden',
        online:navigator.onLine!==false,now,lastResumeAt:lastNativeResumeAt
      }))return;
      lastNativeResumeAt=now;
      // The previous request may still be stalled from the suspended WebView.
      // Invalidate its tracking gate before forcing a fresh authorized snapshot.
      trackingGateRef.current.invalidate();
      fetchOrder(current.id,{silent:true});
    };
    if(isPackagedNative){
      document.addEventListener('visibilitychange',refreshOnNativeResume);
      window.addEventListener('focus',refreshOnNativeResume);
      window.addEventListener('online',refreshOnNativeResume);
      // BFCache/pageshow also covers restored WebViews that emit no focus event.
      window.addEventListener('pageshow',refreshOnNativeResume);
    }

    // Use 5-second polling only while SSE is unavailable. With a connected
    // stream, reconcile a snapshot after 35 seconds without order events.
    // This bounds server load while still recovering from missed updates.
    const interval = setInterval(() => {
      if (orderRef.current?.id && shouldPollTrackingSnapshot({streamConnected:streamHealthyRef.current,lastSnapshotAt:lastSnapshotRef.current,now:Date.now(),visible:document.visibilityState!=='hidden',online:navigator.onLine!==false})) {
        fetchOrder(orderRef.current.id,{silent:true});
      }
    }, 5000);


    return () => {
      clearInterval(interval);
      if(isPackagedNative){
        document.removeEventListener('visibilitychange',refreshOnNativeResume);
        window.removeEventListener('focus',refreshOnNativeResume);
        window.removeEventListener('online',refreshOnNativeResume);
        window.removeEventListener('pageshow',refreshOnNativeResume);
      }
      if (es) es.close();
      streamHealthyRef.current=false;
      setStreamConnected(false);
    };
  }, [order?.id, order?.status]);

  // Customer opt-in: permission must never be requested during page load.
  const enableNotifications=async()=>{
    if(!canUseHostedWebPush(isPackagedNative) || !order?.id || !storeInfo?.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))return;
    setPushBusy(true);
    try {
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error(t('notificationDenied') || 'Notifications were not allowed.');
      const reg=await navigator.serviceWorker.ready;
      const base64=storeInfo.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/');
      const raw=atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
      const bytes=Uint8Array.from(raw,ch=>ch.charCodeAt(0));
      const sub=await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      await apiFetch('/public/orders/'+encodeURIComponent(order.id)+'/push-subscription',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})});
      setPushEnabled(true);
      toast(t('notificationsEnabled') || 'Order notifications enabled.','success');
    }catch(e){toast(e.message||'Could not enable browser notifications. Live tracking remains available.','warning')}
    finally{setPushBusy(false)}
  };

  // Calculate dynamic ETA countdown
  useEffect(() => {
    if (!order) return;
    if (order.status === 'cancelled' || order.status === 'delivered' || order.status === 'completed') {
      setRemainingMins(null);
      return;
    }

    const eta=trackingEtaMinutes(order.etaMinutes);
    const startTime=Number(order.acceptedAt||order.timestamp);
    if(eta===null||!Number.isFinite(startTime)||startTime<=0){setRemainingMins(null);return;}
    const left=()=>Math.max(0,eta-Math.max(0,Math.floor((Date.now()-startTime)/60000)));
    setRemainingMins(left());
    const timer=setInterval(()=>setRemainingMins(left()),30000);

    return () => clearInterval(timer);
  }, [order?.acceptedAt, order?.etaMinutes, order?.timestamp, order?.status]);

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    if (!order) return;
    setSubmittingFeedback(true);
    try {
      await apiFetch('/public/feedback', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          rating,
          comment: feedbackComment.trim()
        })
      });
      setFeedbackSubmitted(true);
    } catch (err) {
      toast('Failed to send feedback: ' + err.message, 'error');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    if (!window.confirm(tr.cancelConfirm)) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`/public/orders/${order.id}/cancel`, { method: 'POST' });
      if (res && res.status === 'cancelled') {
        setOrder(prev => ({ ...prev, status: 'cancelled', rejectedReason: 'Cancelled by customer' }));
        toast(tr.orderCancelled, 'success');
      }
    } catch (err) {
      toast(err.message || 'Could not cancel the order.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const isCancelled = ['cancelled','rejected','refunded','partially_refunded'].includes(String(order?.status||'').toLowerCase());
  const canCancel = order?.status === 'pending';
  const rawType = (order?.orderType || order?.diningType || 'takeaway').toLowerCase();
  const isDelivery = rawType === 'delivery';
  const isDineIn = rawType === 'dine-in' || rawType === 'dine_in' || rawType === 'dinein' || rawType === 'qr' || rawType === 'table' || rawType === 'dine in';
  const isTakeaway = !isDelivery && !isDineIn;
  const trackingMode=isDelivery?'delivery':isDineIn?'dine-in':'takeaway';
  const actualProgress=trackingProgress(order?.status,trackingMode);
  const isDone=actualProgress.done;
  const currentStage=actualProgress.steps[actualProgress.currentIndex]?.id;
  const heroMessage=trackingHeroMessage(order?.status,trackingMode);
  const gpsState=driverFreshness(driverLoc,nowClock);
  // Proximity is an informational measurement, never an automatic "arrived"
  // status. A stale rider fix cannot trigger a nearby indication.
  const riderNearDestination=(()=>{
    if(!isDelivery || isDone || isCancelled || !gpsState.visible ||
       String(order?.status)!=='out_for_delivery')return false;
    const a={lat:Number(driverLoc?.lat),lng:Number(driverLoc?.lng)};
    const b={lat:Number(order?.deliveryLat),lng:Number(order?.deliveryLng)};
    if(!validGeoPoint(a) || !validGeoPoint(b))return false;
    const rad=Math.PI/180,dl=(b.lat-a.lat)*rad,dg=(b.lng-a.lng)*rad;
    const h=Math.sin(dl/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dg/2)**2;
    return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))<=250;
  })();
  const hasRecentUpdates=lastUpdate && nowClock-lastUpdate<TRACKING_UPDATE_STALE_MS;
  const etaDisplay=trackingEtaMinutes(dynamicETA?.estimatedMinutes) ?? remainingMins;
  const estimateBand = etaDisplay > 0 ? [Math.floor(etaDisplay/5)*5, Math.ceil(etaDisplay/5)*5] : null;
  const deliveryEstimate = estimateBand && estimateBand[0] !== estimateBand[1]
    ? estimateBand.join('–') + ' min · estimate' : etaDisplay > 0 ? 'About ' + etaDisplay + ' min' : 'Awaiting updated ETA';
  // Anchor the clock to a confirmed order estimate or a measured rider fix.
  const roadMinutes=roadRoute?.startingPoint==='rider' && gpsState.state==='fresh' && currentStage==='out_for_delivery' && trackingEtaMinutes(roadRoute?.travelMinutes);
  const orderMinutes=trackingEtaMinutes(order?.etaMinutes);
  const orderedAt=Number(order?.acceptedAt || order?.timestamp);
  const arrivalAt=roadMinutes ? driverLoc.updatedAt+roadMinutes*60000
    : orderMinutes && orderedAt>0 ? orderedAt+orderMinutes*60000 : Number(dynamicETA?.estimatedDeliveryTime) || null;
  const arrivalLabel=arrivalAt>nowClock ? 'Estimated arrival '+new Date(arrivalAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : null;
  const restaurantContact=contactLinks(order?.storePhone || storeInfo?.phone);
  const riderAssigned=isDelivery && !isCancelled && !isDone && Boolean(order?.driver?.id || order?.driverId || dispatchStatus?.driverId);
  const riderContact=riderAssigned ? contactLinks(order?.driver?.phone || order?.driverPhone) : null;
  const displayRiderName=order?.driver?.name && !/^drv[_ -]?[a-f0-9-]{12,}$/i.test(order.driver.name) ? order.driver.name : 'Your delivery rider';
  const orderPricing=orderPriceBreakdown(order||{});
  const trackingIsLive=Boolean(streamConnected && hasRecentUpdates);
  const stageNumber=actualProgress.done?actualProgress.steps.length:Math.max(1,actualProgress.currentIndex+1);

  return (
    <div className="tracking-page fade-in gf-modern-tracking" style={{ padding: '20px 16px 90px' }}>
      {!order ? (

        <div className="form-section gf-tracking-lookup" style={{ marginTop: 24 }}>
          {customer && recent?.customer === customer && recent.choices.length > 0 && <section>
            <h2>Your restaurant orders</h2>
            <div className="gf-order-choices">{recent.choices.map(choice => <button type="button" key={choice.id}
              onClick={() => onSelectOrder(choice.id)}><span><strong>#{choice.label}</strong><small>{choice.dateLabel}</small></span><em data-status={choice.statusLabel}>{choice.statusLabel}</em><span aria-hidden="true">›</span></button>)}</div>
          </section>}
          <h2>📦 {t('trackOrderTitle')}</h2>
          <p className="text-muted" style={{ marginBottom: 16 }}>{t('trackOrderHelp')}</p>
          <div className="form-group">
            <label htmlFor="tracking-order-id">{t('orderId')}</label>
            <input id="tracking-order-id" className="form-control" placeholder="e.g. ord_online_…"
              value={trackId} onChange={e => setTrackId(e.target.value)} />
          </div>
          <button className="btn btn-brand mt-8" onClick={() => fetchOrder(trackId)} disabled={loading || !trackId}>
            {loading ? '⏳ '+t('loading') : '🔍 '+t('trackOrderLive')}
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 12 }}>⚠ {error}</p>}
        </div>
      ) : (
        <>
          {order.paymentMethod === 'bank_transfer' && order.paymentStatus !== 'paid' && (
            <section role="status" className="form-section" style={{border:'1px solid #a2c5ae',background:'#eef8f1',padding:18,borderRadius:16,marginBottom:16,color:'#203c2b'}}>
              <strong style={{display:'block',fontSize:'1rem',marginBottom:8}}>🏦 {t('bankPending')}</strong>
              <p style={{fontSize:'.85rem',lineHeight:1.6,margin:0}}>{t('bankPendingHelp')}</p>
            </section>
          )}
          {riderNearDestination && <div role="status" aria-live="polite"
            style={{display:'flex',alignItems:'center',gap:10,padding:'12px 15px',borderRadius:16,background:'#e5f8ed',border:'1px solid #9fdbb7',color:'#145b40',fontWeight:750,margin:'10px 0'}}>
            <span aria-hidden="true">🛵</span><span>Your rider is near the delivery pin. Please be ready for handover. Arrival is not yet confirmed.</span>
          </div>}
          {stageAnnouncement && <div className="gf-journey-stage-announcement" role="status" aria-live="polite"><span aria-hidden="true">✓</span> {stageAnnouncement}<button type="button" aria-label="Dismiss order update" onClick={()=>setStageAnnouncement('')}>×</button></div>}
          {/* Map-first journey: position the confirmed rider map before secondary progress details. */}
          {!isCancelled&&!isDone&&isDelivery&&validGeoPoint({lat:order.deliveryLat,lng:order.deliveryLng})&&
            <CustomerTripScreen key={order.id} order={order} store={storeInfo && validGeoPoint(storeInfo)?{lat:Number(storeInfo.lat),lng:Number(storeInfo.lng)}:null}
              dest={{lat:Number(order.deliveryLat),lng:Number(order.deliveryLng)}} driver={gpsState.visible?driverLoc:null}
              route={roadRoute?.startingPoint==='restaurant' || gpsState.visible ? roadRoute : null} gpsState={gpsState} chatOpen={driverChatOpen} step={actualProgress.steps[actualProgress.currentIndex]}
              index={actualProgress.currentIndex} steps={actualProgress.steps} assigned={riderAssigned} riderName={displayRiderName}
              contact={riderContact} arrival={arrivalLabel} late={arrivalAt>0 && arrivalAt<=nowClock}
              onDetails={()=>setJourneySheet('full')} onHelp={()=>onSupport(customer ? order.id : null)}
              onMessage={()=>{setDriverChatOpen(true);fetchDriverMessages(order.id);}}/>}
          {isDelivery&&!isCancelled&&!isDone&&<section aria-label="Delivery journey details" onTouchStart={onJourneyTouchStart} onTouchEnd={onJourneyTouchEnd} style={{touchAction:'pan-y',borderRadius:'24px 24px 18px 18px',background:'var(--card-bg, #fff)',padding:'14px 16px',margin:'12px 0',boxShadow:'0 12px 32px rgba(16,56,42,.10)'}}>
            <div aria-hidden="true" style={{width:44,height:5,borderRadius:9,background:'#b7c9c0',margin:'0 auto 10px'}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:10}}>
              <div><strong style={{display:'block',fontSize:17}}>{actualProgress.steps[actualProgress.currentIndex]?.label || 'Delivery in progress'}</strong>
                <small style={{color:'#5d736a'}}>{gpsState.label}</small></div>
              <div style={{textAlign:'right'}}>{etaDisplay>0&&<strong style={{display:'block',fontSize:18}}>{deliveryEstimate}</strong>}<small style={{color:'#648176'}}>Estimated, not guaranteed</small></div>
            </div>
            <div role="group" aria-label="Delivery details sheet size" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:6,background:'#eef5f0',padding:5,borderRadius:15}}>
              {[['compact','Summary'],['half','Details'],['full','Full order']].map(([value,label])=>
                <button key={value} type="button" aria-pressed={journeySheet===value} onClick={()=>setJourneySheet(value)}
                  style={{border:0,borderRadius:11,padding:'10px 5px',fontSize:12,fontWeight:800,color:journeySheet===value?'#fff':'#275244',background:journeySheet===value?'#087653':'transparent'}}>{label}</button>)}
            </div>
            {riderAssigned&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:12}}>
              <div style={{minWidth:0}}><strong style={{display:'block',fontSize:14}}>🛵 {displayRiderName}</strong><small>{gpsState.visible?'Last confirmed position available':'Rider assigned · GPS may be unavailable'}</small></div>
              <div style={{display:'flex',gap:6}}>
                <button type="button" onClick={()=>{setDriverChatOpen(true);fetchDriverMessages(order.id);}} aria-label="Message delivery rider" style={{border:0,borderRadius:12,padding:'11px 12px',background:'#e7f5ed',color:'#096a4d',fontWeight:800}}>Message</button>
                {riderContact&&<a href={riderContact.tel} style={{borderRadius:12,padding:'11px 12px',background:'#e7f5ed',color:'#096a4d',fontWeight:800,textDecoration:'none'}}>Call</a>}
              </div>
            </div>}
          </section>}
          <div className="customer-tracking-tools">
            <div className="customer-tracking-freshness" role="status" aria-live="polite"><strong>{streamConnected && hasRecentUpdates ? 'Live updates connected' : hasRecentUpdates ? 'Order updated · reconnecting' : 'Checking for order updates'}</strong><small>{lastUpdate ? 'Last confirmed '+new Date(lastUpdate).toLocaleTimeString() : 'Connecting…'}</small></div>
            {canUseHostedWebPush(isPackagedNative) && storeInfo?.vapidPublicKey && !pushEnabled && 'Notification' in window &&
              <button type="button" className="customer-tracking-notify" disabled={pushBusy} onClick={enableNotifications}>{pushBusy?'…': '🔔'} {t('enableOrderNotifications') || 'Enable notifications'}</button>}
            {pushEnabled && <span className="customer-tracking-active">✓ {t('notificationsEnabled') || 'Notifications enabled'}</span>}
            {connectionWarning && <div className="gf-tracking-reconnect" role="alert"><span>{connectionWarning}</span><button type="button" onClick={()=>fetchOrder(orderRef.current?.id,{silent:true})}>Refresh status</button></div>}
          </div>
          {(journeySheet!=='compact' || !isDelivery || isCancelled || isDone) &&
          <section className="gf-journey-focus" aria-label="Current order progress" aria-live="off">
            <div className="gf-journey-focus-heading">
              <span className="gf-journey-focus-icon" aria-hidden="true"><AnimatedFeatureIcon kind={currentStage==='preparing'?'cooking':isDelivery&&['picked_up','out_for_delivery','arrived'].includes(currentStage)?'delivery':currentStage==='ready'?'ready':'order'} size={44} active={!isDone && !isCancelled}/></span>
              <div className="gf-journey-focus-copy">
                <div className="gf-journey-eyebrow">{isDelivery?'DELIVERY JOURNEY':isDineIn?'DINE-IN ORDER':'PICKUP ORDER'} · {isDone?'Complete':isCancelled?'Closed':`Stage ${stageNumber} of ${actualProgress.steps.length}`}</div>
                <h1>{isCancelled?'Order no longer active':isDone?isDelivery?'Delivered successfully':'Order completed':actualProgress.steps[actualProgress.currentIndex]?.label || 'Order received'}</h1>
                <p>{isCancelled?order.rejectedReason||'Contact the restaurant for help':isDone?'Thank you for ordering with us':actualProgress.steps[actualProgress.currentIndex]?.description}</p>
              </div>
            </div>
            <div className="gf-journey-live-line">
              <span className={`gf-journey-connection ${trackingIsLive?'is-connected':''}`}><span className="gf-journey-signal" aria-hidden="true"/>{isDone?'Delivery confirmed':trackingIsLive?'Live status connected':'Checking order updates'}</span>
              {!isDone&&!isCancelled&&etaDisplay>0&&<span className="gf-journey-timing">{deliveryEstimate}</span>}
            </div>
            {!isCancelled&&<div className="gf-journey-track" role="progressbar" aria-label="Confirmed order progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={actualProgress.percent}><span style={{width:`${actualProgress.percent}%`}}/></div>}
            {!isCancelled&&<div className="gf-journey-milestones" aria-label="Journey stages">
              {actualProgress.steps.map((step,i)=><span key={step.id} title={step.label} className={i<actualProgress.currentIndex||isDone?'is-complete':i===actualProgress.currentIndex?'is-current':''} aria-label={`${step.label}: ${i<actualProgress.currentIndex||isDone?'complete':i===actualProgress.currentIndex?'current':'upcoming'}`}>
                {i<actualProgress.currentIndex||isDone?'✓':i===actualProgress.currentIndex?'●':'·'}
              </span>)}
            </div>}

          </section>}
          {((isDelivery && ['picked_up','out_for_delivery','arrived'].includes(currentStage)) || canCancel) &&
            <div className="gf-journey-quick-actions">
              {isDelivery && ['picked_up','out_for_delivery','arrived'].includes(currentStage) &&
                <button type="button" onClick={()=>{
                  if(receiptDetailsRef.current){
                    receiptDetailsRef.current.open=true;
                    receiptDetailsRef.current.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
                  }
                }}>🔐 Delivery handover details</button>}
              {canCancel && <button type="button" className="gf-journey-quick-cancel" onClick={handleCancelOrder} disabled={cancelling}>{cancelling?'Cancelling…':'Cancel order'}</button>}
            </div>}
          {isDelivery && !isCancelled && journeySheet!=='compact' && <DeliveryPulseCard
            status={order.status}
            assigned={riderAssigned}
            gpsState={gpsState.state}
            etaMinutes={isDone?null:etaDisplay}
            onMessage={riderAssigned?()=>{setDriverChatOpen(true);fetchDriverMessages(order.id);}:null}
          />}
          {/* Native disclosure keeps the order timeline accessible without hiding the live map. */}
          {(journeySheet==='full' || !isDelivery || isCancelled || isDone) && <details className="gf-tracking-journey-sheet">
            <summary className="gf-tracking-journey-summary">
              <span className="gf-tracking-journey-grip" aria-hidden="true" />
              <span className="gf-tracking-journey-heading">
                <strong>{isCancelled ? 'Order update' : 'Order progress'}</strong>
                <small>{isCancelled ? 'This order is no longer active' : isDone ? 'All stages completed' : actualProgress.steps[actualProgress.currentIndex]?.label || 'Waiting for an update'}</small>
              </span>
              <span className="gf-tracking-journey-expand" aria-hidden="true">⌄</span>
            </summary>
            <ol className="gf-tracking-journey-steps" aria-label="Confirmed order stages">
              {actualProgress.steps.map((step,index)=>{
                const completed=!isCancelled && (isDone || index<actualProgress.currentIndex);
                const current=!isCancelled && !isDone && index===actualProgress.currentIndex;
                return <li key={step.id} className={completed?'completed':current?'current':'upcoming'} aria-current={current?'step':undefined}>
                  <span className="gf-tracking-step-dot" aria-hidden="true">{completed?'✓':index+1}</span>
                  <span className="gf-tracking-step-content"><strong>{step.label}</strong><small>{step.description}</small></span>
                  {current && <span className="gf-tracking-step-now">Current</span>}
                </li>;
              })}
            </ol>
            {isDelivery && !isCancelled && !isDone && (
              <p className="gf-tracking-journey-note">Progress reflects restaurant and rider updates. Live GPS availability may differ from the current order stage.</p>
            )}
          </details>}

          <details className="gf-journey-auxiliary gf-journey-contacts"><summary>☎ Contact rider or restaurant <span>Calls, messages and help</span></summary><section className="gf-tracking-contact-card" aria-label="Delivery and restaurant contacts">
            <div className="gf-tracking-contact-heading">
              <div>
                <span className="gf-tracking-contact-overline">NEED ASSISTANCE?</span>
                <h2>{riderAssigned ? 'Your rider and restaurant' : 'Restaurant assistance'}</h2>
              </div>
              <span aria-hidden="true">☎</span>
            </div>
            {riderAssigned && (
              <div className="gf-tracking-rider-contact">
                <span className="gf-tracking-contact-avatar" aria-hidden="true">🛵</span>
                <div className="gf-tracking-contact-identity">
                  <strong>{displayRiderName}</strong>
                  <small>{gpsState.visible ? 'Last reported rider location available' : 'Rider assigned · location may be unavailable'}</small>
                </div>
                <div className="gf-tracking-contact-buttons">
                  <button type="button" onClick={() => {setDriverChatOpen(true);fetchDriverMessages(order.id);}}>Message rider</button>
                  {riderContact && <a href={riderContact.tel}>Call rider</a>}
                </div>
              </div>
            )}
            <div className="gf-tracking-store-contact">
              <div className="gf-tracking-contact-identity">
                <strong>{order.storeName || storeInfo?.name || 'Your restaurant'}</strong>
                <small>{order.storeAddress || storeInfo?.address || 'Restaurant order support'}</small>
              </div>
              <div className="gf-tracking-contact-buttons">
                {restaurantContact && <a href={restaurantContact.tel}>Call store</a>}
                {restaurantContact?.whatsapp && <a href={restaurantContact.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp store</a>}
                {!restaurantContact && <small role="status">No restaurant phone number available</small>}
              </div>
            </div>
            {isDelivery && !riderAssigned && !isDone && !isCancelled && <p className="gf-tracking-contact-note">Rider contact options will appear after a confirmed assignment.</p>}
            <button type="button" className="btn btn-outline" onClick={() => onSupport(customer ? order.id : null)}>{t('supportThisOrder')}</button>
            <button className="gf-tracking-share-button" type="button" onClick={() => {
              const text = `Order ${order.id} · ${order.storeName || storeInfo?.name || 'GastroFlow restaurant'}`;
              if (navigator.share) {
                navigator.share({ title: 'GastroFlow order', text }).catch(() => {});
              } else if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => toast('Order reference copied', 'success')).catch(() => toast('Unable to copy order reference', 'warning'));
              } else toast(text, 'info');
            }}>Share order reference</button>
          </section></details>

          <div style={{ display: 'flex', gap: 10, margin: '8px 0 12px' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack}>
              ⬅ Back to Menu
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { trackingGateRef.current.invalidate();activeTrackedIdRef.current=null;driverFixRef.current=null;orderRef.current=null;setDriverLoc(null);setDriverLastSeen(null);setDispatchStatus(null);setDynamicETA(null);setOrder(null);setTrackId(''); }}>
              🔍 Track Another
            </button>
          </div>

          {/* Customer Rating Feedback Popup (when delivered) */}
          {actualProgress.done && (
            <div className="tracking-card" style={{ marginTop: 12, border: '2px solid var(--brand)', background: 'var(--bg-card)' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 800 }}>⭐ Rate Your Experience</h3>
              {feedbackSubmitted ? (
                <p style={{ color: 'var(--success)', fontWeight: 700, margin: 0 }}>
                  Thank you for your feedback! It helps us improve our service. ❤️
                </p>
              ) : (
                <form onSubmit={handleFeedbackSubmit}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
                    How was your meal experience today?
                  </p>
                  
                  {/* Stars selectors */}
                  <div style={{ display: 'flex', gap: 8, fontSize: '1.8rem', marginBottom: 12, cursor: 'pointer' }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <span 
                        key={star} 
                        onClick={() => setRating(star)} 
                        style={{ color: star <= rating ? '#ffb300' : '#e0e0e0' }}
                      >
                        ★
                      </span>
                    ))}
                  </div>

                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <textarea 
                      className="form-control" 
                      rows={2} 
                      placeholder="Tell us what you liked or how we can improve..."
                      value={feedbackComment} 
                      onChange={e => setFeedbackComment(e.target.value)}
                      style={{ resize: 'none' }}
                    />
                  </div>

                  <button className="btn btn-brand" style={{ padding: '8px 16px' }} type="submit" disabled={submittingFeedback}>
                    {submittingFeedback ? 'Submitting…' : 'Submit Review'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* The receipt identifies the restaurant that owns the order. */}
          <details ref={receiptDetailsRef} className="gf-journey-auxiliary gf-journey-receipt"><summary>🧾 Order details and receipt <span>Items, amount and handover</span></summary><div className="tracking-card customer-order-receipt" style={{ marginTop: 12 }}>
            <div className="customer-receipt-brand"><strong>{order.storeName || storeInfo?.name || 'Restaurant'}</strong><small>{order.storeAddress || storeInfo?.address || ''}</small>{(order.storePhone || storeInfo?.phone) && <small>Tel: {order.storePhone || storeInfo.phone}</small>}</div>
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Order Reference</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--brand)' }}>{order.id}</div>
              </div>
              <span className={`chip chip-${isCancelled ? 'orange' : isDone ? 'green' : actualProgress.currentIndex >= 2 ? 'yellow' : 'orange'}`}>
                {order.status || 'Pending'}
              </span>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              📅 {(() => {
                const rawTs = Number(order.timestamp) || order.timestamp || order.createdAt;
                const d = new Date(rawTs);
                return isNaN(d.getTime()) ? 'Just now' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              })()} · {isDineIn ? '🍽️ Dine-In' : isTakeaway ? '🛍️ Takeaway / Pickup' : '🛵 Home Delivery'}
            </div>

            {order.invoiceNumber != null && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-1)', marginBottom: 8, fontWeight: 700 }}>
                🧾 {tr.invoiceNo}: <span style={{ fontFamily: 'monospace' }}>INV-{String(order.invoiceNumber).padStart(6, '0')}</span>
              </div>
            )}

            {isDelivery && order.deliveryAddress && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-1)', background: 'rgba(0,0,0,0.02)', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>
                📍 <strong>Delivery Address:</strong> {order.deliveryAddress}
              </div>
            )}

            <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 10 }}>
              {order.items?.map((item, i) => (
                <div key={i} className="flex-between" style={{ fontSize: '0.82rem', padding: '4px 0' }}>
                  <span>{item.name} × {item.quantity}</span>
                  <span style={{ color: 'var(--brand)', fontWeight: 700 }}>Rs. {(item.price * item.quantity).toFixed(0)}</span>
                </div>
              ))}
            </div>

            {orderPricing.lines.length>0 && <div aria-label="Order price breakdown" style={{borderTop:'1px solid var(--border-color)',paddingTop:10,marginTop:10}}>{orderPricing.lines.map((line,i)=><div key={i} className="flex-between" style={{fontSize:'.82rem',padding:'5px 0'}}><span>{line.label}</span><strong>{line.amount<0?'−':''}Rs. {Math.abs(line.amount).toFixed(2)}</strong></div>)}</div>}
            <div className="flex-between" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-color)', fontWeight: 800, fontSize: '1rem' }}>
              <span>{tr.totalAmount}</span>
              <span style={{ color: 'var(--brand)' }}>Rs. {Number(order.total || 0).toFixed(2)}</span>
            </div>

            <div className="customer-receipt-powered">Powered by <strong>GastroFlow</strong><span>Developed by {platformPublisher}</span></div>
            <button type="button" className="customer-print-receipt" onClick={() => window.print()}>🧾 Print / Save receipt</button>
            {isDelivery && ['picked_up','out_for_delivery','arrived'].includes(order.status) && (
              <section aria-label="Delivery handover verification"
                style={{padding:14,margin:'14px 0',border:'1px solid var(--border-color)',borderRadius:12,background:'var(--bg-card)'}}>
                <strong style={{display:'block',marginBottom:6}}>Secure delivery handover</strong>
                <p style={{fontSize:13,color:'var(--text-muted)',lineHeight:1.5}}>
                  Generate a private 6-digit code and share it only with your assigned rider at delivery. Once issued, the rider must enter it before completing this order.
                </p>
                {handoverPin?.orderId===order.id && Number(handoverPin.expiresAt)>nowClock &&
                  <div role="status" style={{display:'grid',gap:5,margin:'12px 0'}}>
                    <strong style={{fontSize:30,letterSpacing:5,fontVariantNumeric:'tabular-nums'}}>{handoverPin.pin}</strong>
                    <small>Expires {new Date(handoverPin.expiresAt).toLocaleTimeString()}. Do not share with anyone else.</small>
                  </div>}
                <button type="button" className="btn btn-outline" disabled={handoverPinBusy}
                  onClick={requestHandoverPin}>{handoverPinBusy?'Generating…':handoverPin?'Generate new code':'Generate handover code'}</button>
                {handoverPinError && <p role="alert" style={{fontSize:12,color:'var(--danger)'}}>{handoverPinError}</p>}
              </section>
            )}
            {canCancel && (
              <button
                className="btn btn-outline"
                style={{ marginTop: 14, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={handleCancelOrder}
                disabled={cancelling}
              >
                {cancelling ? tr.cancelling : `✕ ${tr.cancelOrder}`}
              </button>
            )}
            {canCancel && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', textAlign: 'center', marginTop: 6 }}>
                {tr.cancelHint}
              </p>
            )}
          </div></details>

          {/* Full stage history is available once inside the expandable journey sheet above. */}
          {/* Chat dialog is portaled to document.body and remains above navigation. */}
          <RiderChatSheet
            open={driverChatOpen}
            onClose={()=>setDriverChatOpen(false)}
            orderId={order.id}
            messages={driverMessages}
            message={driverInputMsg}
            onMessageChange={setDriverInputMsg}
            onSend={handleSendDriverMsg}
            sending={sendingDriverMsg}
          />
        </>
      )}
    </div>
  );
}
