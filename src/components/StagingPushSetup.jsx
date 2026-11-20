import React, { useState } from 'react';

export default function StagingPushSetup() {
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const capacitor = window.Capacitor;

  if (window.location.origin !== 'https://gastroflow-staging.onrender.com' ||
      !capacitor?.isNativePlatform() || !capacitor.isPluginAvailable('FirebaseMessaging')) {
    return null;
  }

  async function registerDevice() {
    setPending(true);
    setStatus('');
    setToken('');
    try {
      const messaging = capacitor.Plugins.FirebaseMessaging;
      const permission = await messaging.requestPermissions();
      if (permission.receive !== 'granted') {
        setStatus('Allow notifications in your device settings to register this device.');
        return;
      }
      const registration = await messaging.getToken();
      setToken(registration.token);
    } catch {
      setStatus('Could not register this device for staging notifications.');
    } finally {
      setPending(false);
    }
  }

  return (
    <details>
      <summary>Staging notifications</summary>
      <button type="button" disabled={pending} onClick={registerDevice}>
        {pending ? 'Registering device…' : 'Register this device'}
      </button>
      {status && <p role="status">{status}</p>}
      {token && <label>FCM registration token <input readOnly value={token} /></label>}
    </details>
  );
}
