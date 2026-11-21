import { describe, expect, it } from 'vitest';
import {
  DRIVER_MOVING_INTERVAL_MS,
  DRIVER_STATIONARY_INTERVAL_MS,
  shouldSendDriverFix,
  validDriverFix
} from './gps-transmission.js';

const now = 1_800_000_000_000;
const fix = (changes = {}) => ({
  lat: 6.9271, lng: 79.8612, accuracyMeters: 12, recordedAt: now - 1000, ...changes
});

describe('rider GPS transmission guardrails', () => {
  it('accepts a recent accurate position and initial transmission', () => {
    expect(validDriverFix(fix(), now)).toBe(true);
    expect(shouldSendDriverFix(fix(), null, now)).toBe(true);
  });

  it.each([
    {lat: 91}, {lng: -181}, {lat: NaN}, {accuracyMeters: 0},
    {accuracyMeters: 151}, {recordedAt: now - 31000},
    {recordedAt: now + 11000}
  ])('rejects invalid, poor or stale fixes: %j', (change) => {
    expect(validDriverFix(fix(change), now)).toBe(false);
    expect(shouldSendDriverFix(fix(change), null, now)).toBe(false);
  });

  it('never resends an old fix or one with an invalid send timestamp', () => {
    const prior = {...fix(), sentAt: now - 40000};
    expect(shouldSendDriverFix(fix(), prior, now)).toBe(false);
    expect(shouldSendDriverFix(fix({recordedAt: now - 500}), {...prior, sentAt: NaN}, now)).toBe(false);
  });

  it('uses a longer heartbeat when stationary', () => {
    const prior = {...fix({recordedAt: now - 20000}), sentAt: now - DRIVER_STATIONARY_INTERVAL_MS + 1};
    expect(shouldSendDriverFix(fix(), prior, now)).toBe(false);
    expect(shouldSendDriverFix(fix(), {...prior, sentAt: now - DRIVER_STATIONARY_INTERVAL_MS}, now)).toBe(true);
  });

  it('transmits moving fixes after the shorter interval', () => {
    const prior = {...fix({lat: 6.926, recordedAt: now - 15000}), sentAt: now - DRIVER_MOVING_INTERVAL_MS};
    expect(shouldSendDriverFix(fix(), prior, now)).toBe(true);
    expect(shouldSendDriverFix(fix(), {...prior, sentAt: now - DRIVER_MOVING_INTERVAL_MS + 1}, now)).toBe(false);
  });
});
