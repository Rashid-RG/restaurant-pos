# GastroFlow Food — isolated native Android/iOS bootstrap

**Branch:** `codex/production-readiness` only. **No deployment or signing authorized.**
These commands create **GastroFlow Food** app projects, not the root POS project. This is an engineering setup guide; actual package installation, APK/IPA generation, and device validation are still pending.

## Confirmed requirements
- Capacitor **8.6.2** (exactly pinned in `apps/customer-web/package.json`).
- Node.js 22+, project currently targets Node.js 24.
- Android: current Android Studio and SDK; iOS: a Mac with Xcode 26+.
- Staging API for testing: `https://gastroflow-staging.onrender.com` only. Do not use production or live customer credentials.
- Customer package ID `com.rstechnologies.gastrofood` is provisional until RS Technologies confirms ownership.

## 1. Safely generate customer-only lockfile
From the existing repository, **do not use the root `cap:android` or `cap:ios` scripts**: those target the shared POS Capacitor config.

```sh
git checkout codex/production-readiness
cd apps/customer-web
npm install --package-lock-only --ignore-scripts
npm ci --include=dev
```

**Known blocker:** A customer-specific `package-lock.json` already exists, but it predates the native package additions and is missing the four Capacitor packages. Do not run `npm ci` against that stale lockfile or declare native readiness.

**GitHub-runner option:** Open **Actions → GastroFlow Food native dependency lock bootstrap → Run workflow** on `codex/production-readiness`. This also runs on relevant branch changes. The workflow resolves dependencies **only inside `apps/customer-web`**, verifies the pinned packages, ensures the root POS `package-lock.json` checksum is unchanged, and uploads `gastrofood-customer-package-lock-candidate` as an artifact. It neither commits nor deploys. Download the generated `package-lock.json`, review it, replace **only** `apps/customer-web/package-lock.json`, and commit it to the same branch.

To validate after obtaining the lock:

```sh
node scripts/verify-food-native-lock.mjs apps/customer-web/package.json apps/customer-web/package-lock.json
```

Review and commit `apps/customer-web/package-lock.json` on this branch after ensuring the four Capacitor packages resolve to 8.6.2. The root lockfile and root POS config must not change.

## 2. Build packaged web content

**From `apps/customer-web`:**

```sh
# In PowerShell:
$env:VITE_NATIVE_API_ORIGIN="https://gastroflow-staging.onrender.com"
npm run native:build:web

# On macOS/Linux:
# VITE_NATIVE_API_ORIGIN=https://gastroflow-staging.onrender.com npm run native:build:web
```

The native-mode Vite build intentionally fails if the HTTPS API origin is absent/invalid. Packaged assets use relative URLs; the regular web app retains `/customer/`.

## 3. Generate only the customer native project

**From `apps/customer-web` (NEVER the repository root):**

```sh
npm run native:add:android
npm run native:sync:android
```

On macOS with Xcode 26+ you can also run:

```sh
npm run native:add:ios
npm run native:sync:ios
```

The guard checks current directory, exact Capacitor dependency versions, customer lockfile, app identity and `dist/index.html`. It aborts if any are missing. Generated Android and iOS folders must be reviewed carefully for package ID, release permissions, Google/Firebase setup, splash/icon assets, App Transport Security and signing before any release. Do not commit signing keys, provisioning profiles, tokens or `.env` files.

## 3a. Apply foreground GPS permissions to the generated customer projects

**Only after** the corresponding customer-only `native:add` command has generated its native folder, run from `apps/customer-web`:

```sh
npm run native:permissions:android
# On the macOS/iOS machine after generating ios/
npm run native:permissions:ios
```

The idempotent script modifies only `apps/customer-web/android/app/src/main/AndroidManifest.xml` and `apps/customer-web/ios/App/App/Info.plist`; it refuses to run from the repository root and fails if the selected native project does not yet exist.

Android requests `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` and declares GPS **optional** to support manual pins/approximate locations. iOS receives `NSLocationWhenInUseUsageDescription` explaining the permission in plain language. No background location permission or tracking service is added. Customer geolocation requires foreground consent, and a customer must be able to search or select a map pin instead.

**Device acceptance remains essential:** Check that the OS permission prompts appear when requested, accuracy is shown rather than guaranteed, permission-denied/revoked users can still select a map pin, and a delayed geocoder does not overwrite the selected coordinates. This setup is not equivalent to installing or testing `@capacitor/geolocation`, which would require a separately pinned dependency, lockfile refresh, runtime integration and native-sync acceptance.

## 4. Staging API and native security gate
Production-mode CORS currently does **not** grant native origins automatically. When real devices are ready for testing, set the staging service's `CUSTOMER_NATIVE_ORIGINS` explicitly to the origins actually used (`https://localhost` for Android, `capacitor://localhost` for iOS), after authorization. The backend's allowed native origins are exact matches and do not replace tenant authentication. **Do not change Render environment or deploy without explicit approval.**

Native order tracking currently uses authorized snapshot polling; hosted SSE and browser push are intentionally disabled inside native mode pending authenticated native transport and mobile push implementation. Real-device background behavior, notification registration, location permission strings, order links and checkout behavior are not yet verified.

## 5. Required acceptance checks
1. Run `npm run food:native:preflight` from repository root; resolve reported blockers.
2. Run isolated customer CI and native-mode customer web build; require passing results.
3. Verify Android/iOS packages do not share root POS app IDs or logos; ensure home-screen icon and splash are correct.
4. Test customer signup/OTP, restaurant selection, location permission (grant/deny/revoke), weak GPS, map pin, cross-tenant isolation, order checkout, reconnect tracking, rider assignment and background/foreground recovery.
5. Only after explicit approval: stage non-customer test orders; validate no POS/sales changes; prepare release signing and store distribution.

**No APK/IPA, native project folders, installed packages or lockfile are claimed as produced by this guide.**
