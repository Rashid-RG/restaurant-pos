import { describe, expect, it, vi } from 'vitest';
import { isPeakWindow, createPeakHourService } from '../lib/peak-hours.js';

describe('legacy restaurant peak-hour policy', () => {
  it('includes the lunch and dinner window boundaries', () => {
    for (const time of ['11:30','12:00','14:00','18:30','20:00','21:30'])
      expect(isPeakWindow(time)).toBe(true);
    for (const time of ['11:29','14:01','18:29','21:31'])
      expect(isPeakWindow(time)).toBe(false);
  });
  it('respects custom restaurant peak windows', () => {
    const settings = {peakLunchStart:'10:00',peakLunchEnd:'11:00',peakDinnerStart:'16:00',peakDinnerEnd:'17:00'};
    expect(isPeakWindow('10:30',settings)).toBe(true);
    expect(isPeakWindow('12:00',settings)).toBe(false);
    expect(isPeakWindow('16:30',settings)).toBe(true);
  });
  it('loads the requested tenant schedule and never a global fallback schedule', async () => {
    const provider = vi.fn(async tenant => tenant === 'restaurantA'
      ? {peakLunchStart:'09:00',peakLunchEnd:'09:30',peakDinnerStart:'19:00',peakDinnerEnd:'20:00'}
      : {peakLunchStart:'11:00',peakLunchEnd:'12:00',peakDinnerStart:'19:00',peakDinnerEnd:'20:00'});
    const service = createPeakHourService({getSettingsMap:provider, now:()=>new Date(2026,0,1,9,15)});
    expect(await service('restaurantA')).toBe(true);
    expect(await service('restaurantB')).toBe(false);
    expect(provider).toHaveBeenNthCalledWith(1,'restaurantA',['peakLunchStart','peakLunchEnd','peakDinnerStart','peakDinnerEnd']);
    expect(provider).toHaveBeenNthCalledWith(2,'restaurantB',['peakLunchStart','peakLunchEnd','peakDinnerStart','peakDinnerEnd']);
  });
  it('requires a tenant-scoped settings provider', () => {
    expect(() => createPeakHourService({})).toThrow(TypeError);
  });
});
