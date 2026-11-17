import { describe, expect, it, vi } from 'vitest';
import { isPeakWindow, createPeakHourService, restaurantLocalHourMinute } from '../lib/peak-hours.js';

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
    const service = createPeakHourService({getSettingsMap:provider, now:()=>new Date('2026-01-01T03:45:00.000Z')});
    expect(await service('restaurantA')).toBe(true);
    expect(await service('restaurantB')).toBe(false);
    expect(provider).toHaveBeenNthCalledWith(1,'restaurantA',['peakLunchStart','peakLunchEnd','peakDinnerStart','peakDinnerEnd','timeZone','timezone']);
    expect(provider).toHaveBeenNthCalledWith(2,'restaurantB',['peakLunchStart','peakLunchEnd','peakDinnerStart','peakDinnerEnd']);
  });
  it('uses each restaurant timezone for the same UTC instant', async () => {
    // 12:00 in Colombo, 10:30 in Dubai, 09:30 in Qatar.
    const instant = new Date('2026-01-01T06:30:00.000Z');
    const settingsByTenant = {
      lanka: {timeZone: 'Asia/Colombo'},
      dubai: {timeZone: 'Asia/Dubai'},
      qatar: {timeZone: 'Asia/Qatar'}
    };
    const provider = vi.fn(async tenant => settingsByTenant[tenant]);
    const service = createPeakHourService({getSettingsMap:provider, now:()=>instant});
    expect(await service('lanka')).toBe(true);
    expect(await service('dubai')).toBe(false);
    expect(await service('qatar')).toBe(false);
    expect(provider).toHaveBeenCalledWith('dubai', expect.arrayContaining(['timeZone','timezone']));
  });

  it('accepts legacy timezone key and safely defaults invalid zones to Colombo', () => {
    const instant = new Date('2026-01-01T06:30:00.000Z');
    expect(restaurantLocalHourMinute(instant,{timezone:'Asia/Dubai'})).toBe('10:30');
    expect(restaurantLocalHourMinute(instant,{timeZone:'Not/A_Zone'})).toBe('12:00');
    expect(restaurantLocalHourMinute(instant,{})).toBe('12:00');
  });

  it('respects daylight-saving offsets for a restaurant outside Sri Lanka', () => {
    expect(restaurantLocalHourMinute(new Date('2026-01-15T12:00:00.000Z'),{timeZone:'Europe/London'})).toBe('12:00');
    expect(restaurantLocalHourMinute(new Date('2026-07-15T12:00:00.000Z'),{timeZone:'Europe/London'})).toBe('13:00');
  });

  it('requires a tenant-scoped settings provider', () => {
    expect(() => createPeakHourService({})).toThrow(TypeError);
  });
});
