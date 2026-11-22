// Customer login/session state belongs to a specific restaurant, not merely
// the current window. Ignore late responses after logout, unmount or switching.
export function customerSessionKey(tenant) {
  return 'gastroflow_customer_token:' + encodeURIComponent(tenant || 'default_tenant');
}
export function isCurrentCustomerAuthAttempt({scope,activeTenant,epoch}={}) {
  return !!scope && scope.mounted===true &&
    scope.tenant===activeTenant &&
    Number.isSafeInteger(epoch) && epoch===scope.epoch;
}
