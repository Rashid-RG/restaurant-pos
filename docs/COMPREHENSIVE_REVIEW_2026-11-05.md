# GastroFlow Complete System Review

Prepared for Mohammed Rashid • 5 November 2026

Local validation: 131 passing automated tests. See the evidence and limitations below.

## 01 The decision before launch

GastroFlow has a substantial foundation for a restaurant platform: a staff POS and kitchen workspace, customer ordering app, driver app, and shared API. The main need is consistent end to end behavior across those systems. A button, database table or helper module alone does not establish that a feature works in real restaurant service.

The recommended next release is a controlled pilot with a small number of stores, explicit acceptance tests and durable storage. The application should not yet be described as completely production ready. The draft improvements in this review pass local checks, while cloud database behavior, live payments, notification delivery, printer connectivity and several workflows remain launch gates.

The system is still under development, as confirmed by Mohammed Rashid. This report therefore describes development capability and release readiness; it makes no claim about existing restaurant adoption, real payment processing or operational service levels.

| Decision | Recommendation |
| --- | --- |
| Immediate focus | Finish secure payment, inventory and fulfilment workflows before expanding the feature catalogue. |
| Product direction | One coherent experience for staff, customers and drivers, with a shared event and state model. |
| Free hosting | Use a free service for development or demonstration with an external durable database. Accept cold starts and quotas. |
| Live restaurant service | Require reliable availability, recovery, hardware verification and a monitored pilot. |
| Code release | Keep the reviewed draft separate from the live deployment until environment and data migration checks pass. |

## 02 Scope evidence and confidence

Repository reviewed: Rashid-RG/restaurant-pos. The published source base for this work is commit 8042bd7a62a59588ad31b08ba2c45468f46b7e34. The local implementation branch is codex/production-readiness. Draft changes described here were prepared during this session and are not evidence that the public Render deployment has changed.

Review methods include source inspection of the shared backend, business helpers, all three app entry points and major screens; endpoint and schema enumeration; automated tests; production-process smoke tests; desktop and phone browser interactions; dependency audits; and authenticated Render service metadata. A complete formal security audit, accessibility certification, hardware lab test and cloud load test were outside the evidence gathered.

| Label | Meaning |
| --- | --- |
| Existing | A capability is visible in source code. It has not necessarily been exercised end to end. |
| Draft checked | A local draft change was reviewed and relevant local checks were performed. The validation section states the actual checks. |
| Partial | A UI, module, adapter or endpoint exists, but an essential part of the workflow is missing, inconsistent or unverified. |
| External setup | Completion depends on provider credentials, hardware, browser permissions or device capabilities. |
| Proposed | A recommended addition that this review did not establish as implemented. |

The checklist contains 249 review items: 126 Existing, 51 Draft checked, 35 Partial, 12 External setup and 25 Proposed. These are review categories, not a completion percentage. The endpoint scanner found 169 literal route registrations representing 154 distinct method and path combinations, with 13 combinations registered more than once. Generated paths, middleware and unreachable duplicate handlers require additional interpretation.

Source references in the inventory identify the main implementation files. The accompanying API inventory gives line locations in the reviewed draft. Line numbers can move after edits. Historical readiness reports in the repository contain conflicting claims and should not override current code and test evidence.

## 03 How the three systems fit together

The staff workspace is served at /. It supports the counter, kitchen, dining room, stock, customers, dispatch and administration. The customer application is served at /customer/ and covers store selection, menu, cart, checkout, tracking, account and support. The driver application is served at /driver-app/ and covers onboarding, assignments, navigation, GPS and delivery actions. All three use the same Express API and database.

| Layer | Current role | Required direction |
| --- | --- | --- |
| Staff app | React workspace with POS kitchen tables reporting and settings | Permission based navigation, fast repeat actions and visible synchronization state |
| Customer app | React ordering and tracking experience | Accurate quotes, accessible checkout and a clear recovery path |
| Driver app | React mobile delivery interface | Reliable assignment, location freshness, persisted proof and cash handover |
| Shared backend | Large Express module with business helpers and API routes | Domain services, versioned contracts, explicit authorization and one source of business rules |
| Storage | SQLite path, partial PostgreSQL path, draft libSQL adapter | Durability first, tested transactions, versioned migrations and restore drills |
| Live updates | Several SSE channels plus polling and browser GPS | Tenant and participant authorization, replay, ordering, visibility and reconnect recovery |

Use the shared order ID to connect views, but do not let it substitute for authorization. A staff member belongs to a restaurant; a driver must be assigned to the delivery; a customer must own the order or hold an explicit tracking capability. Platform administration must remain distinct from owning a restaurant.

## 04 State model for orders payments and deliveries

Payment success, kitchen completion and delivery completion are separate facts. An online card payment can succeed while the meal is still waiting for acceptance. A driver can deliver an order that was prepaid, or collect cash at the door. Reports should count settled money independently of kitchen or driver progress.

| Domain | Suggested states | Critical invariant |
| --- | --- | --- |
| Order fulfilment | Submitted accepted preparing ready handed over completed cancelled rejected | Only allowed transitions apply, with actor time reason and order version |
| Payment attempt | Created pending confirmed failed expired refunded partially refunded | Only verified provider or authorized cash settlement can confirm payment |
| Delivery assignment | Unassigned offered claimed accepted picked up en route arrived delivered failed returned | Only the assigned authorized driver or dispatcher can change its state |
| Cash custody | Expected collected pending handover handed over discrepancy resolved | Driver and manager actions create an auditable chain |
| Inventory reservation | Reserved consumed released adjusted | Cancellation modification retry and refund cannot deduct or restore twice |

The draft introduces a separate paymentStatus and preserves fulfilment progress after an online payment. The remaining work is to apply the contract to every report, refund, cancellation, legacy record, dispatch path and screen. Use immutable payment attempts and inventory movements to avoid reconstructing financial truth from the latest order status.

Every mutation should carry an idempotency key and expected version. If a cashier and kitchen user edit the same order, return a clear conflict response and the latest state instead of silently overwriting. Financial records need rate and fee snapshots so later changes to a menu or tax setting do not alter earlier invoices.

## 05 Real time updates and tracking review

Real time is a property of the whole workflow, not the presence of an EventSource object. An event must be authorized, committed, delivered or replayed, applied in the correct order, and reflected consistently on all relevant screens. Polling may serve as a fallback, but unnecessary parallel polling adds database load and can exhaust a free tier.

| Update | Observed implementation | Gap or next step |
| --- | --- | --- |
| New customer order to staff | Tenant tagged POS SSE and periodic refresh | Persist an outbox event in the order transaction and replay missed events |
| Kitchen status to customer | Order SSE and five second status polling | Use a shared monotonic order version and stop redundant polling while stream is healthy |
| Menu price availability and store status | Store SSE plus menu refresh | Reject closed-store or sold-out checkout on the server and refresh stale carts |
| Driver assignment | Eight second driver polling | Add driver-specific authenticated event delivery and expired offer handling |
| Driver GPS | Browser watchPosition with authenticated POST and order events | Throttle by time movement and accuracy; reject stale or impossible fixes |
| Customer live map | Leaflet display and latest fix replay | Show last update stale state accuracy and consent; provide a text alternative |
| Dispatch ETA | Calculation helper and periodic dispatch reads | Separate straight-line distance from road travel and label uncertain estimates |
| Customer support chat | Multiple endpoints and a generic event subscriber | Customer event authorization and identity need a dedicated coherent contract |
| Push notifications | UI attempts subscription; helper and table scaffolding exist | Register real subscribe endpoints and delivery workers; remove sample key fallback |
| Inventory and cash updates | HTTP mutations plus selective events or reload | Use one inventory ledger and cash custody event model |
| Reconnect | Browser reconnect and latest snapshot | Add Last-Event-ID replay and version-aware snapshot reconciliation |
| Scaling | In-memory event subscriber sets | Introduce cross-process event distribution before using multiple backend instances |

The draft strengthens staff stream authorization, drops broadcasts with a missing tenant, sends 15-second heartbeat comments and disables proxy buffering. These are local code changes. The actual hosting proxy, network interruption behavior, token expiry and cross-device replay must still be validated.

Recommended event envelope: event ID, type, schema version, tenant ID, aggregate ID, aggregate version, server timestamp and a minimal payload. Write domain changes and outbox records in one database transaction. Deliver outbox records after commit. A client ignores older versions, reconciles on a detected sequence gap, and reconnects with a cursor and jittered backoff.

Show four distinct signals: device internet connection, API reachability, live event connection and age of the displayed data. A green browser online flag does not prove that the API or event stream is healthy. Show reconnecting, up to date, delayed and offline states in plain language.

For GPS, use an adaptive policy: approximately every 5 to 10 seconds while an active delivery is moving, less often while stationary, and no location transmission after the shift or tracking session ends. Values are design targets, not measurements. Include timestamp, accuracy, assigned driver ID and delivery ID; reject fixes outside the assignment window. Share only necessary current location with the customer.

A mobile web page cannot promise continuous location tracking while the phone is locked or the browser is suspended. Reliable background tracking requires a native or Capacitor implementation with operating-system permissions, battery behavior, foreground-service rules and real-device tests. State this limitation visibly before claiming background tracking.

Suggested acceptance targets are customer and kitchen state updates within two seconds on a healthy connection, GPS freshness under fifteen seconds during an active moving delivery, and recovery to a consistent snapshot after a thirty-second network interruption. Measure these in staging. Free Render cold starts cannot guarantee those targets.

## 06 Most important launch gaps

| Priority | Finding | Evidence and completion condition |
| --- | --- | --- |
| P0 | Proof of delivery is not durably saved | The driver sends signature and deliveryPhoto, but the status handler does not store them. Require validated stored media references and a verifiable proof record before the success message. |
| P0 | Push notification pipeline is incomplete | OrderTrackingView calls /api/public/push/subscribe without a matching registered route. Complete subscription ownership, VAPID secrets, delivery retries and unsubscribe handling. |
| P0 | Duplicate routes conceal alternative logic | OTP verification, SaaS provisioning, categories, shifts and support have repeated registrations. Keep one authoritative handler per method and path and test the resulting contract. |
| P0 | Inventory rules are inconsistent across channels | Online, counter, group, offline, modification, cancellation and refund paths do not share a complete raw ingredient ledger. Add atomic reservation and exactly-once reversal. |
| P0 | Token and participant authorization remains uneven | Staff and driver checks were strengthened in the draft, but support ownership, legacy tracking links, customer identity scope and indirect relation writes need a full matrix. |
| P0 | Order and payment state must be consistent everywhere | The draft separates them; verify provider callbacks, dispatch, cash collection, rejection and reports using the same state model. |
| P0 | Schema changes are ad hoc | Startup has broad migrations and swallowed errors in some helpers. Add versioned migrations, preflight backup and explicit failure reporting. |
| P0 | Live external integrations have not been proved | Local tests do not prove PayHere, email SMS, cloud database latency or LAN printing. Record provider-backed tests and failure recovery. |
| P0 | Durable hosted storage and migration are unconfirmed | The existing Render free service cannot retain a local SQLite file. Verify its actual database setting, preserve data and test migration before deployment. |
| P0 | Kitchen station data is inferred incompletely | Station filtering depends on category text while resolved order items may omit the category. Carry explicit station IDs into immutable ticket items. |
| P1 | Guest tracking needs a clearer security model | New draft order IDs use stronger randomness, but use explicit signed or revocable tracking capabilities and sanitized public DTOs. |
| P1 | Cloud printer transport is incomplete operationally | A cloud server cannot normally connect to a private restaurant printer address. Deploy an authenticated outbound local print bridge and test retries and duplicate prevention. |
| P1 | Scheduling is a UI input without a reliable full scheduler | Validate opening hours capacity and future release; a sleeping free host cannot provide dependable timed processing. |
| P1 | Forecasting is an unconnected helper | The module has tests but is not imported by the live workflow. Feed real usage data and display confidence and insufficient-history states. |
| P1 | Notification success can be simulated | Without provider credentials helpers return simulated results. Production status must distinguish queued delivered failed and disabled. |
| P1 | Media and personal-data handling need controls | Large inline photos signatures GPS and customer records need validated limits access controls retention and deletion procedures. |

A zero-advisory dependency audit does not close the workflow issues above. Likewise, automated tests provide evidence for their tested scenarios; they do not certify all route authorization, financial correctness or availability.

## 07 User experience improvements for staff

The draft provides a calmer light workspace, consistent green accents, compact navigation, keyboard page search, role-aware menu items, phone More navigation and a saved theme preference. The important next improvement is reducing the work needed to complete a task during a busy service.

- Keep the active table, customer, order type and cashier visible while the cart is edited. Offer an obvious return to the current sale from every operational screen.
- Use one clear primary action per stage: send to kitchen, take payment, mark ready, hand over. Disable repeated submission while awaiting a response and show what the system is doing.
- Add a persistent offline reconciliation center with queued, acknowledged, disputed and failed states. Do not tell a cashier that a sale is settled before the server acknowledges it.
- Use compact keyboard shortcuts only where they cannot trigger accidental destructive actions. Add a shortcut reference, barcode focus mode and keyboard control for all dialogs.
- Provide undo for cart deletion and nonfinancial edits. Require a reason and step-up authority for voids refunds resets and large adjustments.
- Simplify kitchen tickets around course station age priority allergens and the next action. Use high-contrast warnings that do not rely only on color or sound.
- Provide a guided setup flow for restaurant details menu categories taxes printer cash float hours delivery zone and staff. Show incomplete setup before taking live orders.
- Use server pagination search and filters for growing orders customers and inventory. Avoid downloading the entire history every few seconds.
- Test long Sinhala and Tamil labels, landscape tablets, glove-friendly touch targets, screen readers and receipt widths with real operators.

High-value later additions include customer-facing counter displays, reservations and waiting lists, seat and course ordering, purchase receiving, stock counts and permission templates. Add these after the shared order, payment and inventory services are stable.

## 08 User experience improvements for customers

The draft adds a wider desktop menu, phone-friendly layout, saved dishes, clearer open status, accessible SVG navigation, cart visibility fixes and tax and service-charge rates from the selected restaurant. Search, filters, customization and checkout should operate as one continuous flow.

- Use a server quote before final confirmation. Show the full price including modifiers discounts tax service charge delivery and tip, with an expiry or version if prices can change.
- Warn before switching restaurants with a nonempty cart. Restore separate carts per restaurant or ask whether to start a new order.
- Add actual opening hours next opening time scheduled-slot capacity and honest preparation estimates. A simple open flag is insufficient for dependable scheduling.
- Explain unavailable items and substitutions without silently replacing a dish. Reprice a reorder and explicitly flag removed modifiers or ingredients.
- Use verified allergen information and normalize dietary tags. Missing data must not be presented as an allergen-free guarantee.
- After payment, show confirmed payment and current meal progress separately. Provide a clear path for pending duplicate failed or late callbacks.
- Keep live tracking understandable without the map: accepted at, preparing, ready, driver assigned, on the way and delivered, each with a last-updated timestamp.
- Ask for notification permission after the customer chooses order updates. Give a tracking-link fallback if permission is denied.
- Give guests a secure recovery path using an order receipt and verified contact. Do not expose order history or support tickets merely because someone knows a phone number.
- Offer account data export deletion consent preferences and retention information suited to the actual operator practices.

## 09 User experience improvements for drivers

The draft adds route, available and completed tabs, work counters, actual history data and a clearer sign-in screen. The remaining driver work is operational reliability and safe delivery evidence.

- Build the screen around the next pickup or drop-off, with the restaurant address customer instructions readiness status contact action and a large navigation button.
- Display the GPS permission state last fix last transmitted update and accuracy. Distinguish browser GPS activity from successful server receipt.
- Persist delivery proof with a server-generated record ID. Show uploading saved or failed; retain a retryable local copy until the server confirms storage.
- Require an explicit delivery verification step such as signature photo or customer delivery code according to the restaurant policy. Record timestamps and authorized actor.
- Separate cash expected cash collected and cash handed over. Require manager acknowledgment and show discrepancies without changing historic receipts.
- Add accept or decline offers with deadlines, availability or break mode, reassignment with reasons, failed delivery return to store and customer unreachable flows.
- Introduce a real earnings ledger with delivery fees tips commission adjustments and payout status if drivers are paid through the platform. Order value is not driver earnings.
- Add authorized in-app chat, limited customer contact exposure and clear permission around location sharing. WhatsApp links alone do not provide a controlled support record.
- Use native background tracking only when the business needs it and after battery privacy and operating-system tests.

## 10 Existing Render deployment findings

Authenticated Render metadata identifies the service restaurant-pos at https://restaurant-pos-643r.onrender.com. It uses the free web-service plan in Oregon, one Node instance, the main branch of Rashid-RG/restaurant-pos, build command npm ci, start command node server.js, and no configured health-check path.

The latest listed live deploy is commit 7757072a5b48146ee22de71a9aff49d634a1b80d, with a deployment completion timestamp of 17 August 2026. The later MIT attribution commit and this draft should not be assumed live. Auto-deploy is reported enabled, but that flag alone does not prove that a particular commit was deployed.

The recent event query and error-log query returned no records in their queried windows. That does not prove that the service is healthy, fast or free of earlier failures. A direct public health retrieval could not be completed through the available web fetch path, so no end-user availability or latency measurement is claimed.

| Setting | Change recommended before the new release |
| --- | --- |
| Build command | npm ci && npm run build:all because the draft removes the root postinstall build hook |
| Start command | npm run start:production or node server.js |
| Health check | /api/health after successful database initialization |
| Node runtime | Node 24 matching the tested dependencies and declared engine |
| Storage | External durable libSQL database for the proposed free path, or a separately verified production database |
| Secrets | Distinct random staff and customer signing keys, initial owner credentials, configured payment and notification secrets |
| Data migration | Export preserve validate and restore existing data before changing any database variable |
| Rollout | Validate the draft on an isolated staging deployment before changing the live service |

No changes to the existing Render service configuration, database, plan or live deployment were made as part of this inspection. No paid service or extra subscription was created.

## 11 Free deployment plan and its limits

The practical free demonstration path is one Render web service serving all three compiled apps, backed by a separate durable libSQL database such as a compatible Turso database. This avoids local-database loss and keeps the frontend and API on one origin. The new render.yaml prepares this path but does not provision a database account or prove an external connection.

Render states that free web services sleep after fifteen minutes without inbound traffic and can take about a minute to wake. Filesystem changes, including local SQLite databases and uploads, are lost across redeploys restarts or spin-down. Free Render Postgres instances expire after thirty days. Render explicitly frames these free services as development or preview resources, not production hosting.

Turso currently lists a free plan with 100 databases, 5 GB storage, 500 million monthly rows read and 10 million monthly rows written. These are provider quotas as checked for this report, not an indefinite guarantee. The draft adapter is for a compatible libSQL database; select that engine and verify SDK compatibility rather than assume that all database products from the same provider are interchangeable.

| Environment | Suitable use | Limits and action |
| --- | --- | --- |
| Local development | Building and exercising all three apps | Use isolated sample data and test credentials only |
| Free Render plus durable free database | Demo user feedback and noncritical pilot exploration | Expect cold starts quotas and notification limits; validate remote transactions |
| Always-on hosted runtime plus durable database | Actual restaurant service | Choose after real latency load backup and recovery measurements |
| Restaurant LAN deployment | Counter and kitchen operation near local printers | Requires local maintenance secure remote access and independent offsite backup |

Live card fees, commercial SMS, map or routing APIs, email quotas, media storage and a domain may have separate costs. Keep optional integrations disabled or explicitly configured when unavailable. Do not generate artificial keep-alive traffic as a substitute for an appropriate availability plan.

A safe migration sequence is: inventory existing storage and secrets; export a backup; create an empty durable staging database; apply the schema; import and reconcile counts and totals; test the three applications and payment sandbox; exercise a restart; test restore; then move the live service only after the operator can review the resulting behavior.

## 12 Prioritized feature roadmap

| Stage | Work | Exit condition |
| --- | --- | --- |
| P0 Foundation | One order payment inventory contract; complete authorization; remove duplicate routes; version migrations; durable storage; payment evidence and proof persistence | Cross-tenant abuse retries concurrency reversals restore and provider sandbox tests pass |
| P1 Pilot | All three app flows; reliable events and reconnect; scheduled ordering; customer notifications; driver exceptions; printer bridge; accessibility and translation pass | A store can complete a full service simulation including outages and end-of-day reconciliation |
| P2 Operations | Purchase receiving stock counts expiry lots reservations seat ordering real earnings and subscription collection | Demand is confirmed by pilot users and each feature shares existing ledgers and audit events |
| P3 Expansion | Native background GPS route optimization kiosks loyalty campaigns and additional aggregators | The core system has measured reliability and the added integration cost is justified |

Suggested working sequence is an engineering estimate rather than a delivery promise. Start with storage and financial invariants, then end to end happy paths, then exception and recovery flows, then advanced features. A useful release is defined by passed acceptance criteria, not by the number of screens or a percentage readiness label.

Keep a small release backlog: one owner per task, its affected screens and routes, dependencies, measurable acceptance tests, migration impact and rollback procedure. Close tasks only with evidence in the same environment in which the feature will run.

## 13 Modern feature ideas worth evaluating

- Unified event timeline for every order combining kitchen payment dispatch customer contact refunds and staff decisions.
- Configurable permission templates for owner manager cashier kitchen dispatcher support and finance roles.
- Idempotent QR table sessions with waiter requests and guest-to-staff handoff.
- Actionable exception inbox for payment received without order release, late meals, unassigned delivery, offline sale discrepancy and failed notification.
- Customer substitution choices and stock-aware bundles with margin and allergen checks.
- Configurable order capacity by preparation station time slot and driver availability.
- Channel-specific menu pricing with explicit published versions and audit history.
- Purchase receiving, stock count and waste analytics tied to a true ingredient movement ledger.
- Driver availability, failed-delivery handling, pickup scanning and customer delivery-code verification.
- Consent-aware location history with limited retention and a customer view restricted to the relevant delivery.
- Nonblocking local print queue with workstation identity receipt deduplication acknowledgments and reprint audit.
- Operational analytics based on real service events: acceptance delay preparation duration handoff delay on-time delivery cancellations refunds and inventory variance.
- Low-cost algorithmic replenishment after enough real usage history, with explainable confidence and override reasons.
- Onboarding checklists and sample-mode controls so operators can explore safely without mixing demonstration data into business reports.
- Customer retention features such as genuine reorder suggestions saved dishes consent-based offers and an expiring loyalty ledger.
- Accessible staff and customer experiences with large targets keyboard use text alternatives and reduced-motion settings.
- Advanced multi-outlet management only after outlet stock transfers local taxation permissions and settlement are modeled correctly.
- Offline conflict resolution tools rather than silently overwriting newer server data.
- Public integration contracts and signed webhooks with provider-specific reconciliation rather than accepting arbitrary aggregator payloads.
- Operator export and portability for menus customers orders invoices stock movements and audit history to avoid platform lock-in.

AI can assist menu discovery, support drafting or restock suggestions, but should not invent prices stock allergens payment success or driver location. Keep authoritative business data in validated services and treat generated suggestions as optional assistance.

## 14 Acceptance tests before a restaurant pilot

| Area | Required scenario and evidence |
| --- | --- |
| Identity | A driver customer cashier manager tenant owner and platform administrator each pass allowed actions and fail forbidden actions |
| Tenant separation | Two stores with overlapping product names phones and table numbers never read mutate subscribe to or report each other data |
| Payment | Real sandbox callback missing signature wrong merchant wrong currency wrong amount replay concurrent replay late payment and refund all reconcile correctly |
| Stock | Last-item races duplicate requests group checkout edits cancellations returns offline batches and ingredient shortages produce correct balances |
| Kitchen | A prepaid delivery remains in the kitchen workflow and moves to the correct station and dispatcher without disappearing |
| Driver | Only the assigned rider can claim progress locate or complete the delivery; proof and cash collection persist and are viewable by authorized staff |
| Realtime | Three devices agree after disconnect reconnect delayed duplicated and out-of-order events, a server restart and a token expiration |
| Schedule | Closed store invalid slot time zone and capacity overflow are blocked; valid scheduled orders release on time |
| Offline | Queue survives logout crash reconnection and new queued entries; disputed sales remain available for manual reconciliation |
| Hardware | Real 58 mm and 80 mm receipts drawer commands network outages retries and reprints work through the local bridge |
| Data recovery | An encrypted backup is restored into an isolated environment and order inventory and payment totals reconcile |
| User experience | Counter kitchen customer and driver users complete their tasks at phone tablet and desktop sizes without horizontal page overflow |
| Operations | Health check startup failure storage failure provider timeout and deploy rollback have observable tested recovery behavior |

## 15 Validation performed during this work

Final local automated result: 131 passing tests.

The validation record below describes local evidence for the draft. It does not establish a completed rollout, a live provider transaction or sustained performance under load.

| Check | Evidence | Limit |
| --- | --- | --- |
| Automated tests | Final local result is recorded in the generated evidence summary | Scenario coverage is limited to the assertions in the suite |
| Production build | All three frontend bundles compiled with the updated toolchain | A build does not establish a successful user workflow |
| Production smoke | Fresh owner login, all three app routes, simulation guard and restart persistence passed for SQLite and a local libSQL client path | External Turso network transport and Render environment were not exercised |
| Dependency audit | Root production and full dependency audits reported zero known advisories after updates | No guarantee against unknown vulnerabilities or business-logic defects |
| Browser interactions | Staff login keyboard navigation phone menu customer saved dishes cart addition driver login and delivery tabs passed | Selected flows at 1440 px and 390 px; full accessibility and every screen were not certified |
| Backend syntax | Server helpers routes and operational scripts checked | Static syntax checking does not prove correctness |
| Backup | Local SQLite backup integrity and restart persistence checked | A full remote provider export and operational restore drill is still required |
| Render inspection | Service configuration latest deploy event window and error-log window read | No live change or successful public health measurement is claimed |

The release should remain marked as a development pilot until the P0 launch gates and provider-backed acceptance tests are closed. The separate microfeature and API inventories provide a working backlog for that process.

## 16 Sources and reproducibility

1. GitHub repository https://github.com/Rashid-RG/restaurant-pos and the source files listed in the microfeature inventory.
2. Local draft branch codex/production-readiness and its automated test build smoke browser and dependency audit outputs.
3. Authenticated Render service metadata for restaurant-pos, inspected on 5 November 2026 Asia Colombo.
4. Render official free-service documentation https://render.com/docs/free checked during this review.
5. Turso official pricing https://turso.tech/pricing and SDK reference https://docs.turso.tech/sdk/ts/reference checked during this review.
6. PayHere official Checkout API documentation https://support.payhere.lk/api-%26-mobile-sdk/checkout-api used for notification verification requirements.

## Detailed microfeature register

### Staff access and workspace

Source evidence: src/components/Login.jsx; Sidebar.jsx; WorkspaceTools.jsx; server.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-001 Staff username and password sign in | Existing | P0 Retain authentication regression coverage |
| GF-002 Show and hide password | Draft checked | P2 Keep an accessible label and password manager support |
| GF-003 Forgotten password request | Existing | P0 Verify the real email delivery path and account recovery ownership |
| GF-004 Reset by link or code | Existing | P0 Unify token expiry and single-use reset behavior |
| GF-005 Owner manager cashier and kitchen roles | Existing | P0 Define an explicit permission matrix for every route |
| GF-006 Staff account creation | Draft checked | P0 Prevent privilege escalation and hash all PINs |
| GF-007 Staff account deletion and session rejection | Draft checked | P0 Add intentional account disable and explicit session revocation |
| GF-008 Manager PIN verification | Existing | P0 Test overrides within the same restaurant only |
| GF-009 Timeclock sign in and sign out | Existing | P1 Add shift summary and missed clock correction audit |
| GF-010 Clock status view | Existing | P1 Make the current clock state visible without opening a dialog |
| GF-011 Role aware navigation | Draft checked | P1 Mirror backend authorization rather than rely on hidden buttons |
| GF-012 Keyboard command navigation with Ctrl or Command K | Draft checked | P2 Add item and order search after page navigation |
| GF-013 Mobile navigation and More menu | Draft checked | P1 Test touch targets and screen reader focus across every modal |
| GF-014 Light and dark appearance preference | Draft checked | P2 Audit component inline colors in both themes |
| GF-015 Network connection indicator | Draft checked | P1 Add server connectivity and last successful sync as separate states |
| GF-016 Error recovery screen | Draft checked | P1 Preserve unsent form input when recovering |
| GF-017 Restaurant suspension screen | Existing | P0 Revoke all customer and driver capabilities on suspension too |
| GF-018 System version and update prompt | Existing | P1 Replace per-process build time with a stable release identifier |

### Staff sale and cart

Source evidence: src/components/POSView.jsx; src/context/POSContext.jsx; lib/billing.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-019 Menu grid and categories | Existing | P1 Include fast category search for large menus |
| GF-020 Dish search | Existing | P1 Add barcode and SKU lookup only where restaurants need it |
| GF-021 Menu photograph and fallback | Existing | P1 Use durable optimized media and avoid misleading stock photographs |
| GF-022 Add item and merge matching cart lines | Existing | P1 Confirm modifier and note identity when merging |
| GF-023 Quantity increase and decrease | Existing | P0 Reject fractional or negative quantities for unit products |
| GF-024 Remove one line or clear cart | Existing | P1 Provide undo for accidental removal |
| GF-025 Per item notes | Existing | P1 Show allergy notes distinctly on kitchen tickets |
| GF-026 Optional and required modifiers | Partial | P0 Enforce required choices and selection limits on the server |
| GF-027 Modifier price resolution from database | Draft checked | P0 Reject unavailable or duplicate modifier choices explicitly |
| GF-028 Dine in takeaway and delivery modes | Existing | P1 Centralize allowed mode names and validation |
| GF-029 Select table | Existing | P0 Enforce table occupancy conflicts transactionally |
| GF-030 Select or create a customer | Existing | P1 Offer a guest path without forcing personal data |
| GF-031 Hold and recall order | Existing | P1 Include owner cashier and expiry metadata |
| GF-032 Percent and flat discounts | Existing | P0 Keep override authority separate from discount amount |
| GF-033 Manager override for discounts | Existing | P0 Reverify hashed PIN and restaurant ownership for each override |
| GF-034 Promotion code pricing | Existing | P0 Add usage caps date windows and single-use rules |
| GF-035 Cash settlement | Existing | P0 Reconcile tender received change due and shift ownership |
| GF-036 Card settlement entry | Partial | P0 Distinguish an external card terminal receipt from an online gateway payment |
| GF-037 PayHere checkout | External setup | P0 Complete sandbox payment and independent webhook end to end |
| GF-038 Split tender | Existing | P0 Validate tender sums and prevent partial payment being marked fully paid |
| GF-039 Split bill by share or item | Existing | P0 Verify allocation and rounding across child bills |
| GF-040 Service charge rate | Draft checked | P0 Keep client estimate consistent with the selected store |
| GF-041 Tax rate and rounding | Draft checked | P0 Store rate snapshots on invoices and validate restaurant tax configuration |
| GF-042 Optional gratuity | Existing | P0 Keep tips in settlement and refund reconciliation |
| GF-043 Server authoritative repricing | Draft checked | P0 Cover every entry point including group orders and stock edits |
| GF-044 Atomic last item reservation | Draft checked | P0 Extend stock concurrency rules to every ingredient and mutation path |
| GF-045 Order edit after kitchen submission | Draft checked | P0 Add kitchen change tickets and ingredient stock reversal |
| GF-046 Void or cancellation | Existing | P0 Require reasons and restore every consumed inventory component once |
| GF-047 Positive cash refund with reason | Draft checked | P0 Add provider-backed electronic refund confirmation |
| GF-048 Invoice numbering at settlement | Draft checked | P0 Decide fiscal sequence scope and immutable receipt rules |
| GF-049 Receipt print view | Existing | P1 Verify actual printer output and local number formats |
| GF-050 Network thermal receipt and drawer command | External setup | P0 Cloud hosting needs a trusted local print bridge |
| GF-051 Open and close cashier shift | Existing | P0 Verify float tender cash movements refunds and cashier scopes |
| GF-052 Cash in cash out and no sale log | Existing | P1 Make reason codes and evidence mandatory |
| GF-053 Offline cash reconciliation API | Draft checked | P0 Add a complete cashier offline workflow and reconciliation screen |
| GF-054 Tenant bound offline queue acknowledgments | Draft checked | P0 Integrate queue status into POS and preserve disputed sales |

### Dining room and kitchen

Source evidence: src/components/FloorPlan.jsx; KDSView.jsx; server.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-055 Table list with capacity and state | Existing | P1 Add sections rooms and table accessibility notes |
| GF-056 Create or delete a table | Existing | P0 Do not delete an occupied table without a controlled transfer |
| GF-057 Open table session in POS | Existing | P1 Show current order age and assigned staff |
| GF-058 Table transfer | Existing | P0 Race test simultaneous transfers and preserve original audit history |
| GF-059 Table merge | Existing | P0 Reprice and reconcile modifiers discounts invoices and inventory |
| GF-060 Dine in table QR generation | Existing | P1 Bind guest table sessions securely and expire old sessions |
| GF-061 Kitchen pending preparing and ready columns | Existing | P1 Add explicit accept ready handoff completion state transitions |
| GF-062 Kitchen ticket age timers | Existing | P1 Add configurable warning thresholds and overdue sorting |
| GF-063 Station filter for kitchen bar and desserts | Partial | P1 Store an explicit kitchen station instead of inferring it from category text |
| GF-064 Customer order notes and special instructions | Existing | P1 Use high contrast for critical dietary instructions |
| GF-065 Online order badge | Existing | P1 Add scheduled payment and order channel badges |
| GF-066 Accept with preparation estimates | Existing | P0 Prevent repeated acceptance or impossible transitions |
| GF-067 Reject with a reason | Existing | P0 Trigger payment reconciliation if the customer already paid |
| GF-068 New order chime | Existing | P1 Provide audible test volume control quiet mode and visual fallback |
| GF-069 Ready to serve or dispatch action | Existing | P1 Record staff actor and handoff timestamp |
| GF-070 Per item cooking progress | Proposed | P2 Add split station completion and an expediter view |
| GF-071 Kitchen bump and recall history | Proposed | P2 Add undo and versioned ticket amendments |
| GF-072 Reservations and waiting list | Proposed | P2 Add party size deposits no show and arrival workflows |
| GF-073 Seat and course ordering | Proposed | P2 Support starters mains fire timing and seat-specific bills |
| GF-074 Customer display or self service kiosk | Proposed | P3 Scope after core counter and kitchen flows are reliable |

### Inventory menu and suppliers

Source evidence: src/components/Inventory.jsx; Settings.jsx; server.js; lib/ai_forecasting.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-075 Menu item create edit and delete | Existing | P0 Enforce tenant ownership and schema validation on every upsert |
| GF-076 Price and cost per dish | Existing | P1 Add effective dates and cost change history |
| GF-077 Category create edit delete and clear | Existing | P1 Confirm bulk actions and affected item handling |
| GF-078 Photo upload preview and pasted URL | Existing | P1 Move large base64 media to durable object storage with quotas |
| GF-079 Stock on hand and minimum quantity | Existing | P0 Add append-only stock movements with a reason |
| GF-080 Availability toggle and sold out state | Existing | P0 Reject unavailable products at every server checkout |
| GF-081 Spice halal dietary and allergen attributes | Partial | P1 Expose every stored attribute in public menu DTOs and filters |
| GF-082 Preparation time and portion size | Partial | P1 Use the real fields in sort estimates and kitchen routing |
| GF-083 Raw ingredient create and stock view | Existing | P0 Check ownership on ingredient IDs before upsert |
| GF-084 Recipe ingredient quantities | Existing | P0 Validate units yield waste and negative quantities |
| GF-085 Ingredient deduction on online ordering | Partial | P0 Apply the same inventory ledger to counter group offline cancel and refund paths |
| GF-086 Menu stock manual adjustment | Existing | P1 Track counted quantity variance actor and reason |
| GF-087 Supplier list and create API | Partial | P0 Add tenant ownership and a verified supplier schema |
| GF-088 Low stock purchase order suggestions | Partial | P1 This is a suggested reorder list rather than a complete purchasing workflow |
| GF-089 Purchase order receiving and partial delivery | Proposed | P2 Add approval supplier delivery invoice and landed cost |
| GF-090 Waste logging | Partial | P0 Verify database schema route and stock deduction are connected |
| GF-091 Stock transfer request and approval | Partial | P0 Add destination receiving transaction and reject insufficient source stock |
| GF-092 Stock take and cycle count | Proposed | P2 Add blind counting variance approval and adjustment audit |
| GF-093 Ingredient batches expiry and FIFO FEFO | Proposed | P2 Support spoilage alerts and batch traceability |
| GF-094 Unit conversion and recipe yield | Proposed | P2 Distinguish grams kilograms portions and purchase pack sizes |
| GF-095 Demand forecasting function and unit tests | Partial | P2 Module exists but live sales pipeline and UI are not wired |
| GF-096 Forecast confidence and insufficient history message | Proposed | P2 Do not present a one-unit-per-day fallback as a trained forecast |
| GF-097 Supplier pricing comparison | Proposed | P3 Add after reliable receiving and historical costs |

### Customer discovery and menu

Source evidence: apps/customer-web/src/App.jsx; views/RestaurantsView.jsx; views/MenuView.jsx

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-098 Restaurant marketplace directory | Existing | P1 Separate onboarding demo and real verified restaurants |
| GF-099 Restaurant search and cuisine filters | Existing | P1 Base all results on indexed tenant catalog fields |
| GF-100 Switch selected restaurant | Draft checked | P0 Warn before changing a cart to a different restaurant |
| GF-101 Selected restaurant persistence | Existing | P0 Scope cart favorites addresses and tokens intentionally |
| GF-102 Restaurant hero and open status | Draft checked | P1 Show actual opening hours holiday rules and next opening time |
| GF-103 Desktop and phone menu layouts | Draft checked | P1 Verify small phones landscape tablets and long translated text |
| GF-104 Menu category chips | Existing | P1 Keep horizontal category scrolling without page overflow |
| GF-105 Dish name and description search | Existing | P1 Normalize spelling and Sinhala or Tamil search terms |
| GF-106 Price ascending and descending sort | Existing | P1 Make price scope clear when modifiers change the price |
| GF-107 Quickest preparation sort | Partial | P1 Align prepTimeMinutes with stored preparationTime |
| GF-108 Popularity sort | Partial | P1 Current default ordering is not evidence of sales-ranked popularity |
| GF-109 Maximum price filter | Existing | P1 Use clear currency and accessible numeric input |
| GF-110 Vegetarian vegan spicy gluten free halal and nut filters | Partial | P0 Normalize tag names and send all allergen fields to the browser |
| GF-111 Allergen disclosure | Partial | P0 Do not infer allergen absence from a missing tag |
| GF-112 Dish photograph lazy loading and fallback | Existing | P1 Compress media and keep React image errors safe |
| GF-113 Unavailable product button state | Existing | P0 Make server availability authoritative |
| GF-114 Persistent saved dishes and saved filter | Draft checked | P2 Add synchronization only after customer account semantics are defined |
| GF-115 Personalized reorder suggestions | Existing | P1 Restrict history to the signed-in customer and selected restaurant |
| GF-116 Multi-language English Sinhala and Tamil | Existing | P1 Audit untranslated labels plural forms and currency dates |
| GF-117 Customer cart quantity and modifiers | Existing | P1 Preserve selection and notes across refresh safely |
| GF-118 Required modifier dialog | Existing | P0 Mirror selection requirements on the server |
| GF-119 Group cart participant name and share link | Existing | P0 Make invitation secrets high entropy with host controls |
| GF-120 Group cart additions and checkout | Partial | P0 Close checkout races and unify pricing stock and tenant validation |
| GF-121 Browser voice search or AI input | External setup | P2 Offer typing fallback and explain microphone permission |
| GF-122 AI menu recommendations | External setup | P1 Ground suggestions in live menu and enforce rate and cost limits |
| GF-123 Budget and dietary AI prompts | Existing | P1 Make unsafe dietary guarantees impossible and revalidate prices |
| GF-124 Customer support and driver portal links | Existing | P2 Keep customer navigation focused on ordering and assistance |

### Customer checkout and account

Source evidence: apps/customer-web/src/views/CartCheckoutView.jsx; ProfileView.jsx; LoginRegisterView.jsx; server.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-125 Guest checkout contact details | Existing | P0 Minimize collected fields and validate contact ownership where needed |
| GF-126 Account registration with password | Existing | P0 Enforce password policy rate limiting and account uniqueness design |
| GF-127 Password sign in | Existing | P0 Align global customer identity with tenant membership and loyalty rules |
| GF-128 Email or phone OTP send and verify | Partial | P0 Consolidate duplicate verify routes and persistent single-use code storage |
| GF-129 Password reset by email or code | Existing | P0 Run provider-backed recovery and expiry tests |
| GF-130 Profile name phone and password edit | Existing | P0 Reverify changed contact identifiers before trusting them |
| GF-131 Saved delivery addresses | Existing | P1 Add edit delete default label and delivery instructions |
| GF-132 Address autocomplete and map pin | External setup | P1 Display geocoder attribution and handle quota and network failures |
| GF-133 Browser use my location | External setup | P1 Support denied permission inaccurate fixes and manual entry |
| GF-134 Dine in QR checkout | Existing | P0 Authorize table session and verify table belongs to selected restaurant |
| GF-135 Takeaway checkout | Existing | P1 Add pickup counter instructions and arrival confirmation |
| GF-136 Delivery checkout with zone and minimum | Existing | P0 Enforce actual zone rules and store open state on the server |
| GF-137 Scheduled order time selector | Partial | P0 Add capacity opening-hours validation and a reliable release scheduler |
| GF-138 Distance based delivery fee | Existing | P1 Explain distance basis and avoid treating straight-line distance as road distance |
| GF-139 Free delivery threshold and peak surcharge | Existing | P0 Snapshot fees and prevent manipulated client subtotal quotes |
| GF-140 Rain surcharge manual switch | Existing | P1 Show fee breakdown before confirmation |
| GF-141 Promotion code entry | Existing | P0 Validate eligibility use caps and expiry on final checkout |
| GF-142 Loyalty points display and redemption | Draft checked | P0 Reconcile earning expiry cancellation refund and concurrent redemption |
| GF-143 Optional tip presets and custom tip | Existing | P1 Show recipient and refund behavior clearly |
| GF-144 Cash on delivery or pay at counter | Existing | P0 Track tender collection independently from delivery completion |
| GF-145 PayHere redirect or SDK checkout | External setup | P0 Complete live provider callback verification before accepting real money |
| GF-146 Verified gateway amount merchant and currency | Draft checked | P0 Add durable payment attempt records and reconciliation reports |
| GF-147 Duplicate callback idempotency | Draft checked | P0 Extend idempotency to orders refunds and payment initiation |
| GF-148 Payment state separate from fulfilment | Draft checked | P0 Audit every screen report and legacy migration against the same state model |
| GF-149 Cart tax and service charge estimate | Draft checked | P0 Use a full server quote for promotion and delivery edge cases |
| GF-150 Order confirmation and track link | Existing | P1 Use signed expiring tracking capabilities and hide internal order fields |
| GF-151 Order history and reorder | Existing | P1 Reprice reordered items and explain unavailable substitutions |
| GF-152 Customer cancellation before preparation | Existing | P0 Define paid-order refund approval and inventory reversal policy |
| GF-153 Saved card metadata | Partial | P0 Do not call this payment tokenization without a real provider vault token |
| GF-154 Order rating and review prompt | Existing | P1 Enforce one verified completed-order review and moderation policy |
| GF-155 Terms privacy and refund policy views | Existing | P1 Have the operator review actual business terms rather than accept sample claims |
| GF-156 Account deletion data export and consent settings | Proposed | P1 Add verified data requests and configurable retention controls |

### Customer tracking and support

Source evidence: apps/customer-web/src/views/OrderTrackingView.jsx; SupportView.jsx; components/TrackingMap.jsx; server.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-157 Order progress timeline | Existing | P0 Keep payment success distinct from meal preparation and delivery |
| GF-158 Initial order snapshot from API | Existing | P0 Replace raw rows with a minimal customer-specific DTO |
| GF-159 Order specific SSE live stream | Existing | P0 Authorize tracking capability and protect order-level personal data |
| GF-160 Five second order polling fallback | Existing | P1 Poll only when the live stream is unavailable and page is visible |
| GF-161 Eight second dispatch polling | Existing | P1 Consolidate with the same authenticated event stream |
| GF-162 Preparation estimate and acceptance time | Existing | P1 Add updated-at and late-order explanations |
| GF-163 Driver location replay on reconnect | Existing | P1 Show the latest fix timestamp accuracy and stale status |
| GF-164 Leaflet delivery map | External setup | P1 Validate tiles attribution load failures and location privacy |
| GF-165 Distance to driver or store display | Existing | P1 Distinguish approximate straight-line distance from navigation ETA |
| GF-166 Driver GPS coordinates through order events | Existing | P0 Share only the assigned on-duty driver's necessary location |
| GF-167 Support ticket create and list | Existing | P0 Use verified ownership rather than only a supplied phone or email |
| GF-168 Support categories and resolution | Existing | P1 Add SLA owner status and escalation history |
| GF-169 Support thread reply endpoint | Partial | P0 Derive sender identity server-side and test customer and staff authorization |
| GF-170 Customer support live event connection | Partial | P0 Current customer connection does not supply the staff-only event token |
| GF-171 Driver and customer chat endpoints | Existing | P0 Test both token families and reject unrelated order participants |
| GF-172 Web push subscription request in UI | Partial | P0 The referenced subscribe route is not registered in the live server |
| GF-173 VAPID configuration helper | Partial | P0 Remove sample private key fallback and wire a verified delivery pipeline |
| GF-174 Notification permission experience | Partial | P1 Ask after user intent and provide denied-permission fallback |
| GF-175 Email and SMS confirmation helper | External setup | P0 Verify actual delivery credentials errors retries and cost caps |
| GF-176 Email or SMS fallback simulation | Existing | P0 Never display simulated delivery as real successful notification |
| GF-177 Order status share with household or colleague | Proposed | P2 Add revocable scoped sharing rather than a permanent guessable identifier |
| GF-178 Customer arrival or leave at door instructions | Proposed | P1 Add structured handoff preferences with explicit consent |

### Driver onboarding and daily work

Source evidence: apps/driver-web/src/App.jsx; server.js

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-179 Driver phone and password sign in | Draft checked | P0 Reject pending suspended deleted and stale driver accounts |
| GF-180 Tenant-aware driver login | Existing | P1 Carry selected restaurant through every deep link |
| GF-181 Self registration name and phone | Existing | P0 Verify contact identity and prevent duplicate fraudulent onboarding |
| GF-182 Vehicle type and plate number | Existing | P1 Add edit review and document expiry only if required operationally |
| GF-183 Manager approval or rejection | Existing | P1 Notify the rider and store approval actor and reason |
| GF-184 Persistent driver session | Existing | P0 Expire and revoke tokens deliberately and handle corrupted local storage |
| GF-185 Driver welcome and work counters | Draft checked | P1 Keep counters based on actual service-day definitions |
| GF-186 Assigned route list | Draft checked | P1 Add pickup deadline priority and customer handoff instructions |
| GF-187 Available pickup pool | Existing | P0 Mask unnecessary customer data until assignment |
| GF-188 Atomic order claim | Draft checked | P0 Add release expiry and reassign policies |
| GF-189 Completed delivery history tab | Draft checked | P1 Add date filter search and export without exposing others' orders |
| GF-190 Active completed and available tab controls | Draft checked | P1 Keyboard arrow behavior and accessible tab panels need a full audit |
| GF-191 Eight second assignment polling | Existing | P1 Replace primary polling with authenticated driver-specific events |
| GF-192 Manual GPS enable and disable | Existing | P0 Record clear consent and stop on logout off duty and terminal delivery |
| GF-193 Browser watchPosition updates | Existing | P1 Throttle by time distance and accuracy and reject impossible jumps |
| GF-194 GPS fix location status | Existing | P1 Show last sent timestamp permission and low accuracy warnings |
| GF-195 Navigation link to Google Maps | External setup | P1 Include pickup then drop off and support missing coordinates |
| GF-196 WhatsApp customer link | Existing | P1 Prefer masked communication and configurable handoff templates |
| GF-197 Start delivery action | Existing | P0 Validate the allowed transition and assigned rider atomically |
| GF-198 Delivered action | Existing | P0 Require the configured proof and payment collection checks |
| GF-199 Canvas signature capture and clear | Partial | P0 Capture exists in UI but server status handler does not persist the submitted signature |
| GF-200 Delivery photo capture and preview | Partial | P0 Validate media size type retention and authenticated storage before calling it evidence |
| GF-201 Proof submission success message | Partial | P0 Do not claim proof was saved without a persisted evidence ID |
| GF-202 Cash to hand over summary | Draft checked | P0 Reconcile all delivered COD receipts with signed manager handover |
| GF-203 Completed today counter | Draft checked | P1 Count delivery completion timestamp rather than order creation time |
| GF-204 New delivery ringtone | Existing | P1 Add quiet hours accessibility and first-notification behavior |
| GF-205 Registration dialog validation and busy state | Existing | P1 Add field-level errors password controls and pending status |
| GF-206 Driver batch assignment | Existing | P0 Make batch dispatch atomic and preserve payment and kitchen state |
| GF-207 Delivery earnings and payouts | Proposed | P2 Add a real remuneration ledger rather than derive pay from order revenue |
| GF-208 In-app customer chat UI | Proposed | P1 Connect authorized chat endpoints and show sent delivered and failed messages |
| GF-209 Offline driver actions and retry queue | Proposed | P1 Queue signed intent and reconcile server versions after reconnect |
| GF-210 Continuous background GPS while phone is locked | External setup | P1 Requires native capabilities permissions and device testing beyond a browser PWA |

### Realtime data and platform operations

Source evidence: server.js; lib/database-gate.js; lib/libsql-store.js; render.yaml; scripts/

| ID and feature | Status | Next step |
| --- | --- | --- |
| GF-211 Shared API for all three applications | Existing | P1 Publish and version request and response contracts |
| GF-212 Tenant scoped staff order feed | Draft checked | P0 Extend tenant tests to every indirect relation and report |
| GF-213 Staff SSE token role verification | Draft checked | P0 Add short-lived stream tickets and token expiry enforcement |
| GF-214 Tenant scoped store availability events | Existing | P0 Never broadcast with a missing tenant and enforce store closure server-side |
| GF-215 Tenant scoped customer registration events | Draft checked | P0 Audit every notification payload for personal data minimization |
| GF-216 SSE heartbeat and disabled proxy buffering | Draft checked | P1 Test through the actual Render proxy and idle connections |
| GF-217 Latest order and GPS snapshot after reconnect | Existing | P1 Add event sequence numbers and replay missed changes |
| GF-218 Durable event outbox and event replay cursor | Proposed | P1 Commit events alongside domain changes and support Last-Event-ID |
| GF-219 Cross-instance event distribution | Proposed | P1 Required before running multiple application workers or instances |
| GF-220 Conflict version and command idempotency | Partial | P0 Add conditional version updates to every competing workflow |
| GF-221 Client synchronization status and last update | Partial | P1 Separate internet access API reachability event stream state and data freshness |
| GF-222 SQLite transaction serialization | Draft checked | P0 Keep one process unless a tested database transaction model replaces it |
| GF-223 Turso libSQL remote transaction adapter | Draft checked | P0 Local adapter tests pass but cloud latency failover and credentials are not validated |
| GF-224 PostgreSQL or Neon adapter | Partial | P0 Production is blocked until dialect migrations and pinned transactions are verified |
| GF-225 Strong production config validation | Draft checked | P0 Enter real per-environment secrets and rotate any earlier exposed values |
| GF-226 Fresh production administrator bootstrap | Draft checked | P0 Force controlled initial credential delivery and avoid repeated reset on restarts |
| GF-227 Readiness endpoint after initialization | Draft checked | P1 Add separate liveness and dependency degradation checks |
| GF-228 Graceful shutdown and event stream closure | Draft checked | P1 Exercise rolling deploys with live clients and long transactions |
| GF-229 Structured request logging | Partial | P1 Add safe request IDs paths latency redaction and actionable alerts |
| GF-230 Local SQLite backup integrity verification | Draft checked | P0 Run offsite encrypted backups and a full restore drill |
| GF-231 Remote database export and restore | External setup | P0 Configure provider recovery and independent exports before live orders |
| GF-232 Render free deployment blueprint | Draft checked | P0 Needs database account secret configuration and staging deployment validation |
| GF-233 Container production build and runtime | Partial | P0 Docker was reviewed but no Docker engine was available to execute the image |
| GF-234 Continuous integration workflow | Draft checked | P0 Confirm the workflow runs in GitHub and gate merges on its results |
| GF-235 Dependency vulnerability updates | Draft checked | P1 Latest local root audit reports zero known advisories rather than proof of no defects |
| GF-236 Customer offline shell cache | Draft checked | P0 Never cache authenticated API responses across users or restaurants |
| GF-237 SaaS plans seat and monthly order limits | Existing | P0 Centralize checks across all provisioning and order paths |
| GF-238 SaaS tenant create delete suspend and plan change | Existing | P0 Remove duplicate route implementations and use transactional deletion |
| GF-239 Subscription invoicing collection and dunning | Proposed | P2 Plan metadata does not implement subscription billing |
| GF-240 Marketplace commission report | Partial | P0 Separate platform administrator access from tenant owner access and verify payout logic |
| GF-241 Aggregator payload normalization | Existing | P1 Keep adapters isolated from verified external callbacks |
| GF-242 Aggregator public webhook ingestion | Partial | P0 Disabled in production until actual provider signature verification exists |
| GF-243 AI usage budgeting and abuse controls | Proposed | P1 Add per-tenant limits model version configuration and failure fallback |
| GF-244 Immutable financial audit trail | Partial | P0 Add tenant actor request IDs before and after state and retention policy |
| GF-245 Bulk data import and reset | Existing | P0 Validate format tenant scope backup and step-up authorization |
| GF-246 Versioned schema migrations | Proposed | P0 Replace ad hoc startup changes and broad swallowed errors |
| GF-247 Role permission editor and support operator roles | Proposed | P2 Start with least privilege and audited role changes |
| GF-248 Security incident and key rotation procedure | Proposed | P0 Define owner actions affected credentials and recovery steps |
| GF-249 Privacy retention and location deletion policy | Proposed | P1 Set limited access and deletion windows for GPS proof and customer data |
