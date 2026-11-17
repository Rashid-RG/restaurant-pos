import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {shouldRefreshNativeTrackingOnResume,NATIVE_RESUME_MIN_INTERVAL_MS} from '../apps/customer-web/src/utils/native-tracking-resume.js';

const active={nativeBuild:true,orderId:'ord_123',status:'out_for_delivery',visible:true,online:true,now:100000,lastResumeAt:0};
describe('GastroFlow Food native order tracking resume',()=>{
 it('immediately reconciles private status after the installed app is foregrounded',()=>{
   expect(shouldRefreshNativeTrackingOnResume(active)).toBe(true);
   expect(shouldRefreshNativeTrackingOnResume({...active,lastResumeAt:100000-NATIVE_RESUME_MIN_INTERVAL_MS})).toBe(true);
 });
 it('does not change hosted browser tracking or perform hidden/offline calls',()=>{
   expect(shouldRefreshNativeTrackingOnResume({...active,nativeBuild:false})).toBe(false);
   expect(shouldRefreshNativeTrackingOnResume({...active,visible:false})).toBe(false);
   expect(shouldRefreshNativeTrackingOnResume({...active,online:false})).toBe(false);
 });
 it('does not request private data without a tracked order or after terminal status',()=>{
   expect(shouldRefreshNativeTrackingOnResume({...active,orderId:''})).toBe(false);
   for(const status of ['delivered','completed','cancelled','rejected','refunded','partially_refunded']){
     expect(shouldRefreshNativeTrackingOnResume({...active,status})).toBe(false);
   }
 });
 it('throttles rapid focus, online and visibilitychange bursts',()=>{
   expect(shouldRefreshNativeTrackingOnResume({...active,lastResumeAt:99999})).toBe(false);
   expect(shouldRefreshNativeTrackingOnResume({...active,lastResumeAt:100000-NATIVE_RESUME_MIN_INTERVAL_MS+1})).toBe(false);
   expect(shouldRefreshNativeTrackingOnResume({...active,lastResumeAt:100005})).toBe(false);
 });
 it('binds native listeners and removes them during view cleanup',()=>{
   const src=readFileSync('apps/customer-web/src/views/OrderTrackingView.jsx','utf8');
   expect(src).toContain('shouldRefreshNativeTrackingOnResume({');
   for(const event of ['visibilitychange','focus','online']){
     expect(src).toContain("addEventListener('"+event+"',refreshOnNativeResume)");
     expect(src).toContain("removeEventListener('"+event+"',refreshOnNativeResume)");
   }
   expect(src).toContain('fetchOrder(current.id,{silent:true})');
 });
});
