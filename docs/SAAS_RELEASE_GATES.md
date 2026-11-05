# SaaS reliability follow-up

This revision continues the independent-restaurant platform pilot. It is not a blanket production-readiness certificate. The previous handbook describes revision 6a59564; the changes below are newer.

## Changes and evidence

- Canonical support routes now authorize the signed-in customer account or a private guest ticket capability. Phone/email query filters no longer prove ownership. Restaurant staff lists/threads are tenant scoped; sender identity is assigned on the server. New customer support routes are mounted before the staff-only fallback. Existing legacy customer tickets without account/capability metadata remain staff-readable, but are not reassigned by matching contact strings. The customer UI keeps guest ticket access in the current browser and uses authenticated polling rather than the staff event stream.
- Order detail, ETA, dispatch and order SSE require private order access or the actual customer/authorized staff/assigned driver. New order responses include a seven-day tracking capability; HTTP requests pass it in a header, and an HttpOnly scoped cookie authenticates the SSE connection. It is not put in a tracking URL. Existing guest orders without that capability require an authenticated owning account or verified support recovery. An order ID or phone number alone is no longer accepted as ownership.
- Platform support sessions require a recorded reason, expire after 15 minutes and provide a read-only diagnostic snapshot without contact/proof data. Each snapshot access is recorded. Ending a session revokes it. The dedicated platform access audit is append-only at the database layer. This is not staff impersonation or a write-capable support session.
- The platform finance endpoint provides per-restaurant recorded collections, journaled cash refunds and net recorded collections over a bounded time range using a consistent database transaction. It is not restaurant profit, bank settlement, taxes due, subscription revenue, or an instruction to pay merchants. Historical cash/provider reconciliation remains separate.
- Platform recovery exports capture schema and rows in one database transaction and include a SHA-256 integrity checksum. They contain private account data and must be protected. The restore verifier refuses existing destinations, restores only into a new local database, compares every restored record, and checks SQLite integrity and foreign keys. No HTTP endpoint restores over a live database. `npm run backup` supports remote libSQL logical snapshots as well as the existing local SQLite backup path.
- Removed a legacy startup purge that deleted restaurants/users with a particular brand in their name. Production-process restart smoke tests now provision a similarly named restaurant and verify it survives restart.

## Subscription billing implementation

Restaurant owners have Plan and billing in Settings. Subscription collection is independently gated by SAAS_BILLING_ENABLED and uses separate SAAS_PAYHERE_* credentials. It remains disabled unless explicitly configured. No real charge was initiated by this work.

The recurring checkout uses server-selected plan prices, an approved HTTPS origin and a server hash. Webhook checksum validation is followed by independent OAuth-protected Subscription Manager and Retrieval requests. Unsigned callback metadata, browser redirects and callback payment IDs alone cannot extend entitlement. Only independently retrieved matching RECEIVED payments create unique paid invoice records and add a calendar month. Replays cannot create another invoice. Independently retrieved refunds/chargebacks retain history and mark the contract for review. Verified cancellation stops future provider renewal and preserves the recorded paid period. Expiry after the configured seven-day grace blocks restaurant operations while leaving its owner access to billing.

Configure in Render, not source control:

- SAAS_BILLING_ENABLED=true only after configuration and acceptance.
- SAAS_BILLING_ORIGIN = the exact approved HTTPS origin.
- SAAS_PAYHERE_SANDBOX=true for acceptance testing.
- SAAS_PAYHERE_MERCHANT_ID / SAAS_PAYHERE_MERCHANT_SECRET.
- SAAS_PAYHERE_APP_ID / SAAS_PAYHERE_APP_SECRET for independent retrieval and cancellation.

The prices in lib/plans.js are existing catalogue values, not approved commercial offers. Review prices, taxes, terms, invoice requirements and cancellation/grace policy before enabling collection. Provider domain/IP approval may be required. The agent does not submit real payments or email third parties. Live provider transactions, cancellation, retry and failed-payment handling still require provider-backed acceptance. Automated reminder/dunning delivery, proration, self-service plan switching and re-subscription after cancellation are not complete; these require explicit business rules. Owner UI supports resuming an unchanged pending checkout. Cancelled/review-required contracts need platform support. Do not call this a fully validated billing business.

Primary technical references consulted:

- https://support.payhere.lk/api-&-mobile-sdk/recurring-api
- https://support.payhere.lk/api-&-mobile-sdk/retrieval-api
- https://support.payhere.lk/api-&-mobile-sdk/subscription-manager-api

## Validation and boundaries

The expanded regression suite covers support contact spoofing, private guest access, customer ownership, restaurant isolation, forged reply identities, platform permissions, expiring/revoked access, immutable access audit, finance arithmetic, full isolated restore and overwrite refusal, tracking access, past-due access and protected collections. Subscription tests use a controlled provider stub and test OAuth/retrieval request construction, invoice deduplication, month-end dates, wrong amounts, refund review, cancellation and secret exclusion. These mocks do not prove PayHere connectivity or an approved merchant.

The staging-only cloud checker creates two labelled QA restaurants, places 12 orders with six concurrent workflows, retries each cash settlement twice, checks unique invoices and stock, attempts cross-restaurant mutation, then suspends QA restaurants. It sends no email/SMS and charges no gateway. It is a limited cloud correctness check, not a capacity/availability benchmark. Only report a pass after the actual run succeeds.

A separate browser run checks platform support-session start/end, provisioning, role navigation, mobile layout, reduced motion and app identity. Production smoke checks SQLite, libSQL local file and cash-only startup/restart. Provider, hardware and recovery evidence must stay distinct.

## Safe migration / recovery procedure

1. Export the original PostgreSQL database using its supported read-only backup tooling. Preserve the existing Render service and DATABASE_URL. The branch still does not validate PostgreSQL production operation.
2. Map the source schema into the supported target and document tenant IDs, user ownership, prices, stock, order/payment states, invoice sequences and foreign keys. Do not load PostgreSQL data through the legacy generic import/reset screens.
3. Restore into a separate empty target. Reconcile row counts and record values, settled/refunded balances, invoice identifiers, inventory quantities and open deliveries. A checksum alone does not prove business correctness.
4. Exercise tenant isolation, parallel orders/settlements, tracking, provider callbacks and device workflows against that target.
5. Agree on a cutover window and rollback/forward procedure. Prevent split-brain writes, capture a final delta/backup and verify the destination before switching traffic.
6. Keep the old database recoverable until acceptance. Application rollback alone does not reverse a database migration or a provider payment.

No original production database export/migration or cutover was performed in this revision. A logical staging backup and local restore are not proof of a PostgreSQL production migration.

## Remaining release gates

- Complete every API/role/restaurant permutation, indirect relation, group-cart, chat, report/export and stale/deleted identity case. The added checks close specific gaps and do not certify all legacy routes.
- Verify real PayHere merchant setup and independent sandbox renewal/cancel/refund callbacks. Decide proration, dunning, subscription changes and invoice requirements.
- Prove remote backup retention and recovery after a real replacement; automate off-host backups and alert on missed backups. The free Render local filesystem is not backup storage.
- Rehearse and reconcile original PostgreSQL data migration before replacing production.
- Validate email/SMS delivery with intended test recipients, real printers/local bridges and GPS on real phones. A provider helper or a green UI does not prove delivery.
- Reconcile restaurant sales, taxes, electronic refunds, driver cash custody, platform fees and bank/provider payouts using an auditable financial ledger.
- Add durable outbox/replay and cross-process event delivery before scaling backend instances. Define monitoring, alert destinations, retention, incident response and recovery objectives.
- Choose hosting appropriate to business availability; free sleeping compute cannot provide a live restaurant-service guarantee.

## Hosted evidence for a6e4d9d

- Render deploy dep-dblr4v6i0phs7385v1lg reached live on the free staging service. Both GitHub workflows passed. The original main/production service was not replaced.
- 228 local regression tests passed across 15 files. All three frontend builds and production-process smoke modes passed. Browser tests also exercised the guest support create/private-thread/reply flow and audited platform support start/end.
- A real staging logical backup was exported and restored to a new local database. All 41 tables and 15 records matched exactly; integrity and foreign-key checks passed. SHA-256: 288098dc86dff1151789586eabb0df1da35006cb06e769a68a8e5bf33a89bd3b. This is a small staging recovery drill, not original-production recovery certification.
- The first cloud concurrency attempt stopped during test-owner login on a non-JSON HTTP error; the labelled QA restaurant created during setup was suspended by cleanup. The retry was rejected during administrator login with a tunnel/proxy 403. The concurrent-order stage did not complete, so no hosted concurrency pass or capacity claim is made. The committed checker reports non-JSON responses without exposing response bodies or credentials, and retries only transient authentication 502/503/504 responses.


## Order safety and live-access follow-up

This revision adds 15 regressions, bringing the local suite to 243 tests across 16 files. All three frontend builds, syntax/type checks and selected browser workflows pass. Hosted CI and deployment results must be checked separately for the final commit.

- Dispatch now requires an authorized restaurant staff role and finds both the order and driver in the same restaurant inside one transaction. Assigning a driver preserves pending/preparing kitchen state. Driver management requires owner/manager access.
- A canonical private order-chat router verifies the actual customer account, assigned driver or permitted staff role. It reloads account/driver identity and ignores forged sender fields. Deleted staff/customer and suspended driver credentials are rejected.
- Live streams recheck restaurant, subscription, account, assigned driver and credential expiry before sending subsequent events and on heartbeat. Permission loss ends the connection. This is process-local delivery; there is still no durable replay/outbox or multi-instance event bus.
- Customer cancellation and feedback require private order access. Payment checkout/hash initiation also requires private order access. The AI concierge directs tracking/cancellation requests to that authorized workflow rather than inspecting or cancelling orders by ID/contact matching.
- Online, counter, offline and group orders reserve menu and recipe ingredient quantities through the same transactional primitive. Saved recipe requirements make a reversal independent of later recipe edits. Edits release/re-reserve within the same transaction, and concurrent rejection/cancellation retries return stock once. Insufficient ingredients roll back the order and all stock changes. Refunds still do not automatically restock food. This ledger covers these order reservations/reversals and outgoing stock approvals, not every historical/direct stock adjustment.
- Historical orders without an inventory snapshot fail closed on editing/reversal and require explicit inventory reconciliation. No inventory snapshot is fabricated from today's recipes. New recorded loyalty reservations are returned once on eligible unpaid cancellation; historical loyalty and provider refunds still require reconciliation.
- Shared carts use random, restaurant-bound, 24-hour invitation IDs, private participant capabilities and a separate private host capability. Only the host can check out. The normal public order pricing, delivery rules, payment gate, plan checks and stock transaction are reused. A conditional cart claim prevents concurrent duplicate checkouts; failed checkout rolls back the claim. The customer UI now supports host pickup/cash checkout, private tracking and leaving the group. Group delivery can use the validated API but does not yet have the full UI checkout form. A lost confirmation after a successful claim still needs private order recovery rather than blindly creating another order.
- Both staff creation endpoints share an atomic seat-limit/username check. Production staff creation requires an explicit password of at least 12 characters and a private PIN. Public ordering rechecks the restaurant's monthly limit under the write lock. Broader plan-metering coverage remains part of the full route audit.
- Outgoing ingredient transfers reject negative/foreign quantities and require an owner/manager. Approval conditionally deducts available stock once; it does not silently clamp shortages to zero or credit an independently owned restaurant.
- Restaurant discovery now derives opening state, names, addresses and review counts from actual data. Invented reviews, offers and coordinates are removed. Unconfigured locations stay unknown; final delivery prices are checked at checkout.

Additional local evidence: real HTTP tests cover stock/loyalty rollback and retries, cross-restaurant dispatch/chat, deleted identities, shared-cart host/participant isolation, simultaneous checkout, seat contention, transfer shortage, offline replay and real storefront metadata. A phone-width browser run exercises private group creation, adding an item, host pickup checkout and a refreshable private tracking workflow without exposing the capability in the URL. The platform/support browser checks continue to pass.

This work does not remove the remaining release gates above. In particular, original production migration, successful hosted concurrency, real payment/subscription lifecycle, operational notifications/printers/GPS, off-host backup automation, full financial reconciliation and availability validation are still required before live business dependence.


## Checkout recovery follow-up

Ten additional HTTP regressions bring the local suite to 253 tests. Public checkout now accepts a private `Idempotency-Key`, stores only its digest and binds it to the restaurant, request and customer identity. The record commits with the order, inventory and loyalty changes. Concurrent retries return the same saved order and original amounts; changed requests conflict. Recovery runs before mutable stock/pricing/loyalty and capacity checks, and returns current payment/order state. Failed transactions retain no successful recovery record. The customer UI preserves a pending checkout in session storage across a lost response/reload and offers recovery before a separate order. Legacy API clients without a key are not automatically protected.

Private group hosts can retrieve an already checked-out group's order, including when simultaneous checkout requests race. Only the same private host can recover it. The expiry still applies. New orders are blocked when the restaurant is closed, while an existing order remains recoverable. Profile responses include the stored phone-verification flag so the checkout uses the actual verified account state.

The PayHere window callback now polls server payment state before announcing confirmation. Missing checkout SDK support opens the server-authorized redirect flow instead of reporting success from a generated hash. Real merchant acceptance remains unverified; no gateway charge was performed.

The ordered next steps and required private account/device access are documented in [PRODUCTION_LAUNCH_PLAN.md](PRODUCTION_LAUNCH_PLAN.md). This follow-up does not clear the production launch gates by itself.

Checkout recovery browser evidence: a phone-width browser placed an order, deliberately lost the response after the server committed, reloaded, and recovered the same order. The database contained one order for that customer and one stock deduction, with no browser runtime errors. This local fault-injection check does not replace hosted concurrency acceptance.
