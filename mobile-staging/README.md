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

After the branch is approved for staging deployment, sign in to the POS from the native wrapper. Open **Staging notifications** and choose **Register this device** to request permission and view the device's FCM registration token. Registration alone sends no push message. Keep the token private. Any delivery test requires approval and should target that specific staging device.
