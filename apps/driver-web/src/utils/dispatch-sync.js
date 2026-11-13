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
