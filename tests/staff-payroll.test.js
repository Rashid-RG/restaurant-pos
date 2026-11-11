import {describe,it,expect} from 'vitest';
import { payrollPeriod, attendanceMinutes, previewPayroll } from '../lib/payroll.js';

describe('Staff payroll computation', () => {
  it('clips staff sessions to the tenant-local month', () => {
    const {start,end}=payrollPeriod('2026-11','Asia/Qatar');
    expect(start).toBe(Date.parse('2026-10-31T21:00:00Z'));
    expect(end).toBe(Date.parse('2026-11-30T21:00:00Z'));
    const sessions=[
      {clockIn:start-3600000,clockOut:start+3600000},
      {clockIn:start+2*3600000,clockOut:start+3*3600000},
      {clockIn:end-1800000,clockOut:end+1800000},
      {clockIn:end+3600000,clockOut:end+7200000}
    ];
    expect(attendanceMinutes(sessions,start,end)).toEqual({minutes:150,sessions:3});
  });
  it('handles DST length and leaves unfinished sessions unpaid', () => {
    const {start,end}=payrollPeriod('2026-03','Europe/London');
    expect(end-start).toBe(31*86400000-3600000);
    const minutes=attendanceMinutes([{clockIn:start+1000,clockOut:null},{clockIn:start+60000,clockOut:start+3600000+60000}],start,end);
    expect(minutes).toEqual({minutes:60,sessions:1});
  });
  it('calculates hourly and monthly pay with explicit allowances',()=>{
    const users=[{id:'staff-a',username:'A',role:'cashier'},{id:'staff-b',username:'B',role:'manager'}];
    const compensation=[
      {userId:'staff-a',payType:'hourly',rate:100,allowance:250,deduction:50},
      {userId:'staff-b',payType:'monthly',rate:40000,allowance:500,deduction:100}
    ];
    const {start}=payrollPeriod('2026-11','Asia/Qatar');
    const entries=[{userId:'staff-a',clockIn:start+1000,clockOut:start+3601000}];
    const result=previewPayroll({month:'2026-11',timeZone:'Asia/Qatar',users,compensation,entries});
    expect(result[0]).toMatchObject({hours:1,basicPay:100,allowance:250,deduction:50,totalPay:300});
    expect(result[1]).toMatchObject({hours:0,basicPay:40000,totalPay:40400});
  });
  it('rejects malformed payroll months',()=>{
    expect(()=>payrollPeriod('2026-13','Asia/Qatar')).toThrow();
    expect(()=>payrollPeriod('2026-1','Asia/Qatar')).toThrow();
  });
});
