import {describe,expect,it,vi} from 'vitest';
import {verifyNativeSecureSessionBridge}
  from '../apps/customer-web/src/utils/native-secure-session-diagnostic.js';

const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const uuid=()=>{let i=0;return ()=>ids[i++];};
const makeStore=()=>{
  const values=new Map();
  return {
    get:vi.fn(async key=>values.get(key)??null),
    set:vi.fn(async(key,value)=>{values.set(key,value)}),
    remove:vi.fn(async key=>{values.delete(key)})
  };
};

describe('GastroFlow Food native secure-storage disposable self-test',()=>{
  it('verifies native read, write, read-back and delete with a random disposable key',async()=>{
    const store=makeStore();
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:true,reason:'verified'});
    const key=store.set.mock.calls[0][0];
    expect(key).toMatch(/^gastroflow_customer_token:__native_probe_/);
    expect(store.get).toHaveBeenCalledTimes(3);
    expect(store.remove).toHaveBeenCalledWith(key);
  });
  it('does nothing if native bridge or secure random generator is missing',async()=>{
    expect(await verifyNativeSecureSessionBridge({secureStore:null,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'native-bridge-unavailable'});
    expect(await verifyNativeSecureSessionBridge({secureStore:makeStore(),randomUUID:()=>''}))
      .toEqual({ready:false,reason:'secure-random-unavailable'});
  });
  it('does not modify a pre-existing key in the extremely unlikely case of a collision',async()=>{
    const store=makeStore();
    store.get.mockResolvedValueOnce('existing-value');
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'probe-key-collision'});
    expect(store.set).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
  it('rejects a falsely successful native storage write and removes probe',async()=>{
    const store=makeStore();
    store.get.mockResolvedValueOnce(null).mockResolvedValueOnce('wrong');
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'native-readback-failed'});
    expect(store.remove).toHaveBeenCalledTimes(1);
  });
  it('detects a native deletion that falsely reports success and retries cleanup',async()=>{
    const store=makeStore();
    // First deletion is acknowledged but does not remove the disposable key.
    const realRemove=store.remove.getMockImplementation();
    store.remove.mockImplementationOnce(async()=>{}).mockImplementation(realRemove);
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'native-delete-failed'});
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(await store.get(store.set.mock.calls[0][0])).toBeNull();
  });
  it('returns sanitized errors and cleans up without exposing test values',async()=>{
    const store=makeStore();
    store.get.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('sensitive payload'));
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'native-bridge-error'});
    expect(store.remove).toHaveBeenCalledTimes(1);
  });
  it('reports failed delete and attempts a second cleanup safely',async()=>{
    const store=makeStore();
    store.remove.mockRejectedValueOnce(new Error('unavailable'));
    expect(await verifyNativeSecureSessionBridge({secureStore:store,randomUUID:uuid()}))
      .toEqual({ready:false,reason:'native-bridge-error'});
    expect(store.remove).toHaveBeenCalledTimes(2);
  });
});
