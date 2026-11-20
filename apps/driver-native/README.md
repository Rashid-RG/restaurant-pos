# GastroDriver Native — Android and iPhone staging foundation

This folder belongs to the existing `restaurant-pos` repository. It does not replace the
current PWA or existing GastroFlow Food native application.

## Implemented foundation

- `src/background-tracker.js` provides a test-covered, opt-in controller for a native
  background location plugin. It rejects inaccurate or stale fixes, sends authenticated
  active-order GPS updates, optionally sends on-duty availability pings, and revokes
  location sharing on stop.
- `capacitor.config.json` defines a **separate app identity** for GastroDriver and
  points to the compiled existing GastroDriver frontend.
- Driver Vite now supports relative assets with `--mode native`, and native fetches
  require a build-time HTTPS `VITE_DRIVER_NATIVE_API_URL`.

## Still required before claiming a working native application

1. On an isolated development computer or cloud macOS worker, install the
   `apps/driver-native` dependencies and generate a committed package lock.
2. Build the driver PWA frontend with `VITE_DRIVER_NATIVE_API_URL` set to the authorized
   **staging** endpoint, via `npx vite build apps/driver-web --mode native`.
3. Generate actual Android and iOS Capacitor projects with `npx cap add android` /
   `npx cap add ios` from this directory, then `npx cap sync`.
4. The GastroDriver frontend now chooses the native background watcher through
   `registerPlugin('BackgroundGeolocation')` and `CapacitorHttp.post` when running
   in a compiled native build. **This is not a tested native binary yet**; validate
   the callback and permission behavior on Android and iPhone hardware.
5. Add native permissions: Android fine/coarse/background location, foreground-service
   location and notification permission where required. On iOS, add When-In-Use
   and Always usage descriptions plus `UIBackgroundModes: location` only when justified.
6. Test logout, off-duty revocation, background HTTP throttling, battery optimization,
   network recovery, Android foreground service, iOS lock-screen behavior and App
   Store/Play policy declarations on physical devices. A background watcher does not
   guarantee tracking after an iOS force-quit.
7. Obtain signing identities for iOS TestFlight and Android internal testing. Do not
   publish or claim commercial readiness without these tests and a user-approved staging release.

**Important:** Capacitor's standard Geolocation plugin alone is insufficient for
continuous background updates. This plan uses the Capacitor Community background-geolocation
plugin which requires an Android background notification and platform permission setup.
Never put a server routing secret in the native app.
