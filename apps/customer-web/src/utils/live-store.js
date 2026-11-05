// A blocked or unsupported EventSource must never take down the storefront.
// Polling also refreshes price/menu changes missed during reconnects.
export function startStoreUpdates({url,onMessage,onRefresh,onConnection,EventSourceImpl=globalThis.EventSource,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}) {
 let source,closed=false,refreshing=false;
 const refresh=async()=>{if(closed||refreshing)return;refreshing=true;try{await onRefresh();}catch{if(!closed)onConnection('offline');}finally{refreshing=false;}};
 try{
  if(typeof EventSourceImpl!=='function')throw new Error('Live updates unavailable');
  source=new EventSourceImpl(url);
  source.onopen=()=>{if(!closed)onConnection('live');};
  source.onmessage=event=>{if(!closed)onMessage(event);};
  source.onerror=()=>{if(!closed){onConnection('polling');refresh();}};
 }catch{onConnection('polling');}
 const timer=setIntervalImpl(refresh,15000);
 return {refresh,close(){closed=true;clearIntervalImpl(timer);source?.close();}};
}
