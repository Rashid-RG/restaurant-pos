import { platformPublisher } from '../../../../shared/platform-brand.js';
import { getActiveTenant } from '../utils/tenant.js';
import { AnimatedFeatureIcon } from '../../../../shared/ui/AnimatedFeatureIcon.jsx';
import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import TrackingMap from '../components/TrackingMap.jsx';
import {contactLinks} from '../utils/contact-actions.js';
import { canUseHostedOrderStream, canUseHostedWebPush } from '../utils/native-tracking-policy.js';
import { shouldRefreshNativeTrackingOnResume } from '../utils/native-tracking-resume.js';
import {trackingProgress,trackingHeroMessage,trackingEtaMinutes,normalizeDriverFix,isNewerDriverFix,driverFreshness,validGeoPoint,shouldClearRiderMarker,shouldRefreshOnStreamReconnect,shouldPollTrackingSnapshot,TRACKING_UPDATE_STALE_MS,createTrackingSnapshotGate} from '../utils/tracking-presentation.js';
import {shouldRetainTrackedOrder,shouldClearTrackedOrder} from '../../../driver-web/src/utils/dispatch-sync.js';

export default function OrderTrackingView({ orderId, onBack, toast = () => {} }) {
  const { t, dict: tr } = useLang();
  const isPackagedNative = import.meta.env.MODE === 'native';
  const [trackId, setTrackId] = useState(orderId || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingMins, setRemainingMins] = useState(null);
  const [cancelling, setCancelling] = useState(false);
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

  // Uber Eats-grade Dynamic ETA & Live Driver Chat states
  const [dynamicETA, setDynamicETA] = useState(null);
  const [roadRoute,setRoadRoute]=useState(null);
  const [driverChatOpen, setDriverChatOpen] = useState(false);
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
    if (order && order.id) {
      apiFetch(`/public/orders/${order.id}/eta`)
        .then(setDynamicETA)
        .catch(() => {});
    }
  }, [order?.id, order?.status]);

  // Optional dedicated routing provider: refresh only for active deliveries.
  useEffect(()=>{
    const id=order?.id;
    const type=String(order?.orderType||order?.diningType||'').toLowerCase();
    const status=String(order?.status||'').toLowerCase();
    if(!id || type!=='delivery' || ['cancelled','rejected','refunded','partially_refunded','completed','delivered'].includes(status)){setRoadRoute(null);return;}
    let disposed=false;
    const fetchRoute=()=>apiFetch(`/public/orders/${encodeURIComponent(id)}/road-route`).then(data=>{
      if(!disposed)setRoadRoute(data?.available?data:null);
    }).catch(()=>{if(!disposed)setRoadRoute(null);});
    setRoadRoute(null);
    fetchRoute();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')fetchRoute();},30000);
    return()=>{disposed=true;clearInterval(timer);};
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
      const data = await apiFetch(`/orders/${id}/driver-chat`);
      setDriverMessages(data || []);
    } catch (_) {}
  };

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
      fetchDriverMessages(order.id);
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
      playCustomerChime();
      toast(`🔔 Order Status Updated: ${String(data.status).toUpperCase()}`, 'info');
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
      setDriverLoc(null);setDriverLastSeen(null);setDispatchStatus(null);setDynamicETA(null);setRoadRoute(null);
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
  const hasRecentUpdates=lastUpdate && nowClock-lastUpdate<TRACKING_UPDATE_STALE_MS;
  const etaDisplay=trackingEtaMinutes(dynamicETA?.estimatedMinutes) ?? remainingMins;
  const restaurantContact=contactLinks(order?.storePhone || storeInfo?.phone);
  const riderAssigned=isDelivery && !isCancelled && !isDone && Boolean(order?.driver?.id || order?.driverId || dispatchStatus?.driverId);
  const riderContact=riderAssigned ? contactLinks(order?.driver?.phone || order?.driverPhone) : null;

  return (
    <div className="tracking-page fade-in gf-modern-tracking" style={{ padding: '20px 16px 90px' }}>
      {!order ? (

        <div className="form-section gf-tracking-lookup" style={{ marginTop: 24 }}>
          <h2>📦 {t('trackOrderTitle')}</h2>
          <p className="text-muted" style={{ marginBottom: 16 }}>{t('trackOrderHelp')}</p>
          <div className="form-group">
            <label>{t('orderId')}</label>
            <input className="form-control" placeholder="e.g. ord_online_…"
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
          <div className="customer-tracking-tools">
            <div className="customer-tracking-freshness" role="status" aria-live="polite"><strong>{streamConnected && hasRecentUpdates ? 'Live updates connected' : hasRecentUpdates ? 'Order updated · reconnecting' : 'Checking for order updates'}</strong><small>{lastUpdate ? 'Last confirmed '+new Date(lastUpdate).toLocaleTimeString() : 'Connecting…'}</small></div>
            {canUseHostedWebPush(isPackagedNative) && storeInfo?.vapidPublicKey && !pushEnabled && 'Notification' in window &&
              <button type="button" className="customer-tracking-notify" disabled={pushBusy} onClick={enableNotifications}>{pushBusy?'…': '🔔'} {t('enableOrderNotifications') || 'Enable notifications'}</button>}
            {pushEnabled && <span className="customer-tracking-active">✓ {t('notificationsEnabled') || 'Notifications enabled'}</span>}
            {connectionWarning && <div className="gf-tracking-reconnect" role="alert"><span>{connectionWarning}</span><button type="button" onClick={()=>fetchOrder(orderRef.current?.id,{silent:true})}>Refresh status</button></div>}
          </div>
          {/* Delivery map leads the screen; display only authenticated, recent GPS fixes. */}
          {!isCancelled && !isDone && isDelivery && validGeoPoint({lat:order.deliveryLat,lng:order.deliveryLng}) && (
            <section className="gf-track-map-first" aria-label="Your delivery journey">
              <div className="gf-track-map-first-heading">
                <div><span className="gf-track-map-eyebrow">YOUR DELIVERY JOURNEY</span><h2>Follow your order</h2></div>
                <span className="gf-track-map-eta">{etaDisplay !== null ? `About ${etaDisplay} min · estimate` : 'ETA pending'}</span>
              </div>
              <div className="gf-track-map-surface">
                <TrackingMap
                  store={storeInfo && typeof storeInfo.lat === 'number' ? { lat: storeInfo.lat, lng: storeInfo.lng } : null}
                  dest={{ lat: order.deliveryLat, lng: order.deliveryLng }}
                  driver={gpsState.visible ? driverLoc : null}
                  route={roadRoute}
                />
                <div className="gf-track-gps-status" role="status">{gpsState.label}</div>
              </div>
              {roadRoute?.available ? <div className="gf-route-summary" role="status"><strong>{roadRoute.distanceKm.toFixed(1)} km by road</strong><span>About {roadRoute.travelMinutes} min estimated driving · {roadRoute.startingPoint==='rider'?'from latest rider fix':'from restaurant'} · excludes traffic and preparation time</span></div> : <p className="gf-track-road-unavailable">Road routing unavailable; the map may show straight-line proximity only.</p>}
            </section>
          )}
          {/* Server-backed order status hero. */}
          <div className="uber-hero-card">
            <div className="uber-hero-header">
              {!isCancelled && <img className="tracking-food-art" src={`${import.meta.env.BASE_URL}tracking-food-bowl.svg`} alt="" aria-hidden="true" loading="lazy" />}
              {!isCancelled && <AnimatedFeatureIcon kind={currentStage === 'preparing' ? 'cooking' : isDelivery && ['picked_up','out_for_delivery','arrived'].includes(currentStage) ? 'delivery' : currentStage === 'ready' ? 'ready' : 'order'} size={72} active={!isDone}/>}
              {isCancelled ? (
                <div>
                  <div className="uber-status-badge cancelled">{t('statusCancelled')}</div>
                  <h1 className="uber-hero-title" style={{ color: 'var(--danger)' }}>{t('orderCancelledTitle')}</h1>
                  <p className="uber-hero-subtitle">{order.rejectedReason || 'The kitchen was unable to fulfill your order.'}</p>
                </div>
              ) : isDone ? (
                <div>
                  <div className="uber-status-badge completed">{isDineIn ? 'Served' : isTakeaway ? 'Picked Up' : 'Delivered'}</div>
                  <h1 className="uber-hero-title">{isDineIn ? 'Food Served! 🍽️' : isTakeaway ? 'Order Picked Up! 🛍️' : 'Order Delivered! 🎉'}</h1>
                  <p className="uber-hero-subtitle">{t('orderCompletedThanks')}</p>
                </div>
              ) : (
                <div>
                  <div className="uber-status-badge live">{streamConnected && hasRecentUpdates ? '● Live updates' : '○ Checking updates'} · {isDineIn ? 'Dine-in' : isTakeaway ? 'Pickup' : 'Delivery'}</div>
                  <h1 className="uber-hero-title">
                    {etaDisplay !== null ? `Approx. ${etaDisplay} min` : 'Awaiting estimate'}
                  </h1>
                  {etaDisplay !== null && <p className="gf-tracking-eta-note">Approximate only · depends on kitchen and road conditions</p>}
                  <p className="uber-hero-subtitle">{heroMessage}</p>
                </div>
              )}
            </div>

            {/* Uber Progress Bar */}
            {!isCancelled && (
              <div className="uber-progress-bar-wrap">
                <div className="uber-progress-bar-fill" style={{ width: `${actualProgress.percent}%` }} />
              </div>
            )}

            {/* ── Real-time Driver Dispatch Panel — Delivery ONLY ── */}
            {!isCancelled && !isDone && isDelivery && dispatchStatus && (
              <div style={{
                margin: '12px 0',
                padding: '14px 16px',
                borderRadius: 14,
                background: dispatchStatus.driverId ? 'linear-gradient(135deg,#0f2027,#1a3a2a)' : 'linear-gradient(135deg,#1a1a2e,#2a1a3e)',
                border: `1px solid ${dispatchStatus.driverId ? '#10b981' : '#6366f1'}`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{dispatchStatus.dispatchIcon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>{dispatchStatus.dispatchLabel}</div>
                    {dispatchStatus.driver && dispatchStatus.driver.isRecent && dispatchStatus.driver.distanceToStoreKm !== null && (
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>
                        📍 {dispatchStatus.driver.distanceToStoreKm} km from restaurant · Last reported location
                      </div>
                    )}
                    {trackingEtaMinutes(dispatchStatus.etaMinutes) !== null && (
                      <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: 2, fontWeight: 700 }}>
                        ⏱️ Est. delivery: about {trackingEtaMinutes(dispatchStatus.etaMinutes)} min
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: dispatchStatus.driverId ? '#10b981' : '#6366f1',
                    boxShadow: `0 0 8px ${dispatchStatus.driverId ? '#10b981' : '#6366f1'}`,
                    animation: 'pulse 1.5s infinite'
                  }} />
                </div>
              </div>
            )}
          </div>

          {/* Native disclosure keeps the order timeline accessible without hiding the live map. */}
          <details className="gf-tracking-journey-sheet" open={false}>
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
          </details>

          <section className="gf-tracking-contact-card" aria-label="Delivery and restaurant contacts">
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
                  <strong>{order.driver?.name || driverLoc?.driverName || 'Assigned delivery rider'}</strong>
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
            <button className="gf-tracking-share-button" type="button" onClick={() => {
              const text = `Order ${order.id} · ${order.storeName || storeInfo?.name || 'GastroFlow restaurant'}`;
              if (navigator.share) {
                navigator.share({ title: 'GastroFlow order', text }).catch(() => {});
              } else if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => toast('Order reference copied', 'success')).catch(() => toast('Unable to copy order reference', 'warning'));
              } else toast(text, 'info');
            }}>Share order reference</button>
          </section>

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
          <div className="tracking-card customer-order-receipt" style={{ marginTop: 12 }}>
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

            <div className="flex-between" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-color)', fontWeight: 800, fontSize: '1rem' }}>
              <span>{tr.totalAmount}</span>
              <span style={{ color: 'var(--brand)' }}>Rs. {Number(order.total || 0).toFixed(2)}</span>
            </div>

            <div className="customer-receipt-powered">Powered by <strong>GastroFlow</strong><span>Developed by {platformPublisher}</span></div>
            <button type="button" className="customer-print-receipt" onClick={() => window.print()}>🧾 Print / Save receipt</button>
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
          </div>

          {/* Accurate five-stage delivery timeline; never combine ready with rider departure. */}
          {!isCancelled && (
            <section className="tracking-card gf-tracking-timeline" aria-label="Order progress timeline">
              <div className="gf-tracking-section-heading">
                <span className="gf-tracking-overline">YOUR ORDER JOURNEY</span>
                <h3>Order progress</h3>
                <p>Updated from the restaurant's confirmed order status.</p>
              </div>
              <ol className="gf-tracking-steps">
                {actualProgress.steps.map((step,i)=>{
                  const complete=i<actualProgress.currentIndex || (actualProgress.done && i===actualProgress.currentIndex);
                  const active=i===actualProgress.currentIndex && !actualProgress.done;
                  return <li key={step.id} className={`gf-tracking-step ${complete?'is-done':active?'is-active':'is-upcoming'}`} aria-current={active?'step':undefined}>
                    <div className="gf-tracking-node" aria-hidden="true">{complete?'✓':String(i+1)}</div>
                    <div>
                      <strong>{step.label}{active?' · Current':''}</strong>
                      <p>{complete||active?step.description:'Upcoming stage'}</p>
                    </div>
                  </li>;
                })}
              </ol>
            </section>
          )}
          {/* Driver In-App Live Chat Drawer */}
          {driverChatOpen && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', maxWidth: 440, height: '70vh', background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
                <div style={{ background: 'var(--brand)', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>🛵</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Rider Live Direct Chat</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.9 }}>Order #{order.id?.slice(-6).toUpperCase()}</div>
                    </div>
                  </div>
                  <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer' }} onClick={() => setDriverChatOpen(false)}>✕</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {driverMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 40 }}>
                      💬 No messages yet. Send delivery instructions to your rider below!
                    </div>
                  ) : (
                    driverMessages.map(msg => (
                      <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.senderType === 'customer' ? 'flex-end' : 'flex-start' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>{msg.senderName} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ background: msg.senderType === 'customer' ? 'var(--brand)' : 'var(--surface-3)', color: msg.senderType === 'customer' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: '0.85rem', maxWidth: '85%' }}>
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendDriverMsg} style={{ padding: 12, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, background: 'var(--bg-surface)' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Type message to driver..."
                    value={driverInputMsg}
                    onChange={e => setDriverInputMsg(e.target.value)}
                    style={{ flex: 1, borderRadius: 20 }}
                  />
                  <button type="submit" className="btn btn-brand" style={{ borderRadius: 20, padding: '8px 16px' }} disabled={sendingDriverMsg || !driverInputMsg.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
