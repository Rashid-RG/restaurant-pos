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
