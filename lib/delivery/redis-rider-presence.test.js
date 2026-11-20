import {describe,it,expect,vi} from 'vitest';
import {createRedisRiderPresence} from './redis-rider-presence.js';

const now=1800000000000;
function harness(){
  const memory=new Map();
  let time=now;
  const client={
    eval:vi.fn(async(_script,{keys,arguments:args})=>{
      const key=keys[0],old=memory.get(key);
      if(old&&old.expires>time&&JSON.parse(old.data).recordedAt>=Number(args[1]))return 'old_fix';
      memory.set(key,{data:args[0],expires:time+Number(args[2])});return 'accepted';
    }),
    scan:vi.fn(async(_cursor,{MATCH})=>({
      cursor:0,keys:[...memory.entries()]
        .filter(([key,value])=>key.startsWith(MATCH.slice(0,-1))&&value.expires>time)
        .map(([key])=>key)
    })),
    mGet:vi.fn(async keys=>keys.map(key=>{
      const value=memory.get(key);return value&&value.expires>time?value.data:null;
    })),
    del:vi.fn(async key=>Number(memory.delete(key)))
  };
  const store=createRedisRiderPresence({client,clock:()=>time});
  return {store,client,memory,advance:ms=>time+=ms};
}
const ping=(fields={})=>({
  tenantId:'rest-a',driverId:'rider-a',lat:6.9271,lng:79.8612,
  accuracyMeters:10,recordedAt:now-1000,consent:true,...fields
});
describe('shared Redis rider presence',()=>{
  it('rejects absent consent and invalid fixes without writing',async()=>{
    const {store,client}=harness();
    for(const fields of [{consent:false},{lat:91},{accuracyMeters:201},{recordedAt:now-50000}])
      expect((await store.record(ping(fields))).accepted).toBe(false);
    expect(client.eval).not.toHaveBeenCalled();
  });
  it('isolates tenants, hashes Redis keys, and prevents fix replay',async()=>{
    const {store,memory}=harness();
    expect((await store.record(ping())).accepted).toBe(true);
    expect((await store.record(ping())).reason).toBe('old_fix');
    expect(await store.list('rest-b')).toEqual([]);
    expect((await store.list('rest-a')).map(v=>v.driverId)).toEqual(['rider-a']);
    expect([...memory.keys()][0]).not.toContain('rest-a');
    expect([...memory.keys()][0]).not.toContain('rider-a');
    expect(await store.revoke('rest-b','rider-a')).toBe(false);
    expect(await store.revoke('rest-a','rider-a')).toBe(true);
    expect(await store.list('rest-a')).toEqual([]);
  });
  it('automatically expires presence after TTL',async()=>{
    const h=harness();
    await h.store.record(ping());
    h.advance(91000);
    expect(await h.store.list('rest-a')).toEqual([]);
  });
  it('does not silently fall back to memory when Redis is unavailable',async()=>{
    const {store,client}=harness();
    client.eval.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(store.record(ping())).rejects.toThrow('redis unavailable');
  });
  it('ignores records under the wrong hashed key',async()=>{
    const h=harness();
    await h.store.record(ping());
    const [key,value]=[...h.memory.entries()][0];
    h.memory.set(key,{...value,data:JSON.stringify({...JSON.parse(value.data),driverId:'forged'})});
    expect(await h.store.list('rest-a')).toEqual([]);
  });
});
