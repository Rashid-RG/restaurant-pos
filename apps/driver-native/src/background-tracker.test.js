import {describe,it,expect,vi} from 'vitest';
import {createNativeTrackingSession} from './background-tracker.js';

const now=1800000000000;
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture({orders=[]}={}){
  let listener=null;
  const plugin={
    addWatcher:vi.fn(async(options,cb)=>{listener=cb;return 'native-watch';}),
    removeWatcher:vi.fn(async()=>{})
  };
  const httpPost=vi.fn(async()=>({status:200}));
  let token='verified-rider-jwt';
  const tracker=createNativeTrackingSession({
    plugin,httpPost,apiOrigin:'https://gastroflow-staging.onrender.com/',
    getToken:()=>token,getActiveOrders:()=>orders,clock:()=>now
  });
  return {tracker,plugin,httpPost,emit:p=>listener?.(p),removeToken:()=>{token='';}};
}
const fix={latitude:6.9271,longitude:79.8612,accuracy:12,time:now-1000};
describe('native background GPS session',()=>{
  it('requires explicit shift location consent',async()=>{
    const f=fixture();
    await expect(f.tracker.start({onDuty:true,locationConsent:false})).rejects.toThrow();
    expect(f.plugin.addWatcher).not.toHaveBeenCalled();
  });
  it('starts a native watcher and uploads assigned delivery fixes securely',async()=>{
    const f=fixture({orders:[{id:'order-a',status:'out_for_delivery'}]});
    expect(await f.tracker.start({onDuty:true,locationConsent:true})).toBe(true);
    f.emit(fix);await flush();
    expect(f.httpPost).toHaveBeenCalledWith(expect.objectContaining({
      url:'https://gastroflow-staging.onrender.com/api/public/driver/location',
      headers:expect.objectContaining({Authorization:'Bearer verified-rider-jwt'}),
      data:expect.objectContaining({orderId:'order-a',lat:6.9271})
    }));
    await f.tracker.stop();
    expect(f.plugin.removeWatcher).toHaveBeenCalledWith({id:'native-watch'});
  });
  it('reports a rejected active-order upload rather than claiming rider GPS is shared',async()=>{
    let listener;
    const statuses=[];
    const plugin={addWatcher:vi.fn(async(_settings,callback)=>{listener=callback;return 'watch';}),removeWatcher:vi.fn(async()=>{})};
    const httpPost=vi.fn(async()=>({status:422}));
    const tracker=createNativeTrackingSession({
      plugin,httpPost,apiOrigin:'https://gastroflow-staging.onrender.com/',
      getToken:()=> 'rider-test-token',getActiveOrders:()=>[{id:'delivery-one',status:'out_for_delivery'}],
      clock:()=>now,onStatus:status=>statuses.push(status)
    });
    await tracker.start({onDuty:true,locationConsent:true});
    listener(fix);
    await flush();
    expect(statuses).toContain('upload_error');
    expect(statuses).not.toContain('upload_success');
    await tracker.stop();
  });
  it('reports server-accepted active-order GPS after a successful upload',async()=>{
    let listener;
    const statuses=[];
    const plugin={addWatcher:vi.fn(async(_settings,callback)=>{listener=callback;return 'watch';}),removeWatcher:vi.fn(async()=>{})};
    const tracker=createNativeTrackingSession({
      plugin,httpPost:vi.fn(async()=>({status:200})),apiOrigin:'https://gastroflow-staging.onrender.com/',
      getToken:()=> 'rider-test-token',getActiveOrders:()=>[{id:'delivery-one',status:'out_for_delivery'}],
      clock:()=>now,onStatus:status=>statuses.push(status)
    });
    await tracker.start({onDuty:true,locationConsent:true});
    listener(fix);
    await flush();
    expect(statuses).toContain('upload_success');
    await tracker.stop();
  });
  it('rejects invalid coordinates without uploading',async()=>{
    const f=fixture({orders:[{id:'order-a'}]});
    await f.tracker.start({onDuty:true,locationConsent:true});
    f.emit({...fix,accuracy:300});await flush();
    expect(f.httpPost).not.toHaveBeenCalled();
  });
  it('does not publish idle-rider positions without separate discovery consent',async()=>{
    const f=fixture();
    await f.tracker.start({onDuty:true,locationConsent:true,discoveryConsent:false});
    f.emit(fix);await flush();
    expect(f.httpPost).not.toHaveBeenCalled();
  });
  it('allows explicitly consented idle-rider presence but stops/revokes it',async()=>{
    const f=fixture();
    await f.tracker.start({onDuty:true,locationConsent:true,discoveryConsent:true});
    f.emit(fix);await flush();
    expect(f.httpPost.mock.calls.some(([v])=>v.url.endsWith('/public/driver/on-duty-location'))).toBe(true);
    await f.tracker.stop();
    expect(f.httpPost.mock.calls.some(([v])=>v.url.endsWith('/public/driver/off-duty-location'))).toBe(true);
    f.emit({...fix,time:now});await flush();
    expect(f.httpPost.mock.calls.filter(([v])=>v.url.endsWith('/public/driver/on-duty-location'))).toHaveLength(1);
  });
  it('does not start if driver token has expired or is missing',async()=>{
    const f=fixture();f.removeToken();
    await expect(f.tracker.start({onDuty:true,locationConsent:true})).rejects.toThrow();
  });
});
