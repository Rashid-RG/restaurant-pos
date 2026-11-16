import {describe,it,expect,vi} from 'vitest';
import {sendOperationalAlert,runMonitoredBackup} from '../lib/ops-alerts.js';
import {createOperationalMonitor} from '../lib/operational-monitor.js';

describe('Optional operational alert delivery',()=>{
  it('does not contact external services when unconfigured',async()=>{
    const mock=vi.fn();
    expect(await sendOperationalAlert('database_unavailable',{url:'',fetchImpl:mock})).toEqual({sent:false,reason:'not_configured'});
    expect(mock).not.toHaveBeenCalled();
    expect(await sendOperationalAlert('not_allowed',{url:'https://alerts.example.test/hook',fetchImpl:mock})).toEqual({sent:false,reason:'unsupported_event'});
    expect(mock).not.toHaveBeenCalled();
  });
  it('refuses insecure, credentialed and malformed destinations',async()=>{
    const mock=vi.fn();
    for(const url of ['http://alerts.example.test/hook','https://user:password@alerts.example.test/hook','file:///tmp/file','not-a-url','https://alerts.example.test/hook#fragment']){
      expect((await sendOperationalAlert('backup_failed',{url,fetchImpl:mock})).sent).toBe(false);
    }
    expect(mock).not.toHaveBeenCalled();
  });
  it('sends only fixed, private event data over HTTPS without redirects',async()=>{
    const mock=vi.fn().mockResolvedValue({ok:true});
    const result=await sendOperationalAlert('database_unavailable',{
      url:'https://alerts.example.test/hook/secret-path',fetchImpl:mock
    });
    expect(result).toEqual({sent:true,reason:'delivered'});
    const [url,request]=mock.mock.calls[0];
    expect(url).toBe('https://alerts.example.test/hook/secret-path');
    expect(request.method).toBe('POST');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toMatchObject({source:'gastroflow',event:'database_unavailable'});
    expect(Object.keys(JSON.parse(request.body)).sort()).toEqual(['at','event','source']);
    expect(JSON.stringify(request.body)).not.toMatch(/secret-path|tenant|customer|password/i);
  });
  it('reports endpoint rejection and network errors without disclosing response content',async()=>{
    const url='https://alerts.example.test/hook';
    const rejected=await sendOperationalAlert('backup_failed',{url,fetchImpl:vi.fn().mockResolvedValue({ok:false,status:503})});
    expect(rejected).toEqual({sent:false,reason:'remote_rejected'});
    const failed=await sendOperationalAlert('backup_failed',{url,fetchImpl:vi.fn().mockRejectedValue(new Error('secret token error'))});
    expect(failed).toEqual({sent:false,reason:'delivery_failed'});
  });
  it('notifies once for an unsuccessful backup and preserves the original error',async()=>{
    const error=new Error('backup storage failure');
    const notifier=vi.fn().mockRejectedValue(new Error('notification failure'));
    await expect(runMonitoredBackup(async()=>{throw error;},notifier)).rejects.toBe(error);
    expect(notifier).toHaveBeenCalledOnce();
    expect(notifier).toHaveBeenCalledWith('backup_failed');
    await expect(runMonitoredBackup(async()=>7,notifier)).resolves.toBe(7);
    expect(notifier).toHaveBeenCalledTimes(1);
  });
  it('emits just one webhook attempt per outage and one recovery event',async()=>{
    const events=[];
    const monitor=createOperationalMonitor({log:()=>{},notify:event=>events.push(event)});
    monitor.probeFailed();monitor.probeFailed();monitor.probeFailed();monitor.probeFailed();
    monitor.probeSucceeded();monitor.probeSucceeded();
    expect(events).toEqual(['database_unavailable','database_recovered']);
  });
});
