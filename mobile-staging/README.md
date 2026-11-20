# GastroFlow mobile staging

Firebase project `gastroflow-staging` (project number `395753908391`) contains both staging app registrations. The Android application ID and iOS bundle ID are `com.gastroflow.app.staging`. This wrapper uses the existing staging POS origin at `https://gastroflow-staging.onrender.com` so its same-origin API and event stream use the staging backend. The root Capacitor configuration remains the entry point for `com.gastroflow.app`.

From the repository root, build the POS assets and install the wrapper dependencies:

```sh
npm run build
npm --prefix mobile-staging ci
```

## Android

With the Capacitor 8 Android toolchain installed, generate the native project once and sync the staging SDK configuration:

```sh
npm --prefix mobile-staging run setup:android
npm --prefix mobile-staging run sync -- android
```

Open `mobile-staging/android` in Android Studio and run a debug build on a device with Google Play services. Run the sync command again after changing web assets or native plugins.

## iOS

On macOS with Xcode, generate the native project once and sync the staging configuration:

```sh
npm --prefix mobile-staging run setup:ios
npm --prefix mobile-staging run sync -- ios
```

In Xcode, ensure `GoogleService-Info.plist` is included in the App target’s Copy Bundle Resources. Select the Apple Developer team, provision `com.gastroflow.app.staging`, enable the Push Notifications capability and add the [Capacitor Firebase Messaging AppDelegate callbacks](https://capawesome.io/docs/sdks/capacitor/firebase/cloud-messaging/#setup). Upload an authorized staging APNs credential in the [staging Cloud Messaging settings](https://console.firebase.google.com/project/gastroflow-staging/settings/cloudmessaging). Keep the APNs private key out of the repository.

## Device verification

After an explicitly approved staging deployment **and verification that staging has a separate Turso database**, sign in as a restaurant owner from the native wrapper. Open **Staging notifications** and select **Enable staging push**. The client first checks server-side isolation and readiness, records explicit consent, enrolls the owner installation, and registers its encrypted Firebase token. **No raw token is displayed.** Registration alone never sends a notification.

The **Disable notifications** control revokes the owner's server-side registrations. Native logout attempts device-specific revocation, but if offline the account-binding safeguard blocks subsequent owners on that phone until server revocation is confirmed. Any delivery test requires separate approval and should target one staging owner device.

## Windows PC + normal Apple ID: iPhone testing options

- **Now, without a Mac or paid membership:** open `https://gastroflow-staging.onrender.com` on the iPhone in Safari and exercise the **currently deployed** POS UI with a safe staging account. For easier launch, use Safari's **Share → Add to Home Screen**. This is web-app testing, **not** testing the native Capacitor/Firebase wrapper. Current staging code may lag behind the development branch because automatic Render deployment is disabled.
- **Automated iOS compilation from Windows:** the GitHub Actions job `gastroflow-staging-ios-simulator` runs on a hosted Mac when a development-branch commit contains `[verify-staging-ios]` (or on a matching PR). It generates and compiles the separate `mobile-staging` iOS Capacitor shell, checks `com.gastroflow.app.staging` and its embedded Firebase project ID, then uploads a **simulator-only ZIP**. It does not sign, install, deploy, contact APNs, or prove push delivery. This ZIP **cannot run on a physical iPhone**.
- **Actual iPhone installation with a free Apple account:** Apple allows free personal device development via **Xcode on a Mac signed into the Apple ID (Personal Team)**, subject to free provisioning restrictions. A hosted CI simulator build alone cannot be installed onto the phone or signed using a normal Apple ID from Windows.
- **TestFlight and production-standard iOS push testing:** require Apple Developer Program membership and appropriately provisioned bundle identifier, push entitlement, and APNs authentication credential in Firebase. No APNs credential or signing identity should ever be committed to GitHub. Standard Firebase push reception cannot be marked verified without a signed device build and real-device test.

Do not approve a deployment or activate any notification gates until staging/production Turso isolation is independently verified. Do not share access tokens, Firebase service account JSON, APNs keys, or database URLs in chat.
