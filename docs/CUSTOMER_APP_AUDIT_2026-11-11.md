# GastroFlow Customer Online App — Feature & UX Audit
**Reviewed:** 2026-11-11  
**Branch:** `codex/production-readiness`  
**Method:** Static inspection of React customer app, shared Express routes and billing, service worker, current review docs and previously successful CI. Attempted public fetch of the live `/customer/` route; browser/content inspection was unavailable, so **this document is not an interactive browser walkthrough or a verified live checkout**.

> **Implementation follow-up (11 November 2026):** The branch now contains fixes for tenant-scoped customer carts and authentication, server-validated promotion previews, a mobile UI polish pass and safer Sri Lankan payment choices. Cash and manual bank transfer are selectable; PayHere/card and LankaQR are shown as unavailable by default. Card details are no longer requested in the customer profile. Bank-transfer orders remain unpaid until an authorized restaurant manager confirms the actual bank receipt in the existing manual-payments ledger. The backend feature switch `CUSTOMER_CARD_PAYMENTS_ENABLED=true` may be used only after merchant integration is independently verified, and `PAYHERE_ENABLED` must not be false. Automated code/test/build/smoke workflow **43016365154 passed**. This improves the source but **does not constitute live payment-provider, delivery-device, accessibility, or capacity certification**. No Render deployment or live data migration was made as part of this follow-up.

## Verdict
**Partially complete, not launch-certified.** A real customer-ordering workflow exists, including restaurant discovery, menu, cart, ordering, tracking, accounts and support. Important UX/business integrations are incomplete or misleading, including tenant-scoped cart state, saved cards, promotion validation and scheduled-order capacity enforcement. Passing source/tests/builds is not proof that PayHere, SMS, push, delivery GPS and real devices work in production.

## Customer journey inventory

| Step / feature | Code evidence | Assessment | Remaining test/work |
| --- | --- | --- | --- |
| PWA shell/install/offline | `src/main.jsx`, `public/sw.js`, `SystemUpdatePrompt.jsx` | **Partial** | Offline shell only, not offline ordering; exercise SW updates/caching and Android/iOS install |
| Choose restaurant | `views/RestaurantsView.jsx` queries `/public/restaurants`, supports GPS/proximity/cuisine/search | **Implemented; not end-to-end verified** | Verify real tenant listing, filters, open status, unknown location, map accessibility |
| Multi-restaurant cart | `context/CartContext.jsx` stores all carts under `gastroflow_cart_items` | **Needs fix** | Scope by active tenant and reset/remount cart/rates when switching restaurant. Avoid mixing one restaurant's items into another's checkout |
| Menu browse/search/filter | `views/MenuView.jsx` | **Implemented; test required** | Sold-out updates, empty images, accessible filter controls, slow connection |
| Favorites/reorder | `MenuView.jsx`, `ProfileView.jsx` | **Partial** | Favorites use local storage; validate per-tenant/account syncing and reordered item availability |
| Modifiers/notes/quantities | `MenuView.jsx`, `CartContext.jsx`, server pricing | **Implemented; test required** | Validate modifier limits, unavailable options, allergen disclosures, recalculated totals |
| Group ordering | `MenuView.jsx` group-cart flows | **Partial** | Test host/member permissions, expiry, delivery checkout, multi-device concurrency |
| Delivery/takeaway/dine-in checkout | `CartCheckoutView.jsx`, `/public/orders`, QR table binding | **Implemented; integration pending** | Real customer phone and location, delivery fee, restaurant capacity and device checkout |
| Scheduled ordering | UI generates 15-minute slots and sends `scheduledTime`; server stores value | **Partial** | Enforce valid future slots/opening hours, order capacity, kitchen release timing and timezone; no complete slot reservation/capacity acceptance was verified |
| Discounts and promo codes | Checkout UI hardcodes `WELCOME10` and `FLAT200` with its own thresholds; `lib/billing.js` validates DB tenant promotions | **Needs fix** | Drive promo validation and preview from server. UI `WELCOME10` requires Rs 1,000 while older seed defaults show Rs 500; may show incorrect customer totals |
| Loyalty and tips | Checkout and authoritative billing | **Implemented; integration pending** | Confirm points redemption, rounding, tax and charges match server receipt for every scenario |
| Cash / PayHere | `CartCheckoutView.jsx`, guarded payment endpoints | **Partial** | Real PayHere callbacks, failure/retry, duplicate charge prevention, merchant account and device acceptance |
| Pending checkout recovery | `utils/checkout-recovery.js` with session storage + idempotency key | **Implemented; needs failure testing** | Lost response, browser refresh, offline retry, cart edits, stale pending intent |
| Track order / ETA / driver | `OrderTrackingView.jsx`, `TrackingMap.jsx`, SSE/polling | **Partial** | Authenticate guest tracking across reload, real driver GPS/background behavior, stale signal, push permissions, offsite delivery |
| Cancel / feedback / driver chat | `OrderTrackingView.jsx` | **Implemented; needs real workflow testing** | Eligibility, refunds, staff/driver visibility, customer errors |
| Account/register/reset | `LoginRegisterView.jsx`, `CustomerAuthContext.jsx` | **Implemented; external delivery pending** | Real SMS/email OTP, reset, auth session expiry, rate-limit, protected account details |
| Addresses/profile/history | `ProfileView.jsx` | **Implemented; test required** | Tenant scope, deletion/account lifecycle, address accuracy, reorder unavailable items |
| Saved payment cards | `ProfileView.jsx` creates fake `tok_${Date.now()}` and accepts entered card digits; backend saves token metadata | **Not a real saved-payment feature** | Remove misleading card-number UI or replace with PCI-compliant provider tokenization; never claim raw card storage/use is approved |
| Support/AI | `SupportView.jsx`, `GastroAiConcierge.jsx` | **Partial** | Verify support ticket OTP/provider, useful AI accuracy, accessibility, fallbacks |
| Language | English, Sinhala, Tamil dictionaries with English fallback | **Partial** | Audit untranslated hardcoded labels, mixed locale dates/currency, accessibility |
| Legal/policies | `LegalPoliciesView.jsx` | **Draft content** | Legal review of merchant-specific refund/privacy/legal terms |
| Error UX | `App.jsx` has error boundary rendering error message and stack to customer | **Needs fix** | Customer-friendly recovery screen, report errors privately, don't show internal stack traces |

## Most urgent changes, in order

1. **Tenant-safe cart/account switching:** isolate local cart, favorites, rates, table binding, checkout state and profile per restaurant; clear or safely preserve each restaurant's cart; test switch A→B→A.
2. **Checkout correctness:** replace hardcoded promotions with an authenticated/public validation endpoint that uses the server's actual tenant-scoped promotion rules. Preflight server totals and show any changes before charge; validate scheduling and capacity.
3. **Payment safety:** remove faux saved-card registration, integrate only real provider tokenization if supported. Run real sandbox PayHere approved/failure/timeout/retry paths, verify tracking access and webhook settlement.
4. **Mobile design modernization:** make the primary journey simple: discover → browse/search → item sheet → cart → 3-step checkout → tracking. Prefer one consistent brand palette, dynamic tenant branding, large accessible touch targets, item images with graceful placeholders, skeleton states, sticky cart, transparent prices and compact bottom navigation. Replace emoji-only controls and dense inline style overrides with semantic components.
5. **Notifications/offline:** distinguish shell caching from offline order submission; prevent duplicated orders; show connection state, explicit retry and order updates without misleading push claims.
6. **Privacy/accessibility:** review account deletion/data requests, safe auth session storage, disabled/error states, keyboard controls, screen-reader names, reduced motion, and stack trace handling.
7. **Real acceptance:** real phone on mobile data and Wi-Fi, 2+ restaurants, QR dining, guest/account orders, mix of cash and PayHere sandbox, refunds, chef/driver handoff, live location and disconnected retry.

## Modern design direction

Use a **consistent warm, premium dining identity** across restaurant discovery and the selected restaurant menu, while allowing tenant logo/accent overrides. The current CSS has both orange foundational branding (`src/index.css`) and green overrides (`src/modern.css`), which may create inconsistent components. Consolidate into design tokens and reusable responsive components. Build:

- Restaurant discovery: prominent location selector, functional nearby/open filters, transparent delivery estimate/fee, trustworthy store status.
- Restaurant home: branded header, opening status, category rail, search and rich menu cards with real image fallback and dietary badges.
- Item customizer: bottom sheet on mobile, modifier constraints and visible allergen warning; unambiguous add button with calculated price.
- Cart/checkout: persistent item summary, clear step labels and final **server-confirmed** tax/discount/delivery fee; payment options only when configured.
- Tracking: progress steps, reliable order detail, estimated time with confidence, driver location age, help and cancel eligibility.
- Account: verified profile, order history, reorder with sold-out checks, addresses, privacy settings and only provider-issued saved payment methods.

## Evidence and limitations

Reviewed customer view modules, Cart/Auth/Language providers, live-store/SSE usage, store and billing routes, PWA service worker, current styling and previous audit reports. **No live purchase, API mutation, user account creation, payment, browser automation or Render deployment was performed.** Public live route fetching via the available web reader was not accessible; no visual device screenshots were captured. Source classification is **not a claim of product certification**.

See also [commercial feature scope](COMMERCIAL_FEATURE_SCOPE.md), [comprehensive review](COMPREHENSIVE_REVIEW_2026-11-05.md), and [SaaS release gates](SAAS_RELEASE_GATES.md).
