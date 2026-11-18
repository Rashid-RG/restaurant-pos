# GastroFlow Food — native push and real-device release acceptance

**Branch:** `codex/production-readiness`. **Staging:** `https://gastroflow-staging.onrender.com`.
This is an engineering release gate, not proof that iOS/Android push is already supported.

## Current working pieces

- Hosted customer website uses VAPID/Web Push. Its order subscription, event receipts, and tenant-order-scoped delivery are in `lib/customer-push.js`. Hosted push must not be reused for native FCM/APNs without a separate authenticated native-device registration model.
- Packaged Android/iOS builds continue to use authorized order-status snapshot polling. Browser-only push and cookie-bound SSE are intentionally disabled in native mode.
- Android has a Keystore-based Capacitor session plugin, but login is **not migrated or enabled**.
- iOS has a Keychain plugin template and a gated Xcode integration step; actual iOS simulator compilation and Keychain behavior are unverified.

## Required native notification architecture

1. **Provider configuration.** Provision a dedicated staging Firebase project for Android FCM; configure APNs/Apple capabilities and Firebase APNs authentication if using the same FCM client abstraction on iOS. Keep credentials only in approved GitHub/Render secrets, never in Git or APK assets when they are server secrets.
2. **Client opt-in.** Request push permission only after customer action. Android 13+ notification permission, iOS authorization, token renewal, foreground presentation and tapped-notification delivery all need actual device tests. Denial must not block ordering or tracking.
3. **Tenant-bound device enrollment.** Store the device token using a new server endpoint that requires authenticated customer identity; require the selected restaurant tenant match the verified customer account. Do not accept tenant or customer identity solely from the request body. Limit token length, platform, active installations and retention.
4. **Order visibility.** An event is deliverable only when the authenticated customer is authorized for the committed order and its tenant. A device registered to Restaurant A must never receive Restaurant B's order notification after logout or restaurant switching.
5. **Payload minimization.** Public lock-screen push contains a generic status and an opaque order reference; no addresses, phone numbers, access tokens or detailed order contents. Resolve private details with an authenticated HTTPS request when opened.
6. **Revocation.** Remove or disable old tokens on logout, account removal, token rotation, tenant switching and provider 404/410-style invalidation. Push delivery is best effort; in-app tracking remains authoritative.
7. **Reliability.** Deduplicate by tenant + order + recipient-device + committed status; handle provider retries, out-of-order events and revoked orders without fabricating milestones.
8. **Observability.** Monitor send/receipt failure rates without logging raw device tokens or customer secrets. Separate staging/production credentials, bundle IDs and app IDs.

## Native release execution sequence

- [x] Android customer project with isolated staging ID, native source and branding
- [x] Android Keystore plugin source, JS adapter and source-level tests
- [x] iOS Keychain plugin source, JS adapter and manually dispatched simulator build integration
- [x] Dormant, verified-before-delete native session migration policy and tenant-isolation tests
- [ ] **Android:** Confirm Gradle/SDK 36 variant compiles, inspect APK and test upgrade signing on physical phone
- [ ] **iPhone:** Run manual macOS simulator workflow and verify all Keychain sources link; fix any actual Xcode errors
- [ ] **iPhone:** Obtain required signing/Apple Developer access, configure dedicated staging bundle ID and TestFlight distribution
- [ ] **Both:** Test secure token save/load/delete, key invalidation, migration of existing logins, logout, interrupted writes and restaurant switching
- [ ] **Both:** Add version-pinned native push dependency, permission UI, tenant-authorized enrollment endpoint and provider delivery
- [ ] **Both:** Verify app background/foreground, GPS, checkout, order acceptance, order status, offline recovery, tenant isolation, privacy and accessibility
- [ ] Owner approval for any staging deployment, signed distribution, new DB migration or promotion

**Data protection:** do not alter the existing restaurant's live Turso rows, current staging deployment, POS pricing, cashier shifts, receipt printing, or order workflows during native development. All new tests must use disposable fixtures. Never run unreviewed destructive schema operations.
