import {describe,it,expect,vi} from 'vitest';
import {normalizeVerifiedBrevoEvent,recordVerifiedBrevoEvent} from '../lib/communications/platform-brevo-receipts.js';
const env={PLATFORM_COMMUNICATIONS_STAGE:'staging',PLATFORM_COMMUNICATIONS_ENABLED:'true',
 PLATFORM_COMMUNICATIONS_EMAIL_MODE:'sandbox'};
const event={messageId:'brevo-test-message-1',event:'delivered',timestamp:1700000000000};
describe('Verified Brevo sandbox receipt lifecycle',()=>{
 it('requires authenticated ingestion and staging feature gates',async()=>{
  const dbGet=vi.fn(),dbRun=vi.fn();
  const denied=await recordVerifiedBrevoEvent({dbGet,dbRun,event,env,verified:false});
  expect(denied).toMatchObject({recorded:false,reason:'DISABLED_OR_UNVERIFIED'});
  const prod=await recordVerifiedBrevoEvent({dbGet,dbRun,event,env:{...env,PLATFORM_COMMUNICATIONS_STAGE:'production'},verified:true});
  expect(prod.recorded).toBe(false);
  expect(dbGet).not.toHaveBeenCalled();expect(dbRun).not.toHaveBeenCalled();
 });
 it('rejects arbitrary event names and missing provider ids',()=>{
  expect(normalizeVerifiedBrevoEvent({...event,event:'anything'})).toBeNull();
  expect(normalizeVerifiedBrevoEvent({...event,messageId:''})).toBeNull();
  expect(normalizeVerifiedBrevoEvent({...event,timestamp:-1})).toBeNull();
  expect(normalizeVerifiedBrevoEvent(event)).toEqual({messageId:event.messageId,type:'delivered',timestamp:event.timestamp});
 });
 it('never updates an unknown provider message',async()=>{
  const dbGet=vi.fn(async()=>null),dbRun=vi.fn();
  const result=await recordVerifiedBrevoEvent({dbGet,dbRun,event,env,verified:true});
  expect(result).toMatchObject({recorded:false,reason:'UNKNOWN_MESSAGE'});
  expect(dbRun).not.toHaveBeenCalled();
 });
 it('records a verified event using a guarded provider-message-id update',async()=>{
  const dbGet=vi.fn(async()=>({eventStatus:'accepted',acceptedAt:100,eventAt:null}));
  const dbRun=vi.fn(async()=>({changes:1}));
  const result=await recordVerifiedBrevoEvent({dbGet,dbRun,event,env,verified:true,now:300});
  expect(result).toEqual({recorded:true,reason:'UPDATED'});
  const [sql,args]=dbRun.mock.calls[0];
  expect(sql).toContain('eventStatus NOT IN');
  expect(args).toEqual(['delivered',event.timestamp,300,event.messageId,event.timestamp]);
 });
 it('ignores terminal and older events without changing receipt status',async()=>{
  const dbGet=vi.fn(async()=>({eventStatus:'delivered',eventAt:1700000000000})),dbRun=vi.fn();
  expect((await recordVerifiedBrevoEvent({dbGet,dbRun,event,env,verified:true})).reason).toBe('DUPLICATE_OR_STALE');
  dbGet.mockResolvedValue({eventStatus:'soft_bounce',eventAt:1700000000001});
  expect((await recordVerifiedBrevoEvent({dbGet,dbRun,event,env,verified:true})).recorded).toBe(false);
  expect(dbRun).not.toHaveBeenCalled();
 });
});
