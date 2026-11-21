// Native WebViews cannot reuse the hosted PWA's same-site SSE access cookie.
// Keep private polling and browser push separate until native auth/push are audited.
export function canUseHostedOrderStream(nativeBuild) {
  return nativeBuild !== true;
}
export function canUseHostedWebPush(nativeBuild) {
  return nativeBuild !== true;
}
