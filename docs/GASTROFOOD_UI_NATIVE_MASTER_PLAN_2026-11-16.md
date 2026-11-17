# GastroFlow Food — Customer Experience, Microfeatures & Native App Master Plan
Review: 2026-11-16 | Branch: `codex/production-readiness` | Target: staging only, after explicit approval.

## Scope and evidence
This plan extends the 2026-11-13 customer-app master review, not a new product. Current source: `apps/customer-web`, `apps/driver-web`, common `server.js`/`routes`, Turso and Render staging. Inspection of source proves implementation presence, **not** end-to-end readiness or a pixel-perfect image match. No live database, real-device session, payment settlement, or production deploy was modified by this plan.

### Evidence-based baseline
- React 18 + Vite customer app, Leaflet map; PWA manifest, service worker, separate driver manifest and dedicated customer/driver logo assets present.
- `OrderTrackingView.jsx`: order snapshot + SSE, driver updates, push opt-in and ETA display; `TrackingMap.jsx`: OpenStreetMap, rider marker interpolation, available road-route geometry, GPS accuracy circle; `tracking-presentation.js`: stale-fix policy, no fabricated ETA, transport reconnect recovery.
- `RestaurantsView.jsx`, `MenuView.jsx`, `CartCheckoutView.jsx`: full browsing/ordering surfaces already present; live backend, tenant and provider behavior still requires acceptance.
- `capacitor.config.json` at repo root identifies *GastroFlow POS & Food Suite* (shared), `webDir:dist`, and Android `cleartext:true`: **do not ship this unchanged as GastroFood**. Customer, driver and POS require independent, verified native configuration and package identity.
- `public/manifest.json` and `driver-manifest.json` are distinct but both share `scope: /customer/`; verify installation behavior and identity resolution on real devices.
- Generic `public/icon-192.png` and `icon-512.png` reference the same blob in the audited tree: check true embedded PNG dimensions and installed launcher behavior. The manifests currently refer instead to `food-logo-192.png`, `food-logo.png` and corresponding driver assets.
- Frontend ships several large layered CSS files and screen files (e.g. checkout ~62KB, restaurants ~50KB, tracking ~41KB); measure bundle size, CSS specificity and interaction latency before declaring performance acceptable.

## Release gates (non-negotiable)
1. **Data integrity:** never delete/overwrite old Turso customer, order or sales data; backup and verify restore. Only additive, reversible migrations with rollback.
2. **Tenant isolation:** test at least two shops and two customer accounts; all URLs, sessions, orders, streams, push subscriptions, links, images and fees must map to correct restaurant.
3. **State honesty:** no invented restaurant ratings, availability, promotions, ETAs, traffic or driver positions. Display missing/stale states explicitly.
4. **Checkout integrity:** server-authoritative price, store open status, delivery eligibility and order idempotency; transactional order-to-POS handoff; payment provider reconciliation; failed payment never shown as settled.
5. **Accessibility & usability:** WCAG 2.2 AA critical flows, keyboard focus, reduced motion, screen-reader labels, large tappable targets, RTL/translation overflow review; no clipped fixed cart or nav bar.
6. **Verification:** unit + API + browser + mobile simulator + physical device; include slow 3G, 320px and 390px widths, expired sessions, offline/reconnect and battery saver.
7. **Deployment:** develop on `codex/production-readiness`, protect `main`/production; do not deploy staging until explicit user approval. Verify automated deployments remain disabled.

## Prioritized backlog and acceptance criteria

### P0-A — Common mobile design system
- Define tokens: brand, text/surfaces, elevation, 8px spacing, type scale, radius, focus, motion; unify conflicting CSS rules; retain existing RS Technologies / GastroFlow identity.
- Screens: splash/onboarding, home/restaurant list, search, restaurant detail, menu, cart, checkout, orders, tracking, profile, help, login/OTP, saved addresses, AI.
- Navigation: persistent accessible mobile bar, safe-area insets, keyboard-aware fixed CTA, visible checkout/cart action, scroll-restoration, deep links/back gestures.
- Each screen gets empty/loading/error/offline/closed-store/disabled states; no forced scrolling past hidden primary controls. Benchmark p75 LCP <=2.5s, INP <=200ms, CLS <=0.1 for key routes.

### P0-B — Discovery + menu microfeatures
- Geolocation permission explanation; manual pinpoint address and saved apartment/landmark instructions; never guarantee GPS precision. Server checks deliverability, operating hours/capacity and authoritative quote.
- Search debounce, exact/partial multilingual aliases, cuisines/dietary filters, sorting; verified ratings only; open/paused/closed explicit; no order CTA when unavailable.
- Menu availability + modifier groups/min/max selections, prices, taxes, allergens, quantity, notes, imagery loading/error; persisted tenant-scoped cart and account switch cleanup.
- Close store while cart open, item unavailable while checkout, switch restaurants mid-cart and slow-network retry scenarios.

### P0-C — Checkout + order lifecycle
- Distinct takeaway/dine-in/delivery fulfillment modes; address/pin and store-specific fees; coupons and loyalty verified server-side.
- Bank/COD/PayHere only when actually enabled; explicit not-available card messaging and no simulated settlement in real mode.
- Idempotent submit, duplicate tap guard, timeout recovery with canonical order lookup; receipt/store name accurate; notifications show provider ack separately from actual delivery.
- Multi-store POS incoming order, stock and kitchen acceptance tests with synthetic orders only.

### P0-D — Tracking interface: approved design concept
- Use map-first customer layout: branded compact header, source-backed ETA/status overlay, restaurant and destination pins, current rider marker, accessible recenter, expandable tracking bottom sheet.
- Real statuses (received/preparing/ready/picked-up/out-for-delivery/arrived/completed) remain semantically distinct even if condensed visually.
- Never animate a fabricated GPS location. Interpolate only between authenticated recent fixes; when stale hide rider marker or show *last seen* clearly. Label straight-line fallback as non-road route.
- OSRM-compatible backend route behind feature/availability gate; route validity, no route, wrong coordinates, driver unassigned, reconnect and order cancellation.
- Driver identity and call/message/help shown only with confirmed assignments and authorized contact channels; do not invent rider ratings/vehicle plate.
- Prove SSE authentication, reconnect snapshot and tenant privacy. Exercise 2 browser sessions, delayed GPS/out-of-order updates, driver app backgrounding, poor signal and battery saver.

### P0-E — Identity, privacy and isolation
- OTP resend/expiry/rate limits, account recovery, password policies, session revocation, customer versus store-owner identity; avoid tokens leaking to URL, logs or wrong tenant.
- Secure per-order SSE capability and notifications, cross-restaurant URL adversarial tests, consent/retention/erase policy and rate limiting.

### P1-F — GastroMate and support
- AI recommendations grounded exclusively in tenant-scoped open/available menu, correctly priced item variants; consentful memory; validation/reconfirmation before any cart mutation.
- Animated burger mascot states: idle, listening, thinking, typing and cheerful confirmation; respect reduced-motion and battery/performance.
- Human support escalation, token-scoped tickets, driver/contact fallback and content moderation.

### P1-G — Localization, engagement, offline
- English/Sinhala/Tamil copy verification on every status, error, cart option, OTP and push notification; locale-sensitive money/time in selected restaurant timezone.
- Native/APNs/FCM notification plan, permission rationale, deep-link routing and unsubscribe; offline read-only shell, never claim offline order acceptance.
- Favorites, reorder, order history, consentful saved addresses, optional personalized home.

## Real phone applications (same backend, separate clients)
**Customer Android/iOS:** retain React/Vite web app, create dedicated Capacitor 8 project/config with separate `appId`, display name, custom food icon, splash and URL scheme. Bundle local frontend assets; secure HTTPS API configuration; test native back/navigation, Safe Area, keyboard, push, links and notification handlers. Root shared Capacitor config must **not** be overwritten.
**Driver Android/iOS:** separate client identity/icon/splash, native background tracking and foreground service/permissions where required, driver login, shift/on-task privacy controls, throttling/accuracy filter, signed coordinate updates, offline/retry and stale signal. Evaluate Capacitor native plugin suitability through real-device spikes; if unreliable, isolate driver app in dedicated React Native/Expo or native implementation while preserving server APIs.
**POS:** remain unchanged; avoid turning POS package into the customer build. Never embed production API secrets in app bundles.
**Distribution:** Android internal testing then Play closed track; iOS TestFlight then App Store; accounts, privacy disclosures, signing keys, screenshots, permission review and crash reporting required. No IPA/APK or store submission is claimed yet.

## Milestones / definition of done
- M0 (now): source and prior-plan gap audit, tracked backlog, native readiness checker.
- M1: consistent UI tokens; compare screen captures to approved tracking concept and build mobile flow screenshot baseline.
- M2: P0 API and multi-tenant/checkout tests pass, including duplicate/closure/offline cases.
- M3: map-first tracking screen with real backend data and fallback states; GPS and SSE authorization verified.
- M4: dedicated customer Android debug build and real-phone install, plus iOS simulator/TestFlight path.
- M5: native driver background tracking acceptance matrix on several actual Android phones and one iPhone; document platform restrictions.
- M6: all release gates green and user signs off deployment; staging first, commercial release only after additional permission.

## Required physical-device test matrix
Android small-screen budget device, current midrange Android, Samsung battery-optimization case, iPhone Safari and iPhone installed/native. Validate cold start, icon, splash, permissions, keyboard, cart CTA, logout/refresh, multiple shops, low network, screen rotation handling, deep links, checkout recovery, notifications, GPS freshness while app visible/backgrounded, OS kill and reconnect. **Do this near the end as previously agreed**, not as evidence of completion now.

## Immediate work queue
1. Introduce automated audit of PWA manifests and physical icon dimensions, no database changes.
2. Prepare isolated food app native build configuration only after deciding final app identifier; preserve existing root Capacitor config.
3. Snapshot current customer UI and implement map-first tracking behind a reversible feature flag with actual server data.
4. Add all screens to screenshot regression + accessibility tests and mark previously planned CUST-* stories with CI evidence.


## Implementation status ledger — updated 2026-11-16

**Status policy:** `DONE (code)` means committed to the existing branch, not deployed or verified on a phone. `PASS (CI)` requires a recorded successful CI run; `PASS (device)` requires physical phone evidence. Never automatically mark a milestone complete simply because code exists.

| Work item | Status | Evidence | Next verification |
|---|---|---|---|
| Architecture and microfeature review | DONE (review) | This plan and earlier master review | Reconcile individual CUST-* stories after E2E testing |
| App icon / manifest audit utility | DONE (code) | `95125f2` | Execute `npm run mobile:audit`; fix flagged dimensions |
| Mobile audit npm command | DONE (code) | `3bf7a5f` | CI execution |
| Enforce mobile audit in customer build workflow | DONE (code) | `1c7a664` | Confirm workflow status in GitHub Actions |
| Cart shortcut / bottom navigation safe-area CSS | DONE (code) | `8603881` | Physical iPhone/Android keyboard, notch and 320px checks |
| Existing order map, SSE and GPS fallback | IMPLEMENTED BEFORE THIS REVIEW | `TrackingMap.jsx`, `OrderTrackingView.jsx` | Real-driver + cross-tenant tests |
| Map-first tracking first iteration | DONE (code), NOT YET VISUALLY VERIFIED | `977b20e`, `c713d9a` | Build/CI, screen captures, semantic accessibility and device audit; full image parity still pending |
| Expandable status timeline / bottom disclosure | DONE (code), verification pending | `3779df8`, `47dcb63` | Build, real order stages, screen reader and 320px phone checks |
| Assigned-rider and restaurant contact panel | DONE (code), verification pending | `28a8f66`, `9419996`, `6949b83`, `5e0ed0a`, `3cddc63` | CI safety tests, authorized chat, phone and messaging on devices |
| Marketplace search and filter accessibility | DONE (code), verification pending | `58891b6`, `85db423`, `cb50126`, `34c8389` | Run customer CI, browser interaction and multi-language real-device testing |
| Menu modifier, stock and customizer guardrails | DONE (code), verification pending | `519318e`, `c8e9ee5`, `358b4bc`, `7fbd830`, `b52a309` | Run menu tests, full build and real checkout validation |
| Delivery quote freshness and checkout eligibility | DONE (code), verification pending | `c6d4483`, `600d88a`, `da7829e`, `50ed5fa`, `0aec591`, `8506434` | Customer CI, API quote and cross-store / fast-address-switch E2E tests |
| Order acknowledgement and interrupted payment cart retention | DONE (code), verification pending | `3f5f176`, `a27a1c8`, `96797b8`, `2e2aa46` | Run CI and real server idempotent recovery with injected timeouts and PayHere sandbox settlement |
| Isolated end-to-end customer → kitchen → driver → tracking CI gate | DONE (CI code), run pending | `5c8152d` | Confirm workflow green, inspect test logs; no live system contact |
| Unified design tokens and all-screen redesign | NOT STARTED | Existing layered CSS | Screen-by-screen implementation and visual snapshots |
| Dedicated GastroFood customer native configuration | DONE (config code), RELEASE BLOCKED | `12fe9b6`, `668a7dc`, `b05a34c`, `87c3617` | Lock Capacitor deps, native web build, authenticated remote API base and platform projects |
| Native HTTPS origin resolver and relative asset builds | DONE (code), CORS/device verification pending | `53bf725`, `2ae4333`, `7e350dd`, `c40958b`, `0f8d779` | Confirm approved native origin, production CORS, native static assets and tests |
| GPS location detection and geocoding reliability | DONE (code), real-device verification pending | `dd7e792`, `99e559c`, `165e278`, `a5873cd`, `3911d89`, `1b81250`, `7c7dbd6`, `423b98e`, `53bc330`, `25474a2`, `e66af66` | Permission prompts, iOS/Android GPS, weak signal, slow lookup and accurate pin acceptance |
| Dedicated GastroFood Android build | NOT BUILT | Separate identity configured, Android project not generated | Build, signed debug test, verify native permissions/icons |
| Dedicated GastroFood iOS build | NOT BUILT | Separate identity configured, iOS project not generated | Native iOS project, Xcode simulator and TestFlight |
| Background GPS driver app acceptance | NOT TESTED | Existing driver/web foundation | Real-device battery/background tests |
| Render staging deployment of this phase | NOT DEPLOYED | Auto-deploy disabled for staging | Explicit approval and verified build |

**Change policy:** these code commits do not modify DB schema, Turso customer/sales records, POS billing or pricing logic; staging remains unchanged until separately authorized.


### Progress checkpoint — 2026-11-16: map-first tracking UI
- **DONE (code)** `977b20e`: display existing authorized delivery map ahead of hero status for active delivery orders with destination coordinates; preserve the existing real route, server-backed ETA and rider GPS freshness semantics.
- **DONE (code)** `c713d9a`: responsive map surface, heading, ETA chip, GPS freshness display, explicit straight-line fallback, and mobile-friendly sizing.
- **NOT YET DONE:** verify CI/build and phone screenshots, compare against approved mockup (bottom-sheet, route contacts, typography), check feature with active order and stale fix. No claim of native release or deployment.

### Progress checkpoint — 2026-11-16: order-status bottom disclosure
- **DONE (code)** `3779df8`: native keyboard-accessible expandable order-progress section using the existing canonical delivery/dine-in/takeaway steps and actual server status; no fabricated stage transitions.
- **DONE (code)** `47dcb63`: mobile-friendly bottom-disclosure panel styling, current/completed/future stage markers, focus-visible and reduced-motion support.
- **PENDING (verification)** CI/build, screen-reader/keyboard, screenshot comparison, genuine order status transitions, 320px/390px phone screens. Does not yet replicate every element of the concept image.
- **PENDING (release)** No Render deploy or native app publication has been authorized for these changes.

### Progress checkpoint — 2026-11-16: contact panel
- **DONE (code)** Real rider chat/call controls are consolidated near the tracking progress panel. Rider actions require a confirmed active assignment; calling also requires a validated number. Restaurant actions appear only when a valid phone number is available.
- **DONE (code)** Sri Lankan local number normalization for restaurant WhatsApp links; international numbers preserve explicit country code. No invented phone numbers or driver profile details.
- **DONE (code)** Removed duplicated rider actions from receipt; shared order-reference text no longer automatically includes private tracking URL or customer details.
- **DONE (code)** Added contact-action regression tests and registered them in the customer CI job.
- **PENDING** GitHub CI outcome, browser/mobile visuals, deep-link behavior, and end-to-end chat/phone testing. This is not a claim of deployment or commercial-ready communication.

### Progress checkpoint — 2026-11-16: discovery search and filter accessibility
- **DONE (code)** `58891b6`: accent-tolerant Unicode search over actual restaurant name, cuisine, location and cuisine tag, matching every query word. No synthetic names or translated aliases.
- **DONE (code)** `85db423`: search integration; accessible pressed-state and group labels for restaurant sort, cuisine and availability filters; location coordinates checked with finite-number validation. Estimated proximity now explicitly labelled an estimate; merchant open state remains separate.
- **DONE (code)** `cb50126`: multilingual and punctuation-aware search unit tests, including Sinhala/Tamil; `34c8389`: included in customer CI.
- **PENDING:** CI build and test run, browser focus/keyboard and mobile visual checks; server-authoritative delivery-zone and fee checks remain separate P0 acceptance requirements.
- **NO DEPLOYMENT:** branch code only; no schema, Turso or POS changes.

### Progress checkpoint — 2026-11-16: menu customizer and quantity checks
- **DONE (code)** `519318e`: shared selection validator rejects unknown modifier IDs, required groups without a selection, duplicates and multiple options in exclusive groups; remaining stock calculation includes quantity already placed in customer cart.
- **DONE (code)** `c8e9ee5`: menu customizer radio/checkbox selections use centralized consistent group handling; mandatory options and remaining stock are checked again in add-to-cart handler (not only disabled-button UI). Mobile quantity selector limits additional stock against existing variants.
- **DONE (code)** `358b4bc`: unit regression coverage for exclusive/multiple groups, missing required options, unknown modifiers and cart stock constraints.
- **DONE (code)** `7fbd830`: remaining-stock explanation in customizer. `b52a309`: include menu regression tests in customer quality workflow.
- **NOT YET VERIFIED:** full GitHub CI, mobile customizer accessibility, group-cart acceptance, price reconciliation and server-side option validation. The backend remains authoritative; frontend checks are not an authorization/security boundary.
- **NOT DEPLOYED:** no database migrations, live sales or POS changes.

### Progress checkpoint — 2026-11-16: checkout delivery quote and recovery UX
- **DONE (code)** `c6d4483`: utility to bind delivery quotes to tenant, coordinates and cart subtotal, reject invalid or out-of-range fee results.
- **DONE (code)** `600d88a`: customer checkout ignores late quote responses after switching address or subtotal, clears stale estimates, requires valid current quote for delivery submission, and clears old pins when saved addresses lack coordinates.
- **DONE (code)** `50ed5fa`: bill marks unquoted totals provisional, hides fee breakdown from different quote, and blocks button with an actionable label.
- **DONE (code)** `0aec591`: mobile quote verification status styling; `da7829e`: quote freshness and out-of-zone regression cases; `8506434`: registered tests in CI.
- **PENDING verification:** GitHub CI execution, API contract for numeric totalFee, real checkout and payment acceptance with two tenants, slow network and fast address switches. Server-side reprice and zone enforcement must be verified separately; browser quote is not authoritative.
- **NOT DEPLOYED:** no live database or POS modifications.

### Progress checkpoint — 2026-11-16: lost-response and payment recovery
- **DONE (code)** `3f5f176`: explicit server order ID acknowledgement prerequisite for cart finalization. Invalid or missing order IDs are not treated as successful acceptance.
- **DONE (code)** `a27a1c8`: actual checkout requires authoritative order reference before navigating or clearing cart; sandbox settlement helper keeps original cart/recovery intent unless the server confirms payment paid. Existing retry uses persisted idempotency key.
- **DONE (code)** `96797b8`: regression coverage for malformed responses, closed orders and pending online payments; `2e2aa46`: included acknowledgement, interrupted recovery and duplicate-submit guard suites in the customer workflow.
- **PENDING verification:** automated customer build/test result, real API and PayHere sandbox acceptance, two-tenant isolation and network timeout/reconnect simulation. No claim of production settlement or app-store readiness.
- **NOT DEPLOYED:** no Render deployment or Turso migration authorized.

### Progress checkpoint — 2026-11-16: lifecycle integration gate
- **DONE (CI configuration)** `5c8152d`: dedicated order lifecycle GitHub Actions workflow runs existing isolated `tests/online-store-isolation.test.js`, `tests/order-safety.test.js` and `tests/customer-commerce-safety.test.js` under Node 24 with single-worker execution. No Turso, payment or production secrets are supplied.
- **EXISTING INTEGRATION COVERAGE, NOT NEWLY IMPLEMENTED:** customer order placement → kitchen tickets → preparation/ready transitions → rider assignment/pickup/out-for-delivery → customer tracking; second-tenant privacy; idempotency replay; customer receipt and inventory ownership; manual bank payment reconciliation.
- **PENDING:** first full CI run, check failed test logs, physical device acceptance and real staging end-to-end verification using non-customer test data. The CI job intentionally does not perform staging deployment.

### Progress checkpoint — 2026-11-16: isolated GastroFood native preparation
- **DONE (configuration code)** `12fe9b6`: customer-only `apps/customer-web/capacitor.config.json`, appId `com.rstechnologies.gastrofood` (provisional; confirm ownership before public distribution), appName **GastroFlow Food**, independent of existing POS suite appId. No cleartext or remotely hosted WebView entry configured.
- **DONE (read-only tooling)** `668a7dc`: `scripts/audit-gastrofood-native-readiness.mjs` validates distinct identity and HTTPS-only settings and prints **release blockers without suppressing them**. `b05a34c` exposes `npm run food:native:preflight`; `87c3617` wires the audit into the customer quality workflow.
- **NOT DONE (native release)** The monorepo does not currently lock Capacitor core/CLI/platform dependencies; customer Vite paths target `/customer/`; customer API `location.origin` behavior will not connect to Render from a `capacitor://` or native localhost origin; no generated Android/iOS customer projects, native splash/icon resources, push credentials, deep links, or real-device testing. Do not call the configuration an APK/IPA or publish it.
- **NEXT** Verify an explicit HTTPS staging API origin and CORS + tenant-auth behavior in native context, design native-only relative-asset build and browser-vs-native routing contract, lock and install tested Capacitor versions, then generate Android/iOS projects with independent icon/splash assets. Obtain final app bundle ID approval before any store submission.
- **GUARDRAILS** Existing POS Capacitor config untouched; no deployment; no Turso changes.

### Progress checkpoint — 2026-11-16: native API assets and customer GPS reliability
- **DONE (code)** `53bf725`, `2ae4333`: native-only customer API routing requires explicitly configured bare HTTPS `VITE_NATIVE_API_ORIGIN` and preserves existing hosted PWA same-origin behavior. Native missing configuration fails closed.
- **DONE (code)** `7e350dd`: separate Vite `--mode native` relative asset base; hosted customer PWA remains `/customer/`. `c40958b` covers URL validation and browser-vs-native endpoints. `0f8d779` updates readiness diagnostics.
- **PENDING (native)** Production CORS currently allowlists configured origins; native `capacitor://localhost` / `https://localhost` origin is not enabled yet, pending exact target and secure auth design. No real APK/IPA generation, Capacitor package lock or hardware install. Packaging must not proceed as commercially ready.
- **DONE (code)** `dd7e792`: geolocation with high-accuracy first, bounded fallback for unavailable/timeouts, accuracy threshold, valid Sri Lankan area check; explicit location permission gating.
- **DONE (code)** `99e559c`: previously granted permission allows automatic geolocation without prompting on discovery. Explicit GPS action remains available; valid pin survives reverse-geocoding failures. Outdated GPS responses cannot replace a newer manual location.
- **DONE (code)** `a5873cd`, `3911d89`: city-center approximations are no longer labelled precise; switching to text-only addresses cannot retain an unrelated previous GPS location. Real pin / geocoded address required for nearby precision label.
- **DONE (code)** `1b81250`: checkout map picker commits valid coordinates before reverse-geocoding, and ignores stale reverse results; `7c7dbd6`, `423b98e`: accessible, one-tap customer location button on discovery.
- **DONE (code)** `53bc330`, `25474a2`: discovery search and reverse geocoding now use existing server endpoints; accessible address suggestion buttons. `165e278`: location-acquisition unit tests; `e66af66`: customer CI includes location and native API tests.
- **PENDING** Actual device location permission experience (first-time prompt, repeat visits, permission denied/revoked), GPS accuracy indoors/urban canyons, Wi-Fi/cell fallback, geocoder API traffic/caching, mobile browser and native app acceptance. No location accuracy is guaranteed to 100%; customer must verify delivery pin before ordering.
- **DONE (code)** `c1c5206`, `4eec779`: acquiring or selecting a new pin refreshes the restaurant list for those coordinates, older list-fetch responses are discarded, saved-location reverse search goes through the same server geocoder, and previously granted GPS access refreshes stale GPS pins without overriding explicit manually selected places.

### Progress checkpoint — 2026-11-16: native web bundle and strict API-origin preflight
- **DONE (code)** `4f6462f`: native-mode Vite builds now require an explicitly configured, valid HTTPS `VITE_NATIVE_API_ORIGIN` at build time, not only when the user taps an API-driven control. Existing hosted `/customer/` builds are unchanged.
- **DONE (code)** `0b2b338`: packaged native mode does not register the hosted customer service worker. Normal browser/PWA service worker behavior is retained.
- **DONE (code)** `228e40a`, `8e1b2aa`: backend can opt in to **only exact** `capacitor://localhost` and `https://localhost` WebView origins through `CUSTOMER_NATIVE_ORIGINS`, with no defaults in production. Other origins remain blocked unless explicitly in the existing `CORS_ORIGIN` setting. This is not an authentication bypass or a permission to cross tenants.
- **DONE (code)** `4cb9e5b`: tests that wildcard/arbitrary/insecure origins cannot enter the native-origin list. `cf85321`: `npm run customer:native:build` creates a native-mode customer web bundle, failing when HTTPS origin missing.
- **DONE (CI configuration)** `93c4c2c`: after regular hosted-build checks, CI attempts a native-mode customer bundle against the public staging HTTPS origin with no deploy. `5957a71`: readiness audit distinguishes implemented code and remaining environment/device blockers.
- **PENDING operations**: An authorized maintainer must explicitly set `CUSTOMER_NATIVE_ORIGINS=capacitor://localhost,https://localhost` (or the subset required) in staging when testing actual native shell requests. No Render environment variables were modified.
- **PENDING native acceptance**: Verify initial document load, packaged app assets, secure API request headers/tenant isolation, event-stream auth, location permissions, push notifications, maps and geocoder; generate isolated Android/iOS native projects and lock Capacitor versions; do not claim an APK or IPA exists.
- **PENDING CI evidence**: A GitHub workflow configuration/commit is not a passing build. Confirm build and test status independently.

### Progress checkpoint — 2026-11-16: native tracking transport and installed-shell UX
- **DONE (code)** `1e45970`, `12db197`, `953f315`: native-mode order tracking deliberately does **not** open the hosted site's cookie-bound SSE stream. It retains existing authenticated order snapshot polling via tenant-scoped customer API requests until a native event-stream access model is designed and tested. Browser/PWA SSE functionality is unchanged. This is a fallback, not a claim of instant native tracking.
- **DONE (code)** The native shell hides web-only push-subscription controls; they require a separate mobile push provider and explicit device testing. No claim that native push notification registration works yet.
- **DONE (code)** `a37821d`: native shell does not display the browser Add to Home Screen banner; hosted website behavior is preserved.
- **DONE (tests and CI config)** `68e8854`, `f989485`: tests and customer CI configuration enforce the native-vs-hosted transport and push policy. A successful CI execution has not yet been confirmed.
- **PENDING** Generate actual platform projects after pinned Capacitor dependency installation; test native GPS permissions, network/CORS, tracking fetches and background/foreground lifecycle on physical phones, then implement mobile push and authenticated streaming separately.
- **RELEASE GUARDRAILS** No deployment, native publication, POS change, or Turso customer-data operation.

### Progress checkpoint — 2026-11-16: isolated native Capacitor dependency preparation
- **DONE (source configuration)** `e86b5ed`: `apps/customer-web/package.json` now pins `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, and `@capacitor/ios` to exact **8.6.2**. The root POS package, root Capacitor config and root npm lock were not modified.
- **DONE (source guard)** `99bdb5a`: `scripts/check-food-native-project.mjs` blocks `cap add`/`cap sync` from the repository root, missing customer package lockfile, incorrect versions, wrong app identity or missing `apps/customer-web/dist/index.html`. Customer package scripts `native:add:android`, `native:add:ios`, and platform-specific sync commands include this guard.
- **DONE (test and audit configuration)** `3a7bc48`: unit tests verify the guard rejects wrong working directory, missing assets/lockfile, version drift, and wrong package identity. `5c3b62a`: native readiness audit checks *customer* dependencies and lockfile instead of incorrectly checking the root POS package. `e12b7aa`: customer CI now includes the guard regression tests and watches customer package changes.
- **DONE (setup guide)** `0b8a705`: `docs/GASTROFOOD_NATIVE_ANDROID_IOS_SETUP.md` documents safe customer-only installation and generation, Windows/macOS commands, explicit staging-origin expectations, and release acceptance gates.
- **NOT DONE** Native dependency install and customer `package-lock.json` generation (npm registry access was unavailable in the development environment), actual Android/iOS native platform generation, Android APK/iOS IPA signing, installable icon/splash resources, device test. Do not claim these are complete or commercially ready.
- **SAFETY** Existing staging Render autoDeploy remains disabled. No deployment, customer data operation, Turso migration, POS config update, or root package-lock alteration.

### Progress checkpoint — 2026-11-17: isolated Android/iOS foreground location permissions
- **DONE (code)** `e7d7c7e`: customer-only, idempotent Android/iOS native permission preparation in `scripts/setup-food-native-location-permissions.mjs`. Explicitly opts into foreground coarse/fine Android location and iOS `NSLocationWhenInUseUsageDescription`; GPS is optional and background tracking permissions are not added.
- **DONE (source configuration)** `30cbedf`: `apps/customer-web/package.json` provides `native:permissions:android` and `native:permissions:ios` commands to apply these settings only to generated native projects.
- **DONE (test/CI config)** `51ed99b`, `cb0a79b`: unit tests cover first application, idempotency, malformed XML rejection, wrong working directory and missing native platform folders; included in customer CI.
- **DONE (documentation)** `2d1690e`: setup guide documents permission commands and customer-consent/accuracy acceptance gates.
- **NOT YET DONE** Actual Android/iOS native folders, customer dependency lockfile, installable builds, screenshots, Apple/Google account setup, device permissions, native geolocation plugin and OS runtime acceptance. Attempting an npm registry lookup in the available execution environment failed with DNS `EAI_AGAIN`; no dependency installation has been claimed.
- **SAFETY** No deployment, root POS modifications, Turso reads/writes or live customer data operations.

### Progress checkpoint — 2026-11-17: native lockfile reconciliation and Android source CI
- **VERIFIED BLOCKER:** An existing `apps/customer-web/package-lock.json` was discovered on the branch, but its root package record predates the Capacitor 8.6.2 additions and it contains **zero** `@capacitor/*` packages. The previous description of it as "missing" was inaccurate. In its current state native `npm ci` must be treated as blocked.
- **DONE (CI source)** `b5512e8`, `4a80cc6`: a non-deploying, read-only GitHub Actions workflow resolves customer-only dependencies on a Node 24 runner, verifies versions, checks that the root POS `package-lock.json` is unchanged, uploads a candidate customer lockfile, and then **attempts** an isolated Android source project generation with foreground GPS permission setup. It uploads the Android project as an unsigned source artifact if successful; no auto-commits, signing or Render changes.
- **DONE (code/tests)** `906fe8a`, `b1f2e56`, `97c456b`: strict lockfile verifier, stale lockfile/version-drift regression coverage and inclusion in customer quality CI.
- **DONE (documentation)** `a6966e8`, `64f6608`: guide documents which files are stale, where GitHub Actions artifacts should be reviewed, and how to safely bring verified customer lockfile/Android platform source back to the branch.
- **PENDING** Confirm actual workflow run success and retrieve candidate artifacts; do not claim a lockfile was regenerated or native Android source was built until they exist. Mac/Xcode iOS project, signatures, branded adaptive icon resources, Android APK, iOS IPA, staging CORS/device testing, notification delivery and production release all remain outstanding.
- **ENVIRONMENT LIMITATION** Direct npm registry request in the current execution container failed with DNS `EAI_AGAIN`; workflow runs were not verified here.
- **SAFETY** No deployment, no changes to Turso, root POS lockfile or POS app configuration.

### Progress checkpoint — 2026-11-17: successful Android source artifact, branded native resources, CI recovery
- **VERIFIED GitHub Actions outcome:** Run `43932069024` on commit `4a80cc6` completed with both `lockfile-candidate` and `android-source-candidate` jobs **successful**. Non-expired artifacts: `gastrofood-customer-package-lock-candidate` (artifact `14259006527`) and `gastrofood-android-source-candidate` (artifact `14258956648`). The extracted customer lock resolves `@capacitor/{core,cli,android,ios}` exactly at **8.6.2**. The Android project's `app/build.gradle` uses `com.rstechnologies.gastrofood` and manifest includes foreground coarse/fine permissions.
- **LIMITATION:** GitHub artifacts are not committed app source and the Android project is not an APK. The previously generated Android artifact still contains default Capacitor launcher/splash resources, not the approved GastroFlow Food branding.
- **DONE (branding generator code)** `f5bbe4a`: an isolated Android branding script uses existing `apps/customer-web/public/food-logo.png` to fill launcher, round-icon, adaptive foreground, and generated portrait/landscape splash resources without modifying root POS files. The source asset in the Android artifact was confirmed a 512×512 RGBA PNG.
- **DONE (CI configuration)** `ffbb01d`: Android source-candidate pipeline now applies and checks those branded resources before uploading the artifact. This updated branding job is **not yet confirmed successful**.
- **CONFIRMED earlier quality failure:** Customer quality run `43931920763` had **61/61 tests passing** in **16 test files**, but `food:native:preflight` failed because the committed `apps/customer-web/package-lock.json` predates Capacitor additions. Hosted/native bundles in that job were therefore skipped.
- **DONE (CI unblock)** `05cb100`: quality gate now refreshes the **customer-only** dependency lock in the runner before verifying Capacitor 8.6.2 and running readiness audit; this does not modify the committed root POS lockfile or deploy staging. A green workflow rerun is pending.
- **PENDING** Review and commit the successfully generated customer lockfile and Android source after verifying packaging resources; Android Gradle APK build and emulator test; separate Mac/Xcode iOS generation, native push and foreground GPS acceptance. No signing/deployment/production release performed.

### Verified checkpoint — 2026-11-17: branded Android source and restored customer CI
- **VERIFIED** GitHub Actions run [43934768841](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43934768841), commit `ffbb01d`: lockfile and Android source jobs completed **successfully**. Branded source artifact `14259503510` was downloaded and inspected: `ic_launcher.png` 192×192, adaptive foreground 192×192, generated splash 480×320, all using the approved existing 512×512 GastroFlow Food logo. These are native **source assets**, not a compiled APK or device verification.
- **VERIFIED** GitHub Actions run [43934812048](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43934812048), commit `05cb100`: customer quality gate completed **successfully**, including customer regression tests, mobile asset audit, temporary customer lock resolution and verification, native preflight, hosted POS/customer/driver builds, and native-mode customer web build.
- **REMAINING** The correct customer dependency lockfile is a GitHub Actions artifact, but the committed `apps/customer-web/package-lock.json` is still stale; review and commit the verified lock candidate. The Android project is a downloadable CI artifact, not a committed native project; review the generated source before adding to the branch. No APK was compiled, no iOS project generated, and no simulator/physical test performed. Native push, background integration, secure staging CORS and full checkout need acceptance.
- **SAFETY** These workflows install/build on ephemeral GitHub runners and upload unsigned artifacts. No Render deployment, signing, root POS config mutation, or live Turso customer/sales data changes.

### Progress checkpoint — 2026-11-17: Android debug APK build and private-data backup protection
- **DONE (source)** `3d406d7`, `02a56e4`: new isolated `native:harden:android` step changes only `apps/customer-web/android/app/src/main/AndroidManifest.xml` to explicitly set `android:allowBackup="false"` (private customer tokens/cart/tracking data should not be restored across devices). Root POS config and native projects remain unchanged.
- **DONE (tests)** `dd80b0f`, `7f6e0cb`: guard and idempotency tests for Android backup hardening are added to customer CI.
- **DONE (CI configuration)** `13d6e90`: on GitHub's ephemeral Linux runner, isolate the customer source, verify package identity and manifest, set up Java 21/Android SDK, attempt `gradlew :app:assembleDebug`, and upload `gastrofood-android-debug-apk` if Gradle passes. This is a debug-only APK, not production signed and not a Play Store release.
- **VERIFIED PREVIOUS GREEN GATES:** Customer web quality run `43934812048` and branded Android source run `43934768841` passed. Debug APK compilation from `13d6e90` was in progress when the workflow was first inspected; results must be checked before reporting success.
- **PENDING** Confirm debug APK and artifact checksums, inspect APK manifest/security/branding after packaging, add approved native source/lockfile to branch, emulator+real-device acceptance, iOS project and native push. Staging CORS and release signing remain unapproved and unchanged.

### CI verification checkpoint — 2026-11-17: Android SDK setup incident
- **PASS:** Customer quality workflow [43935765573](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43935765573) completed successfully at `7f6e0cb`, including customer regression tests, Android hardening tests, web builds and native-mode web bundle.
- **DEBUG APK BUILD BLOCKER FOUND:** Android pipeline run [43935736943](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43935736943) resolved the exact customer lockfile, built native web content, generated branded Android icons, and applied the `android:allowBackup="false"` policy, but failed **before Gradle build**: `android-actions/setup-android@v3` invoked `sdkmanager` for an obsolete package named `tools`.
- **FIX COMMITTED** `11b7a12`: replace that action with direct SDK command-line setup for `platforms;android-36`, `build-tools;36.0.0`, and `platform-tools`, using Java 21. GitHub Actions re-run [43936054973](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43936054973) triggered and native dependency job passed; APK compilation was still pending at first inspection.
- **DO NOT CLAIM APK SUCCESS UNTIL VERIFIED.** An APK generated by `assembleDebug` would be signed only with a debug key, for controlled staging tests; never a published store release or production credential.
- **NOT CHANGED:** Staging deployment, Turso data, customer records, root POS config, and payment configuration.

### Progress checkpoint — 2026-11-17: first verified Android debug APK and static APK verification gate
- **VERIFIED SUCCESS:** GitHub Actions run [43936054973](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43936054973) compiled `apps/customer-web/android/app/build/outputs/apk/debug/app-debug.apk` with Gradle and published `gastrofood-android-debug-apk` artifact `14260742048`, plus native Android source `14260209392` and the isolated native lockfile `14258769972`. Both jobs completed successfully.
- **ARTIFACT INSPECTION:** Downloaded Android APK ZIP, extracted `app-debug.apk` (5,769,420 bytes; SHA-256 `67a7382c429e78dab4d5190f8fac081d03ff60399d253a606cbd23539da97196`). Its archive contains compiled `AndroidManifest.xml`, six DEX files, branded launcher resources, `assets/public/index.html`, a JavaScript bundle with the staging HTTPS API address, and no native-mode `serviceWorker.register` string. It is a test-only debug build, not a released/accepted mobile app.
- **DONE (static APK audit code)** `7870f83`: new read-only `scripts/audit-food-android-apk.py` checks bundled entry HTML, JS, staging API origin, DEX code and generated icon resources; reports SHA-256 and refuses absent/corrupt content.
- **DONE (CI configuration)** `eba9b90`: prior to publishing APK artifacts, workflow now runs Android Build Tools `aapt` and `apksigner` to verify package identity and APK signatures, and the static content audit. These new checks are **pending confirmed green rerun**; debug artifact from prior successful run remains available.
- **REMAINING** Review and commit the generated customer-only dependency lock and Android native project; make Android package install on an emulator, confirm application opens and staging CORS/tenant auth works, verify push/native GPS, build iOS on Mac/Xcode. No live customer data tests without consent.
- **GUARDRAILS** No Render deploy, root POS changes, production signing, database migrations, or Turso data operations.

### Verified checkpoint — 2026-11-17: APK identity, signature and static content gate GREEN
- **VERIFIED PASS:** GitHub Actions [43936956948](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43936956948), commit `eba9b90`: customer native lock candidate resolved; Android debug APK compiled; `aapt` verified package ID; `apksigner` verified package signature; `scripts/audit-food-android-apk.py` verified staging API, React entry, Android DEX and branded icons. Both workflow jobs completed successfully.
- **TEST APK ARTIFACT:** `gastrofood-android-debug-apk`, ID `14261141023`. Downloaded, extracted, and checked ZIP integrity. The contained `app-debug.apk` is 5,769,420 bytes, SHA-256 `a181f853f1b7c167478b14b9cb0aa2e920479740f3ff5843353ff5d714c3c9f0`. GitHub source artifact `14261755785`; customer lockfile artifact `14262065640`.
- **THIS IS NOT DEVICE ACCEPTANCE:** Debug builds are not eligible for release signing/store publication. Staging CORS native origins have not been configured and device network/auth, GPS permission, payment options, maps, offline/resume and rider tracking still require acceptance. Do not treat successful static audits as proof real-phone ordering works.
- **PENDING:** Import reviewed customer lockfile and Android project into existing branch; finish Android simulator + physical-device test; secure native token storage and platform-specific native push; iOS Xcode project and release pipeline.
- **NO DEPLOYMENT:** Render staging auto-deploy remains disabled, no Turso data/tenant change or root POS modification.

### Progress checkpoint — 2026-11-17: promote verified customer lock + clean Android emulator smoke
- **VERIFIED BASELINE** Native APK workflow [43936956948](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43936956948) passed Gradle `assembleDebug`, `aapt` identity, `apksigner` verification and packaged asset/staging-origin audit. Debug APK artifact `14261141023` exists; no live-device acceptance.
- **DONE (CI code)** `89377c1`: after the customer-only lockfile and Android debug build both succeed, a narrowly scoped promotion job checks out `codex/production-readiness`, validates the lockfile and root POS lockfile checksum, and commits **only** `apps/customer-web/package-lock.json` if changed. It has no deployment, signing or database action. Promotion execution/status must be verified before marking the committed lockfile current.
- **DONE (CI code)** `1973953`: a separate clean Android emulator smoke job downloads the debug APK, installs it on an Android API 35 emulator, launches `com.rstechnologies.gastrofood/.MainActivity`, checks the process/activity and uploads a startup screenshot. No test login, order creation, live data writes, notification registration or native CORS modification. The first passing emulator run is pending verification.
- **PENDING** Review signed-off native Android source candidate for commit; confirm updated lockfile promotion; inspect emulator screenshot for visual loading/branding; run broader emulator acceptance against an approved isolated test environment; obtain explicit permission for staging native CORS changes before exercising login/checkout.
- **SAFETY** Root POS configuration, customer Turso records and Render staging deployment remain unchanged; release app signing and iOS generation pending.

### Native source-control completion gate — 2026-11-17
- **VERIFIED in repository:** Customer-only `apps/customer-web/package-lock.json` is now genuinely committed on `codex/production-readiness` by bot commit `2d8306c`. GitHub `fetch_file` confirmed `@capacitor/{core,cli,android,ios}` each resolve to exactly `8.6.2`. This removes the previous stale committed lockfile blocker, with the root POS lock unchanged. The promotion job in run `43938328351` passed.
- **DONE (code)** `5d576ca`: a new `commit-reviewed-android-source` job will only run after both the signed-off native lock and **clean Android emulator launch** succeed. It checks `com.rstechnologies.gastrofood`, `android:allowBackup="false"`, launcher icon, packaged web assets, and refuses local machine files, private Firebase service configs or signing-key files. It stages only `apps/customer-web/android/` on the existing branch; no root POS or deployment touches. This promotion is **configured, not verified** until CI confirms it.
- **ONGOING:** Emulator smoke run `43938501982` passed native dependency and Android source generation; emulator launch was still in progress when inspected. Do not claim emulator acceptance or the Android native source is committed until those steps pass. The smoke does not exercise API login, checkout, GPS, notifications, streaming or third-party stores.
- **REMAINING** Emulator screenshot visual inspection; native-origin CORS and tenant auth on approved staging test account; real-device final testing; iOS Mac/Xcode; release signing deferred.

### Native emulator startup regression — 2026-11-17 (critical, do not release)
- **CONFIRMED BUG despite earlier green smoke:** The screenshot artifact from Android emulator run `43938501982` showed GastroFlow Food's React error boundary **“Something went wrong”** instead of its marketplace. Prior smoke checked only whether the Android process remained running and therefore produced a **false-positive** pass. Do **not** treat this APK as user-ready.
- **REPRODUCED FROM ACTUAL APK JS** locally in a test browser: React reported `TypeError: Cannot read properties of null (reading 'useState')` and `useContext` when rendering components. The native CI installs both root and customer `node_modules`; customer imports `../../../shared`, which can cause duplicate React instances.
- **DONE (fix code)** `81388de`: `apps/customer-web/vite.config.js` now uses `resolve.dedupe` for `react`, `react-dom` and JSX runtimes so shared UI and customer app use the same React instance.
- **DONE (regression tests)** `c654e8c`, `b89607c`: customer quality workflow asserts deduplication and retains the hosted `/customer/` base. The customer quality workflow passed, but **Android emulator rerun is still required** to validate the native bundle.
- **DONE (diagnostic + test gate)** `67016d0`, `0478445`: native error boundary logs a restricted diagnostic reason without exposing customer tokens or data; `63eb0d9`, `8d86fe2`: emulator tests inspect the real WebView via DevTools and fail if React's startup error boundary appears rather than the marketplace. CI uploads emulator screenshot and browser console evidence. Android source promotion is gated on this **real UI** check, not just process liveness.
- **DONE (build resilience)** `37d1182`: Gradle dependency caching and bounded retry for transient Maven Central HTTP 429 encountered in an earlier run. `5d50a00` makes customer source, shared UI, and Vite config changes trigger native APK rebuilds.
- **PENDING (no claims of fix accepted)** New APK compile, WebView DOM acceptance and screenshot inspection. Source promotion must not proceed without clean visual startup. No staging CORS or Turso changes were made.

### Visual startup correction — 2026-11-17: React fix confirmed; native network pending
- **PACKAGED BUNDLE ACTUALLY REPRODUCED:** The original debug APK JavaScript was loaded in an isolated browser, producing React `TypeError: Cannot read properties of null (reading 'useState')` and `useContext`. The rebuilt APK from [GitHub Actions 43940914427](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43940914427) was extracted and tested identically; it **rendered the marketplace and GastroMate**, with no React hook errors after the Vite React singleton fix.
- **EMULATOR SCREENSHOT INSPECTED:** The new Android emulator startup screenshot artifact `14263420132` showed GastroFlow branding, the marketplace hero, search, and navigation instead of the error boundary. It also displayed **“Connection timeout or network error”** because the native API-origin CORS/device connectivity gate remains unverified. Do not claim restaurant list/checkout work yet.
- **CI HARNESS FAILURE, NOT APP CRASH:** The emulator script in run `43940914427` passed `adb shell pidof` and `dumpsys` showing active `com.rstechnologies.gastrofood` process. But it assigned the PID on one script line and used it on the next; `reactivecircus/android-emulator-runner` executes each line in a new shell, so the PID variable was lost. `9eadc30` keeps the PID lookup inside one `adb forward` shell command. A fresh WebView DevTools DOM acceptance run is pending.
- **SAFETY:** Android source GitHub commit is still gated on passing WebView DOM acceptance; native staging CORS environment and Render deployment remain unchanged, and no real customer or Turso data operations took place.

### Native phone-screen corrections — 2026-11-17
- **CONFIRMED SCREENSHOT ISSUE:** Even after the React startup fix, the Android emulator screenshot at `43940914427` showed bottom navigation shifted to the right (only some tabs visible). Root cause: `apps/customer-web/src/premium-motion.css` had a blanket `transform:none!important` under `prefers-reduced-motion:reduce`. The emulator's disable-animations option enables this preference, removing the fixed bottom bar's `translateX(-50%)` centering.
- **DONE (code)** `bd446f8`: removed blanket transform suppression from reduced-motion CSS, while retaining disabled animations, transitions and smooth scrolling. This preserves layout-critical transforms for users with reduced motion accessibility preferences.
- **CONFIRMED SEARCH ISSUE:** The customer marketplace `sr-only` search label appeared as visible text next to the input, consuming mobile width and clipping its placeholder.
- **DONE (code)** `f32a10f`: scoped visually-hidden, screen-reader-accessible marketplace search label styling. `0db5ce9`, `64f2057`: added regression tests for navigation transforms and hidden search label; customer quality workflow `43942609336` passed.
- **DONE (CI workflow)** `7496e7c`: native build workflow now uses per-branch concurrency cancellation to avoid overlapping Android/Gradle builds and excessive Maven Central requests. New Android screenshot acceptance remains pending.
- **TEST HARNESS CORRECTION:** `9eadc30`: Android emulator runner shell PID used in the same command instead of between isolated commands. Prior smoke failure after successful native render was a **harness variable-scope error**, not a React regression. A fresh WebView DevTools check must confirm the rendered marketplace.
- **PENDING:** Android emulator UI recheck after these CSS changes; native CORS/guest restaurant data; all signed release/device tests.

### Native Android source committed; idempotent CI fix — 2026-11-17
- **VERIFIED** A prior clean-process Android emulator run plus the source-promotion job produced commit `c788fc5`, which added generated GastroFlow Food Android source to `apps/customer-web/android/` on `codex/production-readiness`. GitHub source inspection confirmed the expected package `com.rstechnologies.gastrofood`, foreground coarse/fine location permissions, `android:allowBackup="false"`, and private file exclusions in `android/.gitignore`. The root POS project was not changed.
- **NON-DESTRUCTIVE CI FIX** `5ea9f54`: once the customer Android folder is committed, `cap add android` fails with "android platform already exists". Native workflow now checks that the already-committed project has the correct GastroFlow Food application ID and runs the regular `cap sync android` step rather than deleting/recreating the native project; `cap add` is reserved for a missing customer Android source folder.
- **PACKAGED WEB UI VISUAL ACCEPTANCE** Android screenshot from run `43940914427` confirmed React render/marketplace/GastroMate work after `resolve.dedupe`. Screenshot also showed centered navigation was broken by blanket reduced-motion transform reset, and input placeholder was clipped by visible `sr-only` label. `bd446f8` and `f32a10f` correct those two issues; updated emulator visual verification remains pending.
- **REMAINING** Verify latest Android build and revised WebView DevTools smoke test after `5ea9f54`; no approved native staging CORS, live restaurant fetch, checkout, user account tests, iOS Xcode or final phone acceptance yet.

### Progress checkpoint — 2026-11-17: Native staging API preflight investigation and safe public-discovery optimization
- **VERIFIED UI:** GitHub native workflow [43943011734](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43943011734) passed all five jobs, including actual Android emulator WebView render acceptance and isolated native source promotion. Inspected emulator screenshot `14265225295`: React customer marketplace loads with all five navigation tabs visible and search field fitted; no error boundary. **Restaurant data loading remains blocked** by native network access, not an accepted checkout flow.
- **VERIFIED STAGING PROBE:** Native CORS diagnostic job in [43949780048](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43949780048) sent read-only `OPTIONS` requests to `/api/public/restaurants` for `https://localhost` (Android) and `capacitor://localhost` (iOS). Both returned **HTTP 401**. This can indicate that an unallowlisted CORS preflight fell through to server authentication, or a distinct upstream access gate. It is **not** evidence that a customer's credentials were invalid. No Render environment or deployment was changed.
- **DONE (code)** `25faac5`: anonymous GET `/api/public/restaurants` no longer sends gratuitous JSON `Content-Type` or `X-Tenant-Id` request headers. This avoids an unnecessary preflight for global discovery; restaurant-specific menus and all write requests still retain tenant scope and JSON request headers. This does **not** override a denied CORS policy on the actual GET response.
- **DONE (code and tests)** `ee6ddcd`, `e134067`: regression tests cover public discovery's simple GET, tenant-specific menu, and scoped POST behavior. `5647ebf`, `87beace`: the read-only OPTIONS probe now classifies ambiguous 401/403 responses as `preflight-rejected-or-auth-gate`, distinguishing explicit `WWW-Authenticate` challenges; tests cover those cases.
- **VERIFIED TEST GATE:** Customer quality workflow [43950660385](https://github.com/Rashid-RG/restaurant-pos/actions/runs/43950660385) passed with all new native connectivity regressions. This is a CI source/build result, not a verified running staging native API connection.
- **BLOCKED / requires explicit authorization:** Configure the exact native WebView origins (`CUSTOMER_NATIVE_ORIGINS=https://localhost,capacitor://localhost`, or only approved device platform origins) on `gastroflow-staging` after a reviewed staging deployment that includes the backend opt-in. A configuration/restart or deploy may interrupt the live staging POS, so **do not change staging without the user's approval**. After approval, re-run the OPTIONS probe in strict mode and verify anonymous listing, tenant-specific menu isolation, customer OTP/login, private order tracking, and checkout using test tenants; no live-customer orders.
- **NO DATA CHANGES:** No Turso writes, migrations, customer account actions or deployment occurred in this development pass. Root POS and existing browser ordering remain unchanged in current staging deployment.

### Progress checkpoint — 2026-11-17: Native shell update and driver portal isolation
- **CHECKPOINT:** GitHub branch `codex/production-readiness` contains a verified customer Android project and independently built Android debug APK. Latest remote staging Render service retains `autoDeploy=no`; no release or deployment was performed during this pass.
- **DONE** `83e73cf`, `b147271`: `SystemUpdatePrompt` now guards the hosted service-worker/version polling and the update banner when `MODE=native`. Packaged native apps must update through platform app releases rather than polling relative `https://localhost/api/system/version`, while the browser PWA maintains its former update behavior.
- **DONE** `969e09c`, `b5c62f8`: customer-native builds hide the driver portal shortcut to prevent navigating to nonexistent packaged `/driver-app`. The hosted web app retains the existing driver shortcut and its URL. Driver app login remains a separate application.
- **DONE** `55d4c27`, `55ed18b`: regression tests for native vs web update/driver UI contracts are added to the customer staging quality CI.
- **PENDING:** Reconfirm a green CI run on the latest change. Backend staging native origins remain explicitly unconfigured and read-only cross-origin probes produced HTTP 401. Do not claim native restaurant lists, OTP/login, orders or tracking are connected until exact origin authorization and real-device acceptance succeed on approved test accounts.
- **GUARDRAILS:** No deploy, Render variable change, Turso migration, POS billing change, customer data operation, or Android release signing.

### Progress checkpoint — 2026-11-17: Native payment gateway callback safety
- **DISCOVERED** `apps/customer-web/src/views/CartCheckoutView.jsx` still constructed PayHere `return_url`, `cancel_url`, and fallback redirect URLs using `window.location.origin`. In an installed Android/iPhone app, the WebView origin can be `https://localhost` / `capacitor://localhost`, which is unsuitable for gateway redirects or payment notification endpoints.
- **DONE (native-only fail-closed code)** `ad26af0`, `00ffa3c`: `canUseHostedPayHereGateway(mode)` and `payHerePaymentDisabled(mode,enabled)` keep the browser/website PayHere flow unchanged, but disable PayHere radio selections inside `MODE=native`. The checkout submit guard runs **before** the new order/OTP flow, and fallback gateway form submission also refuses native mode. A second guard protects the later hosted gateway initiation block. Cash and manual bank transfer retain existing behavior.
- **DONE (regression tests + CI)** `712c974`, `8535ed5`: native payment safety tests cover hosted browser compatibility, native blocked state even when the backend says PayHere enabled, and both the submit and redirect guards. Added to the customer quality gate. A green quality run for `00ffa3c` was observed; the latest `8535ed5` run still requires final verification.
- **BLOCKER FOR NATIVE CARD PAYMENTS** Build an explicit mobile-safe payment session with verified HTTPS return URLs or supported native SDK, server-to-server payment confirmation and idempotent status recovery before enabling native PayHere. Do not point payment callbacks to local WebView origins. Never assume a browser completion callback proves payment.
- **SAFETY** No Render deployment, Turso write, POS checkout change or production payment switch was performed. Deployed web customer ordering app continues unchanged pending any approved deployment.

### Progress checkpoint — 2026-11-17: private order refresh on resume; opt-in iOS simulator CI
- **DONE (native-only feature)** `bd83ca4`, `9cec70c`: when a packaged Android/iOS customer app returns to foreground or reconnects, active, nonterminal private tracking calls the authoritative order snapshot immediately. No synthetic order/rider status; invisible/offline pages skip refresh and rapid focus/online/visibility events are throttled. The existing hosted browser SSE and web push behavior remain unchanged. The existing snapshot gate ensures one in-flight request per tracked order and protects tenant/order changes.
- **VERIFIED TESTS** `5b9936f`, `7542782`: native-resume privacy, terminal-state, throttling, listener cleanup and hosted-SSE isolation tests were added to the customer quality gate. GitHub Actions [44053428387](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44053428387) completed **successfully**. This is not a device acceptance test.
- **DONE (manually triggered iOS CI definition)** `74acf51`: new `.github/workflows/food-native-ios-simulator.yml` with `workflow_dispatch` only. A macOS 26/Xcode 26+ runner can build a customer-only unsigned iOS Simulator Debug `.app`, verify bundle ID, verify foreground location purpose and upload iOS source/simulator artifacts. No Apple signing, IPA, TestFlight, source commit, backend deployment, or Turso access.
- **DONE (guide)** `1eb9057`: updated setup guide to reflect resolved committed Capacitor lock, verified Android debug builds and separately gated iOS workflow.
- **UNVERIFIED** iOS CI has not been dispatched; native iPhone project, simulator app, icons/splash, iOS push and real iPhone GPS are **not** yet accepted. macOS GitHub Actions minutes may have a cost, so the workflow is manual-only.
- **REMAINING PRIORITY** Native staging CORS and API connectivity under explicit approval; tenant-safe real login/OTP and checkout; Android foreground location and tracking tests on real phones; native FCM/APNs with consent; iOS simulator and real-phone acceptance. Existing staging POS and web ordering remain untouched.

### Checkpoint — 2026-11-17: approved iPhone icon and splash generation, verified without macOS
- **DONE source** `f3f055e`: an isolated Python/Pillow generator uses the existing approved `apps/customer-web/public/food-logo.png` (512×512) to create an **opaque 1024×1024 iOS app icon** and matching iOS splash images in the generated customer Xcode asset catalog. It checks customer project identity, refuses traversal filenames, preserves the generated Xcode `Contents.json` schemas, and does not edit the POS, sign, or deploy.
- **DONE manual iPhone CI definition** `515643c`, `a278171`: after generating the iOS project on `macos-26`, install the pinned Pillow dependency, test the generator, brand the customer Xcode assets, then validate icon/splash opacity and dimensions before attempting the unsigned Simulator Debug Xcode build. The macOS workflow remains `workflow_dispatch` only; it has not been executed.
- **DONE tests** `8df8b5b`, `72c92b3`: Python unit tests construct synthetic Xcode asset catalogs, assert icon dimensions and opacity, ensure splash dimensions and catalog preservation, and refuse incorrect roots or unsafe paths. **VERIFIED PASS:** [Linux GitHub Actions 44054527118](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44054527118), which does not consume macOS runner minutes.
- **REMAINING** Actual Xcode iPhone simulator source/build and screenshots, app icon device visual inspection, iOS push/OTP/native GPS testing, server-side staging native CORS approval and secure end-to-end checkout acceptance. No production release or Turso data change.

### Verified native CORS diagnosis — 2026-11-17: actual public GET vs private preflight
- **DONE (read-only diagnostic code)** `8fc924d`: `scripts/probe-food-native-cors.mjs` now checks **both** the private cross-origin `OPTIONS` request and the anonymous `GET /api/public/restaurants` that the packaged customer app actually makes. The GET uses an exact device `Origin`, `credentials=omit`, no token or tenant headers, and never logs or parses returned restaurant/customer data. Disallowed or wildcard response headers fail closed.
- **DONE (tests)** `7d7e93a`: regression coverage for Android and iOS simple GET, missing/wildcard CORS headers, refusal to probe production, and no-credential/no-response-body access. **VERIFIED GREEN** customer quality workflow [44055113519](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44055113519).
- **LIVE STAGING READ-ONLY OBSERVATION** GitHub diagnostic job in [44055068503](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44055068503):
  - `https://localhost` Android-origin `OPTIONS`: HTTP **401**, `preflight-rejected-or-auth-gate`.
  - `capacitor://localhost` iPhone-origin `OPTIONS`: HTTP **401**, same classification.
  - `https://localhost` Android-origin anonymous `GET`: HTTP **200** but **no matching Access-Control-Allow-Origin**, `discovery-get-origin-not-authorized`.
  - `capacitor://localhost` iPhone-origin anonymous `GET`: HTTP **200** but **no matching Access-Control-Allow-Origin**, same classification.
- **CONCLUSION** The public discovery route responds but **the deployed staging backend does not authorize the native WebView origins**. Successful HTTP 200 is not sufficient: browser/WebView CORS still blocks access. The 401 preflight alone does not prove customer login failure. Existing browser and POS traffic are unaffected by this read-only diagnostic.
- **CONTROLLED ROLLOUT REQUIRED, NOT PERFORMED** Obtain explicit approval to (a) deploy reviewed native CORS backend changes **only to staging** and (b) add the exact `CUSTOMER_NATIVE_ORIGINS=https://localhost,capacitor://localhost` option there. Do not wildcard CORS, replace `CORS_ORIGIN`, allow arbitrary origins, bypass tenant/order authentication, or enable native origins on production by accident. Before any change, verify staging branch, root POS and deployed build identity, and plan the restart/rollback.
- **AFTER APPROVAL acceptance gates** Re-run `node scripts/probe-food-native-cors.mjs --require-allowed` and check both GET+OPTIONS. Then on isolated test tenants verify that restaurant listing works, selected-restaurant menu remains tenant-specific, OTP/customer authentication and logout remain isolated, private tracking cannot be read across tenants, and checkout idempotency prevents duplicates. Use no real customer orders or payments. Only mark native API accepted after test phones/emulators succeed.
- **SAFETY** No Render deployment, env var modification, POS billing changes, Turso migrations, or live data writes occurred during this checkpoint.

### Checkpoint — 2026-11-17: customer login and multi-restaurant session isolation
- **CONFIRMED CODE RISK** `apiFetch` formerly cleared the current restaurant's customer token after a 401/403 containing any token-related error, including an **invalid order-tracking access token** on a public order route. Tracking requests can carry both `X-Order-Tracking` and customer bearer credentials, so simply checking the bearer header is insufficient.
- **DONE source** `2b8af34`, `5921a45`, `f6275c6`, `22e7adb`: customer-token invalidation now requires a 401/403 with an explicit credential-revocation message, an outbound bearer matching the stored customer token, **and** a customer account API namespace (`/api/customer/`). Public order tracking or driver route errors cannot clear the customer session. It snapshots request headers and the tenant-specific localStorage key before sending the request, preventing a late response from removing a newly selected restaurant's token.
- **DONE tests** `f7ba6f5`, `24d59b2`, `3908521`: tests verify public tracking expiry leaves customer login intact even with both tracking/bearer headers, genuine customer authorization rejection clears only the appropriate session, and an old tenant's late error cannot clear a new tenant's session. **VERIFIED GREEN** [customer quality 44056111258](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44056111258).
- **ADDITIONAL ASYNC AUTH FIX** `21f86e9`, `aebd2e3`, `b507667`: the customer auth provider now captures its tenant-specific storage key at mount, guards late restore/profile/login/OTP callbacks against unmount, restaurant change and logout via an in-memory epoch, and ensures an old restore cannot override a newly completed login. Existing stored token key format is unchanged.
- **ADDITIONAL TESTS** `0c835a0`, `5be4fe5`: customer auth lifecycle checks cover tenant selection, logout generation, listener/callback guards, and backward-compatible storage keys. Their final quality run was **pending** at this documentation checkpoint; do not infer pass from earlier green runs.
- **NO DEPLOYMENT** Code changes were limited to `apps/customer-web`, isolated tests and customer quality workflow; root POS and deployed staging retain previous behavior. No Render origin changes, Turso writes, checkout/payment or test order actions were performed.

### Checkpoint — 2026-11-17: bounded native marketplace requests and stale-request cancellation
- **DISCOVERED** The customer marketplace's initial `apiFetch('/public/restaurants')` had no abort signal even though menu lookups had a controller. Slow/sleeping Render or a stale native WebView could leave discovery pending until the network failed, including after changing screens.
- **DONE (native-only request policy)** `7ee55c5`, `b6672a2`: `marketplaceReadSignal` enforces a 15-second timeout on **read-only** Android/iPhone marketplace restaurant discovery and per-restaurant menu lookups; combines the timeout with the existing screen-unmount abort signal using `AbortSignal.any`. The existing hosted browser signal and request behavior are unchanged. No retry, forced order creation or checkout write was added.
- **DONE (tests and CI)** `334863d`, `07a9532`: regression tests cover web behavior preservation, native bounded deadlines, explicit navigation/unmount cancellation, timeout range validation, and both actual marketplace callsites. **VERIFIED GREEN** [customer quality run 44057039287](https://github.com/Rashid-RG/restaurant-pos/actions/runs/44057039287), including customer app builds.
- **ACCEPTANCE LIMIT** A successful native UI build does not mean the installed app can fetch restaurants; staging's exact native CORS origins are still denied. This change only improves native read timeout/resilience **once** secure staging-origin access is authorized and deployed. Do not claim GPS or checkout acceptance.
- **SAFETY** No Render environment changes or deployment; no Turso writes, migrations, production payment changes, root POS changes, live customer test orders or customer credential use.
