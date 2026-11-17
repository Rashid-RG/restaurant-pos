// Native customer packages must not navigate to the WebView's local /driver-app
// route. The driver portal is a separate application with its own login/session.
// The hosted customer web app retains its established driver shortcut.
export function showHostedDriverShortcut(mode) {
  return mode !== 'native';
}
