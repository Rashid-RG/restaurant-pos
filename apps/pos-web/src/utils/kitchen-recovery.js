// Keep the same retry token across a lost response. The server recognizes
// only an exact same-operator, same-action, previous-revision retry.
export function createKitchenAction(ticket,state,lineId,newKey=()=>crypto.randomUUID()){
  return {
    revision:ticket.revision,
    state,
    ...(lineId?{lineId}:{}),
    ...(ticket.state==='pending'?{etaMinutes:25}:{}),
    retryKey:newKey()
  };
}
export function isTransientKitchenFailure(error){
  const status=Number(error?.status);
  return !Number.isInteger(status)||status===0||status===408||status===429||status>=500;
}
