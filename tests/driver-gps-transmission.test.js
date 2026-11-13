import {describe,it,expect} from 'vitest';
import {geoDistanceMeters,shouldSendDriverFix,DRIVER_MOVING_INTERVAL_MS,DRIVER_STATIONARY_INTERVAL_MS} from '../apps/driver-web/src/utils/gps-transmission.js';

describe('GastroDriver adaptive live-location uplink',()=>{
  const stationary={lat:6.9271,lng:79.8612,recordedAt:1000,accuracyMeters:8};
  it('sends first valid fix immediately',()=>{
    expect(shouldSendDriverFix(stationary,null,1000)).toBe(true);
  });
  it('does not resend duplicate or older GPS fixes',()=>{
    const last={...stationary,sentAt:3000};
    expect(shouldSendDriverFix(stationary,last,20000)).toBe(false);
    expect(shouldSendDriverFix({...stationary,recordedAt:900},last,20000)).toBe(false);
  });
  it('uses a slower heartbeat when stationary',()=>{
    const last={...stationary,sentAt:10000};
    const next={...stationary,recordedAt:14000};
    expect(shouldSendDriverFix(next,last,10000+DRIVER_STATIONARY_INTERVAL_MS-1)).toBe(false);
    expect(shouldSendDriverFix(next,last,10000+DRIVER_STATIONARY_INTERVAL_MS)).toBe(true);
  });
  it('allows quicker updates after meaningful movement',()=>{
    const last={...stationary,sentAt:10000};
    const next={...stationary,lat:6.928,recordedAt:14000};
    expect(geoDistanceMeters(last,next)).toBeGreaterThan(90);
    expect(shouldSendDriverFix(next,last,10000+DRIVER_MOVING_INTERVAL_MS-1)).toBe(false);
    expect(shouldSendDriverFix(next,last,10000+DRIVER_MOVING_INTERVAL_MS)).toBe(true);
  });
  it('avoids sending jitter smaller than reported accuracy at movement frequency',()=>{
    const last={...stationary,accuracyMeters:70,sentAt:10000};
    const next={...stationary,lat:6.9273,recordedAt:13000,accuracyMeters:70};
    expect(shouldSendDriverFix(next,last,16000)).toBe(false);
  });
});
