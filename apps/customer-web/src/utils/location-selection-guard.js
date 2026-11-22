// The Stores tab must never commit an address geocoded for a previous
// selection after the customer edits the query or switches to GPS/map pin.
export function isCurrentLocationSelection(requestId,latestRequestId){
  return Number.isSafeInteger(requestId) &&
    Number.isSafeInteger(latestRequestId) &&
    requestId>0 && requestId===latestRequestId;
}
