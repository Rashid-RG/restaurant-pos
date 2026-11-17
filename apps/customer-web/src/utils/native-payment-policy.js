// The hosted PayHere checkout uses browser callback/return URLs. Packaged
// Capacitor shells have https://localhost/capacitor://localhost origins, which
// must not be sent to an external payment gateway or a customer order.
// A native deep-link/verified HTTPS return flow is required before enabling.
export function canUseHostedPayHereGateway(mode) {
  return mode !== 'native';
}
export function payHerePaymentDisabled(mode,payhereEnabled) {
  return !canUseHostedPayHereGateway(mode) || payhereEnabled !== true;
}
