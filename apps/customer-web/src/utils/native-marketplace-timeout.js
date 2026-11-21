// Bound read-only marketplace loads inside an installed mobile WebView.
// Hosted web behavior is unchanged. Never wrap checkout or payment writes.
// Both the screen-unmount abort signal and the native timeout stay active.
export const NATIVE_MARKETPLACE_TIMEOUT_MS = 15000;

export function marketplaceReadSignal({nativeBuild=false,parentSignal,timeoutMs=NATIVE_MARKETPLACE_TIMEOUT_MS}={}){
  if(!nativeBuild)return parentSignal;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)
    throw new RangeError('Invalid native marketplace request timeout');
  const timeout=AbortSignal.timeout(timeoutMs);
  return parentSignal?AbortSignal.any([parentSignal,timeout]):timeout;
}
