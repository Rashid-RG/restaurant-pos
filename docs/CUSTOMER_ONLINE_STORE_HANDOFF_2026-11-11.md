# Customer Ordering & POS Online Store — Release Handoff
**Review:** 11 November 2026 · **Branch:** `codex/production-readiness`

## Owner workflow now in source

**POS navigation → Online Orders** is now separate from **New Sale** and **Dispatch**. It filters the authenticated restaurant's existing `orders` data to `source='online'` and provides:
- New/pending, preparing, ready, completed and cancelled queues
- Customer name/phone, order reference, purchased items, total, payment method
- Scheduled time in the restaurant's configured time zone
- Existing back-end owner/staff actions: accept, reject with reason, update preparation ETA
- Direct handoff to Kitchen or Dispatch for fulfillment
- Refresh, background periodic refresh and searchable order cards

**Settings → Online Store** already provides opening/closing, delivery configurations, preparation times and shop GPS; the updated branch adds **scheduledOrdersPerSlot** (1–100, default 6) and an owner setup/preview guide.

Existing regular POS sales are still processed using **New Sale**. Online Orders does not replace or duplicate existing orders, ledger records, payments or staff roles.

## Customer improvements added in this release

| Area | Source behavior | Deployment/acceptance |
| --- | --- | --- |
| Scheduling | Authenticated tenant public API offers 15-minute slots over the next 48 hours, remaining capacity, and validates capacity again in the same database transaction as creation. Future scheduled delivery orders do not auto-dispatch immediately | Needs opening-hour/day-capacity policy and operational check for preparing/dispatching future orders at the right time |
| Notifications | New tenant-scoped push subscription storage, tracking-token protected opt-in endpoint and web-push delivery on order changes | **Requires real VAPID environment keys, HTTPS, browser permission and real device tests.** No VAPID keys → no push activation; live tracking remains |
| GPS & tracking | Existing SSE/polling updates, map, driver chat and ETA. Corrected “paid” not being mistaken for “delivered”; clearer GPS status, map proximity disclaimer, localized customer status | GPS depends on driver app permission, network and genuine driver pings. Dotted line is **not road directions**. Verify privacy and SSE auth end to end |
| Offline | Only a bounded, expiring (24-hour), per-tenant **public menu** snapshot and local cart; offline checkout is blocked. Online checkout still checks actual stock, price and availability | **Not unattended offline order submission**; do not queue money-moving orders without explicit confirmation |
| Locales | Expanded English/Sinhala/Tamil dictionaries for scheduling, cash/bank payments and tracking, with key screen labels translated | **Not 100% localized**: some legacy screen strings, accessibility labels and merchant-authored dish descriptions remain untranslated |
| Payments | Cash and manual bank transfer are customer-selectable; card/PayHere is visible but disabled by default; no fake saved card entry | Real PayHere merchant integration, bank instructions/receipt verification and LankaQR still require provider configuration or implementation |
| Design | Responsive premium styles, light animation, large touch actions, tracking and map presentation, focus visibility, reduced-motion preferences | Needs visual QA on actual low-end Android, iPhone, tablets and desktop at multiple font sizes |

## Configuration

- `CUSTOMER_CARD_PAYMENTS_ENABLED` is **off** unless set to `true`; enabling requires a verified PayHere merchant/sandbox integration.
- For browser push, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_CONTACT_EMAIL` as secrets in the running environment. Create keys with an approved `web-push` workflow. Do not commit private keys.
- Owner slot setting: `scheduledOrdersPerSlot` in existing tenant settings. This is saved without a destructive schema migration.
- Database startup creates the new additive `customer_order_push` table automatically **on deployment**. It does not create an off-host backup.

## Production gates

1. Verify a **recoverable off-host Turso backup** before deploying schema/init changes, especially because some older historical startup migrations are not trivially reversible.
2. Validate two-restaurant isolation for owner inbox, scheduling, order tracking, and push subscriptions.
3. Run scheduled-slot contention tests with parallel checkout submissions; test slot full, cancellations, timezone, future dates and prep lead time.
4. Test real customer, kitchen and driver devices: GPS permissions, stale locations, SSE reconnect/poll fallback, push permission denied/allowed, service-worker upgrade and weak mobile data.
5. Test manually verified bank transfers; avoid treating an unpaid order as paid or settled.
6. Complete **full Sinhala/Tamil content audit** of all legacy labels and merchant-authored content.
7. Release only after storefront/kitchen/dispatch acceptance and post-deployment log checks. Current automated tests and builds do **not** prove all real-world integrations.

**No Render deployment or live database write was performed by this documentation/feature update.**
