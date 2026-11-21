import {describe,it,expect,vi} from 'vitest';
import {trackingSteps,trackingProgress,trackingHeroMessage,shouldPollTrackingSnapshot,shouldRefreshOnStreamReconnect,shouldClearRiderMarker,trackingEtaMinutes,validGeoPoint,normalizeDriverFix,isNewerDriverFix,driverFreshness,TRACKING_GPS_EXPIRE_MS,TRACKING_GPS_FRESH_MS,createTrackingSnapshotGate} from '../apps/customer-web/src/utils/tracking-presentation.js';

describe('GastroFood real order tracking presentation',()=>{
  it('aborts stalled order snapshots then permits another reconciliation request',()=>{
    vi.useFakeTimers();
    try{
      const gate=createTrackingSnapshotGate();
      const a=gate.start('order-a');
      expect(a?.signal.aborted).toBe(false);
      expect(gate.start('order-a')).toBeNull();
      vi.advanceTimersByTime(12000);
      expect(a.signal.aborted).toBe(true);
      expect(gate.isCurrent(a)).toBe(true);
      expect(gate.finish(a)).toBe(true);
      const refreshed=gate.start('order-a');
      expect(refreshed).not.toBeNull();
      expect(refreshed.signal.aborted).toBe(false);
      gate.invalidate();
      expect(refreshed.signal.aborted).toBe(true);
      expect(gate.isCurrent(refreshed)).toBe(false);
    }finally{vi.useRealTimers();}
  });
  it('cancels an old order request when switching restaurants or tracking links',()=>{
    vi.useFakeTimers();
    try{
      const gate=createTrackingSnapshotGate();
      const first=gate.start('order-a');
      const second=gate.start('order-b');
      expect(first.signal.aborted).toBe(true);
      expect(gate.isCurrent(first)).toBe(false);
      expect(gate.finish(first)).toBe(false);
      expect(gate.isCurrent(second)).toBe(true);
      expect(gate.finish(second)).toBe(true);
      expect(gate.start('order-a')?.signal.aborted).toBe(false);
      gate.invalidate();
    }finally{vi.useRealTimers();}
  });
  it('separates ready-for-rider from actually out-for-delivery',()=>{
    const steps=trackingSteps('delivery');
    expect(steps.map(x=>x.id)).toEqual(['pending','preparing','ready','picked_up','out_for_delivery','arrived','completed']);
    expect(trackingProgress('ready','delivery').currentIndex).toBe(2);
    expect(trackingProgress('picked_up','delivery').currentIndex).toBe(3);
    expect(trackingProgress('out_for_delivery','delivery').currentIndex).toBe(4);
    expect(trackingProgress('arrived','delivery').currentIndex).toBe(5);
    expect(trackingProgress('arrived','delivery').done).toBe(false);
    expect(trackingProgress('delivered','delivery').done).toBe(true);
    expect(trackingProgress('completed','delivery').done).toBe(true);
    expect(trackingSteps('takeaway').length).toBe(4);
    expect(trackingSteps('dine-in').at(-1).label).toBe('Served');
  });
  it('reconciles the authoritative snapshot after SSE transport reconnect',()=>{
    expect(shouldRefreshOnStreamReconnect(false)).toBe(false);
    expect(shouldRefreshOnStreamReconnect(true)).toBe(true);
    expect(shouldRefreshOnStreamReconnect(undefined)).toBe(false);
  });
  it('reduces polling with a connected stream while retaining disconnect and stale recovery',()=>{
    const now=100000;
    expect(shouldPollTrackingSnapshot({streamConnected:false,lastSnapshotAt:now,now})).toBe(true);
    expect(shouldPollTrackingSnapshot({streamConnected:true,lastSnapshotAt:now-1000,now})).toBe(false);
    expect(shouldPollTrackingSnapshot({streamConnected:true,lastSnapshotAt:now-35000,now})).toBe(true);
    expect(shouldPollTrackingSnapshot({streamConnected:true,lastSnapshotAt:null,now})).toBe(true);
    expect(shouldPollTrackingSnapshot({streamConnected:false,lastSnapshotAt:null,now,visible:false})).toBe(false);
    expect(shouldPollTrackingSnapshot({streamConnected:false,lastSnapshotAt:null,now,online:false})).toBe(false);
    expect(shouldPollTrackingSnapshot({streamConnected:true,lastSnapshotAt:now-35000,now,online:false})).toBe(false);
    expect(shouldPollTrackingSnapshot({streamConnected:false,lastSnapshotAt:null,now,online:true})).toBe(true);
  });
  it('keeps rider stages distinct from delivered in the customer hero',()=>{
    for(const state of ['ready','picked_up','out_for_delivery','arrived']) {
      expect(trackingProgress(state,'delivery').done).toBe(false);
      expect(trackingHeroMessage(state,'delivery')).not.toMatch(/Delivered!/);
    }
    expect(trackingHeroMessage('ready','delivery')).toMatch(/awaiting rider pickup/);
    expect(trackingHeroMessage('picked_up','delivery')).toMatch(/collected/);
    expect(trackingHeroMessage('out_for_delivery','delivery')).toMatch(/on the way/);
    expect(trackingHeroMessage('arrived','delivery')).toMatch(/arrived/);
    expect(trackingHeroMessage('delivered','delivery')).toMatch(/Delivered!/);
    expect(trackingHeroMessage('completed','takeaway')).toMatch(/Picked up/);
    expect(trackingHeroMessage('completed','dine-in')).toMatch(/Served!/);
  });
  it('does not show cancelled orders as completed',()=>{
    expect(trackingProgress('cancelled','delivery').terminal).toBe(true);
    expect(trackingProgress('cancelled','delivery').percent).toBe(0);
    expect(trackingProgress('rejected','delivery').terminal).toBe(true);
    expect(trackingProgress('accepted','delivery').currentIndex).toBe(1);
  });
  it('never invents an ETA for missing, negative or nonsensical values',()=>{
    expect(trackingEtaMinutes(null)).toBe(null);
    expect(trackingEtaMinutes('')).toBe(null);
    expect(trackingEtaMinutes(0)).toBe(null);
    expect(trackingEtaMinutes('invalid')).toBe(null);
    expect(trackingEtaMinutes(9999)).toBe(null);
    expect(trackingEtaMinutes('14.4')).toBe(15);
  });
  it('rejects old, future, invalid and out-of-bounds GPS fixes',()=>{
    const now=1_700_000_000_000;
    expect(validGeoPoint({lat:6.91,lng:79.85})).toBe(true);
    expect(validGeoPoint({lat:91,lng:79.85})).toBe(false);
    expect(validGeoPoint({lat:null,lng:79.85})).toBe(false);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-6000,accuracyMeters:18},now)?.accuracyMeters).toBe(18);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-6000},now)).toBe(null);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-6000,accuracyMeters:0},now)).toBe(null);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-6000,accuracyMeters:400},now)).toBe(null);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-TRACKING_GPS_EXPIRE_MS-1},now)).toBe(null);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now+11000},now)).toBe(null);
  });
  it('prevents delayed SSE events from moving a rider backward in time',()=>{
    const old={lat:6.91,lng:79.84,updatedAt:1000};
    const fresh={lat:6.92,lng:79.85,updatedAt:2000};
    expect(isNewerDriverFix(old,fresh)).toBe(false);
    expect(isNewerDriverFix(fresh,old)).toBe(true);
  });
  it('removes obsolete rider pins only when a full snapshot explicitly invalidates GPS',()=>{
    expect(shouldClearRiderMarker({driver:null},null)).toBe(true);
    expect(shouldClearRiderMarker({driver:{lat:0,lng:0,updatedAt:1}},null)).toBe(true);
    expect(shouldClearRiderMarker({id:'order-1',status:'ready'},null)).toBe(false);
    expect(shouldClearRiderMarker({driver:{lat:6.9,lng:79.8}},{lat:6.9,lng:79.8})).toBe(false);
  });
  it('visibly labels delayed and expired fixes instead of promising live GPS',()=>{
    const now=1_700_000_000_000;
    expect(driverFreshness(null,now).state).toBe('waiting');
    expect(driverFreshness({updatedAt:now-10000,accuracyMeters:30},now).state).toBe('fresh');
    expect(driverFreshness({updatedAt:now-TRACKING_GPS_FRESH_MS-1000},now).state).toBe('delayed');
    expect(driverFreshness({updatedAt:now-TRACKING_GPS_EXPIRE_MS-1000},now).visible).toBe(false);
  });
});
