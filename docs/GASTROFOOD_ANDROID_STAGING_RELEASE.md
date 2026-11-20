# GastroFlow Food Android: permanent staging installation and safe updates

Scope: **only** the existing repository branch `codex/production-readiness` and `apps/customer-web`. No database migration, POS deployment, or production release.

## Architecture decision

- Existing installed `com.rstechnologies.gastrofood` debug APK remains untouched. Its original debug signing key is not present in GitHub artifacts, so another key cannot update it in place.
- New staging application ID: `com.rstechnologies.gastrofood.staging`. This installs **alongside** the old app.
- Launch name: **GastroFlow Food Staging**.
- Staging bundle is built with Capacitor 8 and talks only to `https://gastroflow-staging.onrender.com`.
- Every signed staging build uses **the same keystore**, injected through protected GitHub Actions secrets and never committed to Git.
- Staging versionCode is `10000 + GitHub workflow run_number` (strictly increasing for new runs). Retrying an earlier run does not advance that number; initiate a **new** workflow run to update an already installed version.

## 2026-11-18: Native release-boundary checks

The signing workflow now refuses to build outside `codex/production-readiness`, records and verifies the original POS root lockfile checksum, and executes `node scripts/check-food-native-release-boundary.mjs` before packaging. This read-only guard checks: distinct Android staging package identity, persistent signing requirements, exact staging HTTPS origin, manual branch-restricted Android and iOS workflows, unsigned-only iOS simulator identity, foreground Android location declarations and isolated customer Capacitor identity. A regression suite in `tests/customer-native-release-boundary.test.js` makes these checks enforceable in normal CI.

**Important:** This does NOT produce a new signed APK or iPhone IPA. The Android signed workflow requires repository secrets and a manual run; the iOS simulator workflow requires a manual macOS run. Real iPhone installation requires a separately implemented signing/TestFlight workflow and Apple Developer Program access. Generated native build assets in `apps/customer-web/android/app/src/main/assets/public/` remain tracked; clean them only as a separately reviewed reproducibility migration to avoid breaking existing builds.

Do not run the Android signed APK workflow until the private signing key is securely provisioned. Do not upload signing keys or password material to the repository, issues or chat. The POS and deployed Turso data are not affected by these source checks.

## One-time signing key creation (on a trusted Windows computer)

1. Install a trusted Java 21 JDK (which includes `keytool`).
2. Open PowerShell on your own computer. Create a private directory with secure permissions and back it up safely, **outside the repository**.
3. Run:

   ```powershell
   keytool -genkeypair -v -keystore "$env:USERPROFILE\gastrofood-staging.jks" -storetype PKCS12 -alias gastrofood-staging -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=RS Nextward GastroFlow Food Staging, O=RS Nextward, C=LK"
   ```

   Enter a long unique keystore password in the prompt. For PKCS12, use the **same** password for keystore and key when prompted.

4. Convert the binary keystore into Base64 **locally**, without uploading it to any chat:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\gastrofood-staging.jks")) | Set-Clipboard
   ```

5. In GitHub, open repository **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `FOOD_STAGING_KEYSTORE_BASE64`: paste the Base64 value from the clipboard
   - `FOOD_STAGING_STORE_PASSWORD`: the password you entered
   - `FOOD_STAGING_KEY_ALIAS`: `gastrofood-staging`
   - `FOOD_STAGING_KEY_PASSWORD`: same password (for PKCS12)

   Clear your clipboard after entering the secret. Do not store keystores, passwords, or Base64 copies in Git, issues, chat, CI artifacts, or documentation.
6. Retain **two secure backups** of the keystore and credentials. Losing the private signing key means future staging updates cannot replace the installed app without data-loss migration.

## Issue a signed staging APK

1. Go to **Actions → GastroFlow Food Android signed staging APK → Run workflow**.
2. Select `codex/production-readiness` and run once. Builds require explicit action; code commits alone do not distribute an APK.
3. Confirm **success**, **app ID**, **signature**, and artifact `GastroFlow-Food-Staging-Signed-<run-number>`.
4. Download ZIP, extract `app-staging.apk`, install **once** on the Android phone. The old `GastroFlow Food` app remains installed.
5. For a newer build, run this same workflow again using the **same secrets**, download the new APK, and tap **Update**. User data inside the **staging app** is preserved by compatible in-place Android updates.

## What is automatic and what is not

- The workflow provides **stable signing and increasing version codes**, which are prerequisites for in-place Android upgrades.
- This workflow **does not yet deliver background/automatic updates to phones**. GitHub Actions artifact download requires access and Android package installation ordinarily requires user confirmation.
- Production customer distribution should use Google Play internal testing/closed testing and then Play-managed updates; or use a separately designed secure staging update-checking service with authenticated, hash-verified APK distribution and Android install confirmation.
- A Capacitor web-asset live update channel is possible but requires its own signed release manifest, integrity checks, rollback policy, app-store compliance review and device testing. Do **not** ship arbitrary remote JavaScript updates from GitHub artifacts.
- No UI or APK update should ever switch a staging installation to a production backend.

## Device acceptance checklist

- Verify both old and new app icons coexist.
- Staging app opens independently, uses correct brand and staging API, loads restaurants, displays nonoverlapping cuisine icons, and requests location only when appropriate.
- Place only controlled test orders in staging. Verify multi-tenant mapping, cart, GPS and GastroMate.
- Install a second signed staging build with a higher versionCode **without uninstalling** and confirm the staging session and local data persist.
- Test automatic update mechanism separately before calling it implemented.

## Failure handling

- `Missing KEYSTORE_B64` or other missing-secret error: configure repository Actions secrets.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: the APK's signing key differs; do not uninstall the app. Restore the **original staging keystore**.
- `INSTALL_FAILED_VERSION_DOWNGRADE`: generate a new workflow run rather than rerunning an old build.
- Keep release signing keys separate from staging keys, and never publish the signed staging APK as the public production app.
