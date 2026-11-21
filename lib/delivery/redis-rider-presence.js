import {createHash} from 'node:crypto';

/**
 * Redis-backed, tenant-scoped rider presence.
 * Inject an authenticated Redis v4 command client; no credentials or connection
 * details are stored in this module. No persistent data: all entries expire.
 *
 * Important: this adapter is not activated until the staging Redis connection
 * is configured. Fail closed on Redis errors; do not silently use stale memory.
 */
const CAS_FIX = `
local old=redis.call('GET',KEYS[1])
if old then
  local ok,v=pcall(cjson.decode,old)
  if ok and tonumber(v.recordedAt) >= tonumber(ARGV[2]) then
    return 'old_fix'
  end
end
redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[3])
return 'accepted'
`;

const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const tenantPrefix=t=>`gastroflow:rider-presence:v1:${digest(t)}:`;
const entryKey=(t,id)=>tenantPrefix(t)+digest(id);

export function createRedisRiderPresence({client,clock=Date.now,ttlMs=90000,maxScanned=2000}={}) {
  if(!client||typeof client.eval!=='function'||typeof client.scan!=='function'||
     typeof client.mGet!=='function'||typeof client.del!=='function')
    throw new TypeError('Authenticated Redis command client required');
  if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>90000)
    throw new TypeError('Presence TTL must be between 1 and 90 seconds');

  async function record({tenantId,driverId,lat,lng,accuracyMeters,recordedAt,consent}={}) {
    const now=clock();
    if(typeof tenantId!=='string'||!tenantId||typeof driverId!=='string'||!driverId||
       consent!==true||![lat,lng,accuracyMeters,recordedAt].every(Number.isFinite)||
       Math.abs(lat)>90||Math.abs(lng)>180||accuracyMeters<=0||accuracyMeters>150||
       recordedAt>now+10000||now-recordedAt>30000)
      return {accepted:false,reason:'invalid_fix'};
    const value=JSON.stringify({tenantId,driverId,lat,lng,accuracyMeters,recordedAt});
    const result=await client.eval(CAS_FIX,{
      keys:[entryKey(tenantId,driverId)],arguments:[value,String(recordedAt),String(ttlMs)]
    });
    return result==='accepted'?{accepted:true}:{accepted:false,reason:'old_fix'};
  }
  async function revoke(tenantId,driverId) {
    if(!tenantId||!driverId)return false;
    return Number(await client.del(entryKey(tenantId,driverId)))>0;
  }
  async function list(tenantId){
    if(typeof tenantId!=='string'||!tenantId)return [];
    const prefix=tenantPrefix(tenantId),matched=new Set();
    let cursor='0';
    // Bounded SCAN prevents one tenant from making dispatch unbounded.
    do {
      const page=await client.scan(cursor,{MATCH:prefix+'*',COUNT:100});
      cursor=String(page.cursor);
      for(const key of page.keys){
        matched.add(key);
        if(matched.size>maxScanned)throw new Error('Presence scan limit exceeded');
      }
    }while(cursor!=='0');
    if(!matched.size)return [];
    const keys=[...matched];
    const rows=[];
    for(let i=0;i<keys.length;i+=100){
      const results=await client.mGet(keys.slice(i,i+100));
      for(let j=0;j<results.length;j++){
        if(!results[j])continue;
        try{
          const fix=JSON.parse(results[j]);
          if(fix.tenantId!==tenantId||entryKey(fix.tenantId,fix.driverId)!==keys[i+j])
            continue;
          if(![fix.lat,fix.lng,fix.accuracyMeters,fix.recordedAt].every(Number.isFinite)||
            Math.abs(fix.lat)>90||Math.abs(fix.lng)>180||fix.accuracyMeters<=0||
            fix.accuracyMeters>150||clock()-fix.recordedAt>ttlMs||
            fix.recordedAt>clock()+10000)continue;
          rows.push(fix);
        }catch{/* Ignore malformed or expired Redis values. */}
      }
    }
    return rows;
  }
  return {record,revoke,list};
}
