import {describe,it,expect} from 'vitest';
import {trackingSteps,trackingProgress,trackingEtaMinutes,validGeoPoint,normalizeDriverFix,isNewerDriverFix,driverFreshness,TRACKING_GPS_EXPIRE_MS,TRACKING_GPS_FRESH_MS} from '../apps/customer-web/src/utils/tracking-presentation.js';

describe('GastroFood real order tracking presentation',()=>{
  it('separates ready-for-rider from actually out-for-delivery',()=>{
    const steps=trackingSteps('delivery');
    expect(steps.map(x=>x.id)).toEqual(['pending','preparing','ready','out_for_delivery','completed']);
    expect(trackingProgress('ready','delivery').currentIndex).toBe(2);
    expect(trackingProgress('out_for_delivery','delivery').currentIndex).toBe(3);
    expect(trackingProgress('completed','delivery').done).toBe(true);
    expect(trackingSteps('takeaway').length).toBe(4);
    expect(trackingSteps('dine-in').at(-1).label).toBe('Served');
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
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now-TRACKING_GPS_EXPIRE_MS-1},now)).toBe(null);
    expect(normalizeDriverFix({lat:6.91,lng:79.85,updatedAt:now+11000},now)).toBe(null);
  });
  it('prevents delayed SSE events from moving a rider backward in time',()=>{
    const old={lat:6.91,lng:79.84,updatedAt:1000};
    const fresh={lat:6.92,lng:79.85,updatedAt:2000};
    expect(isNewerDriverFix(old,fresh)).toBe(false);
    expect(isNewerDriverFix(fresh,old)).toBe(true);
  });
  it('visibly labels delayed and expired fixes instead of promising live GPS',()=>{
    const now=1_700_000_000_000;
    expect(driverFreshness(null,now).state).toBe('waiting');
    expect(driverFreshness({updatedAt:now-10000,accuracyMeters:30},now).state).toBe('fresh');
    expect(driverFreshness({updatedAt:now-TRACKING_GPS_FRESH_MS-1000},now).state).toBe('delayed');
    expect(driverFreshness({updatedAt:now-TRACKING_GPS_EXPIRE_MS-1000},now).visible).toBe(false);
  });
});
