// Small, testable helpers for resilient dispatch and customer order refreshes.
// Only a response from the currently active request may replace visible state.
export function createDispatchRequestGate() {
  let generation=0;
  let inFlight=false;
  return {
    start() {if(inFlight)return null;inFlight=true;return ++generation;},
    isCurrent(token) {return token!==null&&token===generation;},
    finish(token) {if(token===generation)inFlight=false;},
    invalidate() {generation++;inFlight=false;},
  };
}

export function shouldClearTrackedOrder(error) {
  const status=Number(error?.status??error?.statusCode);
  return [401,403,404,410].includes(status);
}

export function shouldRetainTrackedOrder(error) {
  const status=Number(error?.status||error?.statusCode);
  // Transport failures, timeouts and server errors do not invalidate
  // the last authoritative order snapshot.
  return !Number.isInteger(status)||status===0||status===408||status===429||status>=500;
}

export function latestDispatchTickets(payload) {
  return {
    assigned:Array.isArray(payload?.assigned)?payload.assigned:[],
    unassigned:Array.isArray(payload?.unassigned)?payload.unassigned:[],
    completed:Array.isArray(payload?.completed)?payload.completed:[],
  };
}

// Every dispatch refresh must terminate even if the network hangs. An AbortController
// cancels the fetch and releases the gate on timeout, logout and account changes.
export function createDispatchTimeout(timeoutMs=12000){
  const controller=new AbortController();
  const delay=Math.max(1000,Math.min(60000,Number(timeoutMs)||12000));
  const timer=setTimeout(()=>controller.abort(),delay);
  return {signal:controller.signal,cancel:()=>{clearTimeout(timer);controller.abort();},finish:()=>clearTimeout(timer)};
}
