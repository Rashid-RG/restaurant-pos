// Non-sensitive checkout preference only; never store card details, bank
// information, authentication data, or assumed delivery confirmation.
export const CHECKOUT_PREF_METHODS=Object.freeze(['cash','bank_transfer']);
export function checkoutPrefKey(tenantId,customerId){
  const tenant=String(tenantId||'').trim(),customer=String(customerId||'').trim();
  return tenant&&customer?'gastroflow_checkout_payment:v1:'+encodeURIComponent(tenant)+':'+encodeURIComponent(customer):'';
}
export function readCheckoutPaymentPreference(storage,tenantId,customerId){
  const key=checkoutPrefKey(tenantId,customerId);
  if(!key||!storage)return null;
  try{
    const method=storage.getItem(key);
    return CHECKOUT_PREF_METHODS.includes(method)?method:null;
  }catch{return null;}
}
export function saveCheckoutPaymentPreference(storage,tenantId,customerId,method){
  const key=checkoutPrefKey(tenantId,customerId);
  if(!key||!CHECKOUT_PREF_METHODS.includes(method)||!storage)return false;
  try{storage.setItem(key,method);return true;}catch{return false;}
}
export function savedDeliveryCoordinates(address){
  if(!address||typeof address!=='object')return null;
  // Text-only profile addresses cannot be assumed to be an entrance GPS pin.
  if(address.lat===null||address.lat===undefined||address.lat===''||address.lng===null||address.lng===undefined||address.lng==='')return null;
  const lat=Number(address.lat),lng=Number(address.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return null;
  return {lat,lng,label:String(address.addressLine||address.label||'Saved delivery pin')};
}
