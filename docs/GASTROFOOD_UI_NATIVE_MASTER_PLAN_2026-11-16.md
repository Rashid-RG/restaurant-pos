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
| Unified design tokens and all-screen redesign | NOT STARTED | Existing layered CSS | Screen-by-screen implementation and visual snapshots |
| Dedicated GastroFood Android build | NOT STARTED | Shared root Capacitor config is not release-ready | Isolated appId/config/assets |
| Dedicated GastroFood iOS build | NOT STARTED | Shared root Capacitor config is not release-ready | Isolated bundle ID, native build/TestFlight |
| Background GPS driver app acceptance | NOT TESTED | Existing driver/web foundation | Real-device battery/background tests |
| Render staging deployment of this phase | NOT DEPLOYED | Auto-deploy disabled for staging | Explicit approval and verified build |

**Change policy:** these code commits do not modify DB schema, Turso customer/sales records, POS billing or pricing logic; staging remains unchanged until separately authorized.


### Progress checkpoint — 2026-11-16: map-first tracking UI
- **DONE (code)** `977b20e`: display existing authorized delivery map ahead of hero status for active delivery orders with destination coordinates; preserve the existing real route, server-backed ETA and rider GPS freshness semantics.
- **DONE (code)** `c713d9a`: responsive map surface, heading, ETA chip, GPS freshness display, explicit straight-line fallback, and mobile-friendly sizing.
- **NOT YET DONE:** verify CI/build and phone screenshots, compare against approved mockup (bottom-sheet, route contacts, typography), check feature with active order and stale fix. No claim of native release or deployment.
