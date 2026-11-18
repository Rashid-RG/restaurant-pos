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
