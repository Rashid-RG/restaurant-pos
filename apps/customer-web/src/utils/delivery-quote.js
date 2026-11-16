// A fee quote is a scoped, provisional UI estimate, not permission to place an order.
// The checkout backend always recomputes delivery eligibility and final charges.
export function deliveryQuoteKey({tenantId,lat,lng,subtotal}={}) {
  if (!tenantId || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat)>90 || Math.abs(lng)>180 || !Number.isFinite(subtotal) || subtotal<0) return null;
  return JSON.stringify([String(tenantId),lat,lng,Math.round(subtotal*100)/100]);
}
export function validDeliveryQuote(data) {
  if (!data || data.isOutOfRange===true || typeof data.totalFee!=='number' ||
      !Number.isFinite(data.totalFee) || data.totalFee<0) return false;
  return true;
}
export function deliveryQuoteReady({type,key,quote}={}) {
  return type!=='delivery' || !!key && quote?.key===key && quote.status==='ready' && validDeliveryQuote(quote.data);
}
