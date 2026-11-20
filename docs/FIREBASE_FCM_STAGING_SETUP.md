# GastroFlow Firebase Cloud Messaging — staging setup and safe acceptance

**State:** implementation scaffolding only. Never treat these instructions as approval to deploy or send. Use the existing `restaurant-pos` repository, `codex/production-readiness` branch, and a separately verified staging Turso database. Do not change production customer or sales data.

## 1. Firebase project and application identity (manual external setup)
1. Open https://console.firebase.google.com/ and create a **separate staging project**. Keep production Firebase separate. Choose its project ID in the console rather than assuming any sample ID in tests exists.
2. Register an Android app using the actual `applicationId` from the native generated Android project (not the JavaScript app name). Record the value in a secure deployment runbook. Download Android `google-services.json` into the native app module using the documented Capacitor/Firebase setup.
3. Register the iOS app using the actual Xcode bundle identifier. Download `GoogleService-Info.plist` and add it to the native iOS app target; match the project's actual signing team, bundle ID and environment.
4. Enable the FCM HTTP v1 API. Use the least-privileged dedicated service identity on the server. **Do not commit** service-account JSON, private keys or APNs credentials, and never inject them into browser Vite variables.
5. In Apple Developer, create an APNs authentication key for the appropriate team and upload it in Firebase Console -> Project settings -> Cloud Messaging. Configure Xcode Push Notifications and Background Modes/Remote Notifications. APNs keys and Apple signing cannot be generated through a backend GitHub commit.

### Existing app identifiers inspected on `codex/production-readiness`
- Customer food app `apps/customer-web/capacitor.config.json`: `com.rstechnologies.gastrofood`. The checked-in Android Gradle file uses `applicationId "com.rstechnologies.gastrofood"` but its **staging** build type adds `applicationIdSuffix '.staging'`. Therefore, before registering the Android Firebase app, choose the **actual build variant and final application ID** (for that staging variant: `com.rstechnologies.gastrofood.staging`). A Firebase Android configuration for the base ID alone will not match the suffixed staging binary.
- Driver native shell `apps/driver-native/capacitor.config.json`: `com.rstechnologies.gastrodriver`. Its final Android application ID and iOS bundle ID must be confirmed from the generated/signed native project before Firebase registration.
- Root Capacitor shell `capacitor.config.json`: `com.gastroflow.app`. This is not interchangeable with the customer or driver application ID.
- The Platform Owner Communication Center is **not** automatically installed in either the customer or driver mobile shell. Their FCM tokens must not be registered as restaurant-owner tokens without a separately designed authenticated owner mobile shell.
- Never register the customer or rider application under the wrong tenant/owner token endpoint. Plan separate customer/rider token schemas and permissions for their own notification use cases.

## 2. Capacitor native client
- Confirm which existing Capacitor app shell will carry restaurant-owner notifications. The current owner Communication Center runs in the POS UI; customer and GastroDriver shells are distinct apps and must **not** reuse an owner token binding.
- For each intended mobile shell, install a matching-version `@capacitor/push-notifications` package, add permissions, sync Android/iOS, and register after the user signs in and explicitly opts into notifications.
- Android: check `POST_NOTIFICATIONS` on Android 13+; configure Firebase Android app files in the native app and test foreground, background and terminated states.
- iOS: verify push entitlements/APNs, request explicit notification permission, associate Firebase with APNs, test on a physical signed device; the native iOS simulator is not an acceptable replacement for this sign-off.
- On app start and token refresh, retrieve the **actual FCM token**. In Capacitor, the basic PushNotifications registration event may yield an APNs token on iOS; use a supported FCM plugin or native bridge to obtain the FCM registration token before calling GastroFlow's FCM token endpoint.
- Preserve an installation UUID v4 per app installation. After sign-in and consent, enroll the installation with `POST /api/owner/communications/devices` using `{installationId,platform}`, then register the FCM token with `POST /api/owner/communications/fcm-token` using `{installationId,token}`. Both require the authenticated owner and matching tenant. Never take `tenantId` or `userId` from client payloads.
- On logout, account switch, token rotation, consent withdrawal or application reset, call the appropriate revoke endpoint and/or clear the prior token binding. Test that switching restaurants cannot inherit another tenant's notifications.

## 3. Server-side switches and data protection
- Firebase adapter `lib/communications/platform-fcm-sandbox.js`, encrypted token registry `platform-fcm-token-registry.js` and exact-recipient dispatcher `platform-owner-fcm-dispatch.js` are **not mounted to a sender or scheduler**.
- Never set `PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED=true` until Render's staging database URL is independently confirmed to point at a separate staging Turso database.
- Keep `PLATFORM_COMMUNICATIONS_FCM_STOP` set to `true` or unset by default. Real sends require further separately approved staging configuration and explicit `PLATFORM_COMMUNICATIONS_FCM_DISPATCH_ENABLED=true`. These flags are **not** automatically set by any code commit.
- Generate a separate 32-byte base64 `PLATFORM_COMMUNICATIONS_FCM_TOKEN_AES_KEY` for encrypted tokens and a separate strong `PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY`. Store both in secret manager/Render environment, never GitHub. Plan key rotation so existing ciphertext remains decryptable until migration/re-enrollment.
- The dispatched notification contains only the short announcement ID and minimal title/body. The app must fetch full detail through the authenticated tenant-scoped inbox; do not place sensitive billing, OTP or customer data in the notification payload.
- Provider HTTP acceptance is **not proof of handset display or human acknowledgment**. Maintain durable claim/manual-review semantics; never automatically resend ambiguous outcomes.

## 3a. Native POS staging enrollment flow (now coded; remains inactive)
- The existing Codex staging wrapper at `mobile-staging/` is registered as `com.gastroflow.app.staging`. The POS `StagingPushSetup` UI is now restricted to **native Android/iOS and signed-in restaurant owners** at the exact staging HTTPS origin. Cashiers, managers, platform administrators, non-native browsers, and other origins never see the control.
- `src/utils/staging-fcm-enrollment.js` sends an authenticated, **read-only** `GET /api/owner/communications/push-enrollment-readiness` before any consent or device write. The server requires active tenant, the authenticated owner role, verified-by-operator database isolation attestation, enabled installation enrollment, and enabled encrypted FCM token storage.
- A single **user-initiated** opt-in saves owner push preference, registers a UUID v4 installation (localStorage scoped to the tenant and owner), requests native permissions, gets the FCM token, and sends it once over same-origin HTTPS to the authenticated `/fcm-token` endpoint. The screen displays only a success/denied/error message, **never the token**.
- The Disable Notifications control withdraws server-side consent and revokes all previously recorded installations and FCM tokens for that owner. Registration only verifies token storage; it does not send a notification or claim delivery.
- Signing out in the staging native POS now initiates a **best-effort revocation of only that device's installation**, using the previously authenticated session before local logout. Network failure never blocks local sign-out. The registration panel also remounts when the signed-in owner or tenant changes so stale success state cannot be shown for another account.
- Logout revocation is not guaranteed when offline, forcibly terminated, or after an expired JWT. Server-side authenticated owner/tenant ownership and revocation remain enforced; verify server records and correct any stale registrations during real-device testing.
- The screen intentionally provides no automatic background token refresh yet. Until a signed native Android/iOS test verifies Firebase token refresh and logout/account-switch revocation on real hardware, this stage is a **manual staging test control only**.
- Before enabling staging, confirm that `PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED=true` reflects an actually **separate Turso staging database**; a configuration value alone is not proof.
- No Render deployment is authorized or performed as part of these changes.

## 4. Test matrix and release gates
- Automated mocked transport: OAuth assertion signature, one-token targeting, no topics, rejected disabled or invalid parameters, provider errors.
- Database tests: owner A/restaurant A cannot enroll owner B's token; inactive/suspended or non-owner accounts cannot register; device and token revocation blocks dispatch; stale or duplicate claim cannot send twice; suppressed or opted-out devices never send.
- Staging proof: verify **separate Turso DB**, separate Firebase staging project, credentials and APNs configuration, one approved test owner, and one approved test device per OS. Inspect server logs without emitting tokens or keys.
- Physical Android/iPhone: sign in, opt in, receive visible push, open the correct restaurant notice, background/terminated behavior, token refresh, logout, account/tenant switch, and revocation. Verify denied permission remains usable without notification.
- Move toward production only after explicit authorization, successful controlled provider responses, negative tenant-isolation tests, operational alerts and tested rollback. No staging or production deployment has been performed by this documentation.

Sources: https://firebase.google.com/docs/cloud-messaging/send/v1-api ; https://capacitorjs.com/docs/guides/push-notifications-firebase
