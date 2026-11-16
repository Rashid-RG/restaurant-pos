// Optional, privacy-minimal operational alerts. This is disabled until an
// operator sets OPS_ALERT_WEBHOOK_URL in private environment configuration.
// Never send exception messages, SQL, URLs, tenant identifiers or customer data.
const ALLOWED_EVENTS=new Set(['database_unavailable','database_recovered','backup_failed','backup_succeeded']);
export async function sendOperationalAlert(event,{
  url=process.env.OPS_ALERT_WEBHOOK_URL,
  fetchImpl=globalThis.fetch,
  timeoutMs=5000
}={}){
  if(!ALLOWED_EVENTS.has(event))return {sent:false,reason:'unsupported_event'};
  if(!url)return {sent:false,reason:'not_configured'};
  let parsed;
  try{parsed=new URL(url);}catch{return {sent:false,reason:'invalid_configuration'};}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||parsed.hash)
    return {sent:false,reason:'invalid_configuration'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(10000,timeoutMs)));
  timer.unref?.();
  try{
    const response=await fetchImpl(parsed.href,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source:'gastroflow',event,at:new Date().toISOString()}),
      signal:controller.signal,
      redirect:'error'
    });
    return {sent:response.ok===true,reason:response.ok===true?'delivered':'remote_rejected'};
  }catch{return {sent:false,reason:'delivery_failed'};}
  finally{clearTimeout(timer);}
}

export async function runMonitoredBackup(task,notify=sendOperationalAlert){
  try{return await task();}
  catch(error){
    // Notification outages must not mask the original backup failure.
    try{await notify('backup_failed');}catch{}
    throw error;
  }
}
