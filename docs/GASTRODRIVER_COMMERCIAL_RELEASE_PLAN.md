# GastroDriver — commercial delivery-app completion and release gate

**Development branch:** `codex/production-readiness`  
**Deployment boundary:** `gastroflow-staging` only, upon explicit approval. Never change production or live Turso merchant data for testing.

## What exists in the repository
- Responsive rider web app/PWA: phone/password sign-in, self-application, manager review, dispatch polling, claiming, pickup/out-for-delivery/arrival/delivery stages, GPS quality gating, proof of delivery, COD handover summary.
- Backend tenant-scoped driver JWT and order assignment APIs.
- Restaurant POS rider approval and assignment views.
- Automated driver GPS/dispatch/proof tests and basic customer-to-POS lifecycle tests using ephemeral fixtures.

**These foundations do not constitute a release-ready native driver app.**

## Admission & identity — critical before opening signup
1. Bind applications to a *verified restaurant identity* derived from approved tenant invitation / store URL. Reject missing/ambiguous tenant selection (no implicit global default). Protect against registration into a different store.
2. Verify applicant email with one-time, expiring, rate-limited code before treating email as verified; validate phone ownership through a configured SMS provider or a documented supervised fallback. Never claim an address/number is verified without provider evidence. Ensure OTPs are one-use and tenant-scoped.
3. Keep state machine `draft -> contact_pending -> review_pending -> approved | rejected | suspended`. Registration must NEVER issue an operational driver token. Existing `pending_approval` compatibility needs a non-destructive migration.
4. Collect minimum eligibility evidence: full legal name, phone, optional email, vehicle and plate, licence expiry/required category, insurance/vehicle documentation *where applicable*. Use private object storage with access rules, encryption, retention and deletion policy. No IDs in public URLs, logs, analytics, or plaintext device storage.
5. Give each restaurant owner/manager an auditable approval decision, reason, date, operator and a review checklist; reject double approvals and prevent applicants approving themselves. Allow appeal/correction without duplicate accounts.
6. Add signup abuse defenses (IP + phone/email rates, duplicate handling, neutral error responses, retry backoff). Add login recovery, password reset, device/session revocation, and secure native token storage.
7. Implement privacy policy, driver consent, rights and safe retention process suitable for operating jurisdictions. Review local identity, labour and transport requirements with qualified professionals.

## Dispatch & trip operations
- Driver availability (offline / online / paused / busy), heartbeat and resilience after foreground/background/resume.
- Manager-only approval and assignment; use atomic tenant-scoped assignment to prevent double claims.
- Delivery stages: assigned, accepted, at restaurant, picked up, en route, arrived, delivered / failed / returned; enforce valid state transitions, cancellation/refund interactions and customer visibility.
- Fallback for GPS unavailable; no false real-time claims; detect stale/inaccurate device fixes.
- Customer-visible ETA and routing only when the routing engine is configured and measurement is reliable. OSRM server is not yet confirmed live.
- Live driver map, navigation handoff, contact actions, reassignment, multi-stop ordering, delivery exceptions, incident and support reporting.
- Per-restaurant timezone, currency, delivery zone, driver assignment rules, and access isolation.

## Finance & evidence
- Verify COD collection and manager cash handover; distinguish collected versus handed-over amounts, with reconciliation receipts and immutable audit history.
- Proof of delivery requires atomic order transition and evidence (signature/photo/OTP as configured); access restricted to assigned driver and authorized tenant staff, no logging of sensitive documents.
- Rider earnings/commission, tips, payout ledger, disputed/refunded deliveries, and store-specific settlement rules.
- Prevent delivery completion on incomplete payment; handle offline/retried requests idempotently.

## Android & iOS
- Separate driver native identity and app configurations (not the customer package).
- Android: secure Keystore-backed token storage; notification channels, permission UX, background location only if essential, runtime permission declaration, foreground service where compliant, notification/route recovery.
- iOS: Keychain-backed token storage, Apple Push Notification service, Core Location modes/consent, universal links, TestFlight signed distribution.
- Test background/locked screen delivery on physical phones. Browser geolocation on a PWA is not equivalent to native background location.
- Accessibility, small-phone safe areas, offline/error recovery, language/currency support, battery/data efficiency.
- Signing secrets stay in GitHub/CI or the app distribution provider — never in source.

## Non-negotiable verification before production
- Isolated **staging-only test restaurant**, never the existing restaurant's paid orders.
- Fresh signup -> verified contact -> manager identity review -> approved login -> available -> assigned order -> live routing -> pickup -> delivery proof -> payment -> reconciliation -> notification.
- Negative tests: duplicate phone, cross-tenant invitation, unverified account, brute-force attempts, suspended/rejected driver, revoked JWT, simultaneous claims, network interruption, bad GPS, forged proof, stale order state and unexpected retries.
- Signed Android APK/AAB installation, iOS TestFlight build, and real-device authentication/push/GPS tests.
- Audit privacy/storage and access controls before merchant onboarding.

## Current phase result
First pass hardening added stricter validation/consent, rate limits, UUIDs, manual approval boundary, login guard, POS batch authorization header and regression coverage. **Not yet completed:** phone/email OTP, private document checks, native driver app, reliable background location, full earnings ledger, end-to-end staging run, device verification, security audit.

References:
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html
- https://developer.android.com/develop/sensors-and-location/location/background
- https://developer.apple.com/documentation/CoreLocation/requesting-authorization-to-use-location-services

## Sri Lankan driving-licence authenticity (provider-gated pilot, 2026-11-18)

**Evidence:** Veriff publishes Sri Lanka as supported for driving licences; it recognizes `DRIVERS_LICENSE` in its API. Its decision webhook exposes `verification.document.type`, `country`, and optionally `validUntil`; **expiry extraction requires Veriff Solutions Engineer enablement**. A positive identity result is not an official DMT licence status lookup.

- Provision a Veriff business integration and a verification flow that explicitly accepts **Sri Lankan driving licences** with document + selfie, authenticating both sides where required. Confirm sample Sri Lankan licences and required scripts with Veriff support before enabling merchants.
- Configure `VERIFF_API_KEY`, `VERIFF_SHARED_SECRET`, and the Veriff-controlled `VERIFF_BASE_URL=https://api-saas.veriff.com` **only in authorized staging secrets**, never in GitHub.
- Configure the provider **Decision webhook** to `https://gastroflow-staging.onrender.com/api/webhooks/driver-identity/veriff`. Verify callbacks use signature and API key headers; test real signed responses.
- **Feature flag:** only set `VERIFF_DRIVER_LICENCE_ENABLED=true` after document coverage and valid-until extraction are confirmed. With this switch off, managers must use the existing supervised licence review; the UI never claims document authenticity was machine-verified.
- A fresh rider with explicit third-party consent receives separate provider-hosted **identity** and **driving licence** verification URLs. No images, identity numbers or biometric templates are returned to the POS or stored in application tables.
- A signed licence webhook passes the authenticity gate only if provider outcome is approved, the document is `DRIVERS_LICENSE`, issuing country is `LK`, no known suspicious/temporary specimen flags are set, and `validUntil` is a legitimate future date. Missing evidence -> review, not auto-approve.
- Restaurant staff still separately verify vehicle class, legal eligibility, any suspension/revocation via appropriate authorized channels, and original licence evidence. The manager-entered expiry cannot exceed the provider-read expiry when automated checks are enabled.
- DMT vehicle-class review: unknown-capacity motorbike registrations require a manager-confirmed full **A** class; a restricted **A1** licence cannot be assumed sufficient without an engine-capacity workflow. Tuk-tuk requires **B1**; car/light van requires **B**. Bicycle couriers do not require a motor-vehicle licence but still undergo identity and restaurant review. Existing active drivers are not suddenly blocked by this additive change.
- If Veriff provides an extracted class or class-specific validity dates, a contradictory or expired entitlement triggers manual review; absent category extraction does not count as automated class verification.
- Neither document-verification result automatically activates the driver. New approval remains manager-only, tenant-bound and auditable.

**Required provider-host migration:** Veriff will retire legacy `stationapi.veriff.com` on 9 December 2026. Select your account's current API origin: self-serve `https://api-saas.veriff.com`, EU enterprise `https://api-eu.veriff.com`, or US enterprise `https://api-us.veriff.com`. The application rejects other API origins and untrusted session hosts. Source: https://status.veriff.com/incidents/mnh76bnp2dfl

**Pre-deployment read-only checks:** Confirm green GitHub Actions and that Render staging targets `codex/production-readiness`, with automatic deployments disabled. Staging rollout uses only the existing staging service after explicit approval. Check `/api/public/driver/verification-capabilities` after deploy; the endpoint reports configured capabilities, **not that a real Veriff decision has been tested**. With credentials absent, identity/license features remain off, and real-identity testing cannot start.

**Important limitations:** This is an integration foundation, **not a successful real-provider end-to-end verification**. No provider account/keys, DMT record-lookup API, real Sri Lankan licence, or real callback were independently tested. It cannot prove licence revocation/suspension or lawful vehicle entitlement. Confirm production privacy and cross-border biometric-processing obligations before collecting real documents.

Sources: https://www.veriff.com/supported-countries ; https://devdocs.veriff.com/apidocs/v1sessions ; https://devdocs.veriff.com/docs/decision-webhook

## Manual NIC/passport + selfie + licence fallback (staging pilot)

The manual route is not automatic identity proofing. After restaurant-specific email OTP registration, a pending applicant can upload **identity front, identity back/supporting page, a selfie, and for motorized vehicles both driving-licence sides**. The selfie input requests the front camera on supporting mobile devices, offers a preview and retake, and requires explicit consent; device camera capture is not cryptographic proof of a live human.

- Required staging environment: generate a random **32-byte base64** value for `DRIVER_DOCUMENT_ENCRYPTION_KEY`; provision it privately on the staging Render service, preserving all existing environment variables. Never commit/paste it, and preserve it during deployments or encrypted pending evidence becomes unreadable.
- Only authenticated restaurant **owner/manager** may open encrypted images. The server decrypts in memory for authorized review, records an audit log and a view stamp per document, and uses no publicly accessible image URL.
- A manual pass requires the same manager to open every required document, explicitly attest that the selfie visually matches the identity portrait, attest that document/original evidence was examined, and confirm correct motor-vehicle class and future licence expiry. All required images must still match the reviewed evidence hashes at final approval.
- The manager separately **approves or rejects** the driver; manual evidence alone never activates a driver. Final approval purges encrypted image blobs and keeps minimum review/audit metadata.
- **DMT status** is never labelled as an automated check. The manager may record that they performed an external check; the app must not assert the official result without authoritative verification.
- The privacy notice must be reviewed for Sri Lankan PDPA compliance, data residency/cross-border processing, administrator access and retention; never upload real ID images to staging until this is authorized.
- Still missing for full remote identity assurance: provider-backed liveness/presentation-attack detection, direct official licence-standing lookup, deletion of abandoned applications after an approved retention window, incident response and security penetration testing.

References: https://pages.nist.gov/800-63-4/sp800-63a/ial-general/ ; https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

## Two administrative levels — verification access (2026-11-18)

**Platform owner / RS Technologies:** Open **Platform Owner → Driver Verification Oversight**. This is a distinct read-only page and a platform-admin-protected API (`GET /api/platform/driver-verification-oversight`). It shows aggregate pending driver counts, manual reviews and provider-check counts grouped by restaurant. It never returns applicant identity photos, NIC/passport numbers, rider contact data, document images or applicant-specific review actions. Platform-wide support does **not** silently grant document visibility.

**Restaurant owner or manager:** Open **Restaurant POS → Delivery → Pending Rider Self-Registration Applications**. This is the only place to inspect protected identity and selfie evidence, attest that a selfie matches the document, check licence category/expiry, record manual review and separately approve/reject the applicant. API access requires a valid restaurant staff JWT, role `owner` or `manager`, plus exact tenant-specific document/driver ownership. Another tenant's evidence is not found.

**Cashiers and other restaurant staff:** Cannot retrieve sensitive evidence or approve applications. **Drivers** can submit their own documents using a signed, tenant-specific temporary application token only while their application is pending, but cannot review or approve.

**Escalations:** If a restaurant requests platform assistance on a suspicious application, platform staff see aggregate status only. The restaurant manager must examine evidence and make the approval decision. A future formal delegated-review feature would require explicit restaurant consent, named reviewer permissions, separate data-access grants, expiry, audit records and privacy/legal approval; it does not exist by default.

The official DMT standing field remains **manager-reported external review**, never an assertion that GastroFlow has an official government status API. Real Veriff document authenticity/liveness remains contingent on activating and testing the provider.
