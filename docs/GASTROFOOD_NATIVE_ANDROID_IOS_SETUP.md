# GastroFlow Food — isolated native Android/iOS bootstrap

**Branch:** `codex/production-readiness` only. **No deployment or signing authorized.**
These commands create **GastroFlow Food** app projects, not the root POS project. The Android debug APK and Android emulator startup were built and verified in GitHub Actions. The iOS simulator project/build, physical phone testing, and mobile API acceptance remain pending.

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

**Resolved:** The customer-only `package-lock.json` is now committed with all four Capacitor dependencies pinned and resolved at 8.6.2. Keep the root POS lockfile unchanged.

**GitHub-runner option:** Open **Actions → GastroFlow Food native dependency lock bootstrap → Run workflow** on `codex/production-readiness`. This also runs on relevant branch changes. The workflow resolves dependencies **only inside `apps/customer-web`**, verifies the pinned packages, ensures the root POS `package-lock.json` checksum is unchanged, and uploads `gastrofood-customer-package-lock-candidate` as an artifact. A dependent job then attempts a customer-only Android source project with foreground location permissions and uploads `gastrofood-android-source-candidate` for review. It does **not** sign an APK, publish an app, commit files, change Turso, or deploy. Download the generated `package-lock.json`, review it, replace **only** `apps/customer-web/package-lock.json`, and commit it to the same branch.

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

## 2026-11-18: Native foreground customer session recovery

Packaged GastroFlow Food now revalidates the existing restaurant-scoped customer session after a prolonged foreground/background or connectivity transition. It listens for `visibilitychange`, `focus`, `pageshow` and `online` only in `MODE=native`, checks no more than once per minute, and skips checks while hidden or offline. Server-confirmed invalid/revoked authentication clears that matching session; transient network failures do not sign the customer out. Late responses cannot overwrite a newer login or another restaurant's state. The hosted web session lifecycle is unchanged.

The helper `apps/customer-web/src/utils/native-session-revalidation.js` and test `tests/customer-native-session-revalidation.test.js` cover throttling, tenant/account switches and event cleanup. These checks use the existing HTTPS customer profile endpoint; they do not add a native token storage plugin or alter backend authentication.

**Not yet delivered:** Keychain/Android Keystore-backed storage, signed iPhone distribution, mobile push, Android/iPhone device acceptance, background notifications and certificate rotation. The existing customer token is still stored using the prior WebView/localStorage approach, so do not advertise hardware-backed secure storage.

## 2026-11-18: Isolated customer session storage boundary

The Food app now reads, writes and revokes tenant-scoped customer session tokens through `apps/customer-web/src/utils/customer-session-store.js`. This preserves the previously installed app's `gastroflow_customer_token:<encoded tenant>` key format and keeps existing users signed in. Both `CustomerAuthContext.jsx` and `api.js` use the shared API; stale auth errors use compare-and-remove rather than deleting a newer or different restaurant session. Disposable storage tests verify migration-free compatibility and isolation.

**Storage security status:** the adapter still uses existing WebView `localStorage`, not Android Keystore or iOS Keychain. Hardware-backed credential storage requires a vetted native plugin/bridge, separate package-lock and native project updates, safe migration of previously stored tokens, and physical-device verification. Do not promise secure hardware storage or submit a signed mobile release based on this refactor alone.

## 2026-11-18: Safe future Keychain/Keystore token migration

Added `apps/customer-web/src/utils/native-session-migration.js` as a **dormant**, dependency-free migration contract; ordinary customer authentication still uses the existing tenant-scoped WebView storage. Before any native bridge is enabled, its `get`, `set`, and `remove` operations must be backed by a reviewed Android Keystore/iOS Keychain implementation and verified on actual devices. The migration module copies the exact existing tenant key, reads the stored value back for verification, and removes the legacy value only if the legacy token has not changed. A native write/read error preserves the original customer login; an existing different secure token is never overwritten. Concurrent migrations for the same tenant are rejected.

Test coverage: `tests/customer-native-session-migration.test.js` verifies per-restaurant isolation, unavailability, failed writes, verification failure, newer logins, and concurrent migration attempts. **This is preparation, not completed hardware-backed storage or an app release.** No migration runs against existing customers. A later phase must: select and pin an audited native bridge, set up Android/iOS platform projects, integrate asynchronous token retrieval into the customer API, handle conflicting tokens and interrupted migrations, verify auth on both physical devices, and only then authorize opt-in migration. Never install an unreviewed secure-storage plugin or delete legacy credentials on build.

## 2026-11-18: Android Keystore bridge (code integration, not yet active)

The isolated `apps/customer-web/android/` project now contains `FoodSecureSessionPlugin.java`, registered in its `MainActivity.java`. The local Capacitor plugin `GastroFoodSecureSession` uses Android Keystore to retain a non-exportable AES-256 key, AES-GCM (fresh 12-byte nonce), per-session-key additional authenticated data, and app-private encrypted SharedPreferences ciphertext. It exposes `get`, `set` and `remove` only for tenant-scoped `gastroflow_customer_token:` names and never logs plaintext tokens. A gated adapter and tests are in `apps/customer-web/src/utils/native-secure-session-android.js` and `tests/customer-native-android-secure-session.test.js`.

**Not yet activated:** Existing customer authentication still uses the legacy tenant-scoped WebView storage. The native bridge is not called on login, logout, or API requests until a controlled migration is audited. The Android SDK 36 CI workflow compiles the Java plugin and runs tests, but compilation alone does not prove runtime encryption, authentication, installation, device lock behavior or migration safety. The iPhone Keychain bridge is **not** implemented. Android API-level compatibility, physical-phone read/write/restart verification, key invalidation recovery, migration rollback and logout cleanup must pass before enabling this backend. Never switch authenticated users to the native store without signed-device tests.

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

## CI-generated native source artifacts (review before use)
The workflow `.github/workflows/food-native-lock-bootstrap.yml` creates two candidates if jobs succeed: the customer-only `package-lock.json` and a generated `apps/customer-web/android/` source project. Their presence must be confirmed in GitHub Actions; writing the workflow does **not** prove they exist. Download the artifacts, verify Gradle settings, application ID, icon/splash placeholders and AndroidManifest permissions, then introduce reviewed source files on the existing branch. No signing, publishing, staging deployment or device installation is performed by this workflow. iOS still requires a macOS/Xcode project-generation and build gate.

## Verified Android build artifact and branding review (17 November 2026)

GitHub Actions run [43932069024](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43932069024) successfully produced a customer-only lockfile candidate (artifact `14259006527`) and Android **source** candidate (artifact `14258956648`). Both jobs passed. Source inspection confirmed `com.rstechnologies.gastrofood` and foreground GPS permissions. **No signed or unsigned APK was produced by that workflow.**

The earlier source candidate still contained default Capacitor app launcher/splash resources. The updated workflow adds `scripts/generate-food-android-branding.py`, which reads the existing approved `apps/customer-web/public/food-logo.png`, generates adaptive and legacy launcher PNGs, and replaces generated splash PNG assets in the isolated customer Android project. Image processing requires Pillow on the CI runner. Verify the **new** Android source artifact before considering branding complete; the old artifact remains unbranded.

The standalone customer quality job previously failed after 61 tests passed because its native audit detected the stale customer lockfile. The updated quality workflow regenerates the customer-only lock in its runner before native preflight, but an actual passing run must still be checked.

**Review before release:** Android adaptive icon cropping (circular/squircle), status-bar splash rendering, light/dark contrast, permission prompts, tenant-safe HTTPS/CORS requests, deep-link/order routing, and Gradle debug build. The iOS icon/launch-screen resources require a distinct Xcode acceptance stage.

## 5. iPhone simulator candidate (manual GitHub Actions only)

Use **GitHub Actions → GastroFlow Food iOS simulator candidate → Run workflow** with `codex/production-readiness`. The workflow is **manual-only** because GitHub-hosted macOS minutes may incur charges, depending on repository visibility and plan. It runs on `macos-26` with Xcode 26 or newer, then:

1. Installs the existing root Vite build tools and the **isolated** `apps/customer-web` Capacitor dependencies without editing the POS lockfile.
2. Builds packaged customer web assets against the staging HTTPS API only.
3. Creates the isolated `apps/customer-web/ios/` project if it does not exist, syncs assets, and adds **foreground-only** iOS location permission text.
   It also runs `scripts/generate-food-ios-branding.py` against the already approved `public/food-logo.png`, replacing only generated Xcode catalog icon/splash PNGs. The 1024×1024 app icon is opaque; original `Contents.json` structures remain unchanged.
4. Compiles an iOS **Simulator Debug** `.app` with `CODE_SIGNING_ALLOWED=NO` and checks the bundle ID `com.rstechnologies.gastrofood` and packaged app files.
5. Uploads `gastrofood-ios-simulator-candidate` (a zipped simulator `.app`) and `gastrofood-ios-source-candidate` for manual inspection. No iOS source files are automatically committed.

**Important:** A simulator `.app` is **not** an iPhone-installable IPA and not an App Store release. This first pipeline has been added but has **not been executed or validated**. Before any device distribution, review iOS icon/splash resources, permissions, ATS rules, dependency lock, app identity, native network CORS and signing. Real iPhone installation requires Apple provisioning and an approved release workflow.

Capacitor 8 requires Xcode 26 or newer. Its recommended iOS package manager is Swift Package Manager; do not invent CocoaPods setup unless a plugin explicitly needs it.

### iOS branding generator verification

A separate inexpensive Ubuntu GitHub workflow, `GastroFlow Food iOS branding generator quality`, tests the asset conversion with disposable fixture catalogs; it does not require macOS, generate an IPA, publish an app, or change customer/production data. The first verified run [44054527118](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44054527118) passed, including opaque 1024×1024 output, splash dimensions, original Xcode catalog preservation, and refusal of unsafe paths. **The actual iOS simulator Xcode workflow remains unexecuted** and its generated icon must be visually reviewed before release.

## Native staging CORS — investigated and release-gated (2026-11-17)

**What is confirmed:** The live Render staging deploy is `4e2393d61a0099093e0d4920d6cef714e2c797ab` (from November 16), not the newer `codex/production-readiness` commits. A non-authenticated request with either mobile WebView `Origin` returns HTTP 200 for `GET /api/public/restaurants` but **does not include** a matching `Access-Control-Allow-Origin`. A native-style OPTIONS preflight returns HTTP 401. This means the browser/WebView rejects the request even though the API would serve a simple GET; it does **not** demonstrate a broken restaurant route, bad GPS, or incorrect OTP credentials.

**Backend source of the failure:** `server.js` uses explicit production CORS allowlisting. `CUSTOMER_NATIVE_ORIGINS` is opt-in; adding the origin to a mobile build or removing unnecessary discovery headers does not grant server access. Only exact `https://localhost` (Android) and `capacitor://localhost` (iOS) are supported by `lib/customer-native-origins.js`. Do not use `*`, `null`, `http://localhost`, arbitrary hostnames or any wildcard suffix.

**Prepared and verified code:** `lib/customer-cors-policy.js` makes the current strict middleware selection independently testable, while `tests/customer-native-cors-express.test.js` sends real Express GET and OPTIONS requests under both approved origins. The test checks credentialed preflight, exact origin reflection, rejection of origin lookalikes, preservation of the existing hosted origin, and that permitted CORS does **not** make a private API response authenticated. The server's policy is intentionally unchanged until explicit staging approval.

### Staging-only rollout procedure — do not execute without explicit approval

1. Confirm the target is Render **`gastroflow-staging`**, service `srv-dblpvdt9el5s73eebt0g`, branch **`codex/production-readiness`**, and automatic deployment remains disabled. Record the current live deployment ID `dep-dbtmaohsrm7s73eti4h0` and commit `4e2393d` for rollback. Confirm the target deployment commit has passed the customer and order-lifecycle CI gates.
2. Obtain explicit permission for **both** the staging config change **and** staging deployment/restart. Safely *merge* (do not replace) the existing Render environment variable `CUSTOMER_NATIVE_ORIGINS=https://localhost,capacitor://localhost`; preserve `CORS_ORIGIN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, secrets, other env variables, existing customers and sales. Do not set it on production.
3. **First use the narrowest authorized operation:** the currently deployed staging server at commit `4e2393d` already contains support for `CUSTOMER_NATIVE_ORIGINS`, so a full development-branch deployment is **not required solely for native-origin CORS**. After approval, merge only the staging variable and carry out the staging restart/redeploy needed to activate that configuration, preferably outside merchant checkout/printing. Keep the larger `codex/production-readiness` branch deployment as a **separate review and approval decision**. Never run a destructive migration or reset the database.
4. After the service is healthy, use `node scripts/probe-food-native-cors.mjs --require-allowed` to verify **both** native origins and **both** anonymous GET and private-style OPTIONS preflight. Demand an exact matching `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`, allowed headers and methods. Test existing browser POS and shop login/receipt paths separately.
5. Test with isolated accounts only: restaurant discovery (with and without GPS params), selected-tenant menu, OTP login and session restore, private order tracking, checkout idempotency and tenant-isolation denial. Do not send live customer emails, create orders for actual merchants or enable PayHere.
6. If the smoke gate fails, restore the previous staging deployment and native origin configuration **without resetting Turso**. Record the original settings before any edit; do not replace the whole environment variable set.
7. iPhone Xcode simulator compilation and real-device end-to-end testing remain separate acceptance gates.

**Current status (2026-11-17):** Code/tests prepared; **live native-origin CORS remains unverified and blocked in prior read-only probes**. The current deployed server already handles the exact native origins when explicitly configured, but the contents of the staging environment variable have **not been read or established**. An approved merge-only staging configuration change and restart should precede a new read-only native probe; do not claim the issue resolved until that probe passes. Browser/POS safety is higher priority than bypassing CORS with a wildcard or weakening any authorization checks.
