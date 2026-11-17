// Keep customer authentication independent from public order-tracking links.
// A rejected X-Order-Tracking token must never log a customer out.
export function shouldClearCustomerTokenForResponse({
  status, message, customerToken, authorizationHeader
}={}){
  if(status!==401 && status!==403)return false;
  if(typeof customerToken!=='string'||!customerToken)return false;
  if(authorizationHeader!==`Bearer ${customerToken}`)return false;
  return /(?:token|session|credential).*(?:expired|invalid|revoked)|(?:expired|invalid|revoked).*(?:token|session|credential)/i.test(String(message||''));
}
