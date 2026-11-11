import {describe,it,expect} from 'vitest';
import {validateSchedule,scheduleCapacity,slotsFrom,SLOT_MS} from '../lib/scheduling-capacity.js';
describe('tenant calendar order reservation validation',()=>{
  const now=Date.parse('2026-11-11T09:00:00Z');
  it('accepts a future aligned 15-minute slot',()=>{
    expect(validateSchedule(now+60*60000,now,30)).toMatchObject({valid:true,scheduled:true,when:now+60*60000});
  });
  it('rejects stale, unaligned and distant slots',()=>{
    expect(validateSchedule(now+20*60000,now,30).valid).toBe(false);
    expect(validateSchedule(now+35*60000,now,30).valid).toBe(false);
    expect(validateSchedule(now+8*86400000,now,30).valid).toBe(false);
  });
  it('uses safe restaurant capacity bounds',()=>{
    expect(scheduleCapacity('4')).toBe(4);
    expect(scheduleCapacity('101')).toBe(6);
    expect(scheduleCapacity('-2')).toBe(6);
    expect(scheduleCapacity('foo')).toBe(6);
  });
  it('generates aligned contiguous slots',()=>{
    const slots=slotsFrom(now+1000,6);
    expect(slots).toHaveLength(6);
    expect(slots[0]%SLOT_MS).toBe(0);
    expect(slots[1]-slots[0]).toBe(SLOT_MS);
  });
});
