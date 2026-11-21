// Installed Capacitor apps do not use the hosted website's PWA update lifecycle.
export function useHostedPwaUpdatePrompt(mode) {
  return mode !== 'native';
}
