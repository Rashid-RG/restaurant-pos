# Cash and manual-bank service candidate

5 November 2026. This revision is a staging candidate, not approval for real-business dependence. Online gateway collection and automatic SaaS charging remain disabled for the intended first release.

## Delivered workflows

**Saved receipts and balances.** POS → Open bills / cash & bank lists saved bills and their authoritative remaining balance. Cash / Bank / Portions saves the cart before collecting money. Each received amount commits immediately in an immutable tenant-scoped ledger. A private request ID binds a retry to its original order, amount, method and bank reference. Concurrent overcollection is rejected. A lost response is recoverable from the browser's saved request, and paid bills have a final receipt view. Session recovery is local to the same browser session; the saved bill remains available to another authorized staff member.

Cash collection requires an open cashier shift. Bank receipts require an owner/manager to confirm that funds arrived in the restaurant account and provide a unique transaction reference. This is an audited human assertion, not bank API verification. A screenshot or pending transfer is not confirmation. Mixed cash/bank amounts settle once when their sum reaches the server total. Loyalty and final invoice allocation run once at settlement. Part-paid orders cannot be edited, cancelled, rejected or paid again through the legacy full-payment route. Gateway initiation is blocked for bills with manual receipts.

**Cash drawer attribution.** Partial cash receipts belong to the cashier and shift that actually collected them, including when another cashier completes the bill later. Shift close excludes the full order total for bills already represented in the receipt ledger, preventing double counting. Bank receipts stay outside expected drawer cash. Shift summaries separate recorded bank receipts from cash received. Full financial/provider reconciliation is still a separate gate.

**Recall.** Recalled bills retain their original order identity, item/menu identity, modifier selections and stock reservation. An edit updates the saved ticket instead of creating a replacement order. Kitchen-started tickets and paid/part-paid bills are protected against destructive repricing.

**Kitchen fulfillment.** Kitchen service is persisted separately from the legacy payment status. Payment does not hide unfinished food. Owner/manager station routing explicitly maps new items to Hot kitchen, Bar & drinks or Desserts; existing tickets retain their station. Each line has pending, preparing and ready state, modifier details and preparation notes. Version checks reject stale simultaneous actions. Every line must be ready before serving. Delivery handover is confirmed by the assigned driver's pickup/start-delivery action. A prepaid cash delivery does not request collection again. The board polls every ten seconds as well as refreshing with staff order state.

Open legacy tickets can be imported to the kitchen board. Historical paid tickets are not inferred as new cooking work. Payment on an open legacy ticket first captures its fulfillment record. Paid dine-in tables stay occupied until food is served; new simultaneous bills cannot overwrite an occupied table's active bill. Table merge remains disabled.

**Safari crash fix.** Customer menu live updates now use the current application origin, eliminating the production fallback to insecure localhost. EventSource construction failures are caught. A visible 15-second polling fallback keeps the storefront usable and refreshes menu/rates after missed events. This includes the exact SecurityError shown in the user's screenshot.

## Evidence

- 316 automated tests across 19 files pass, including 22 daily-service tests and six customer live-update tests. Checks cover cross-owner access, duplicate/changed payment requests, overcollection, manual bank confirmation, per-cashier shifts, station snapshots, stale kitchen revisions, paid ticket visibility, delivery pickup, table claims and recalled modifier identity.
- Syntax and TypeScript checks and builds for all three apps pass. Production process restart checks pass for SQLite, local-file libSQL and gateway-disabled cash mode.
- Chromium interaction check: partial cash response deliberately lost after commit → reload → recovery of one receipt → manager bank settlement → prepaid kitchen preparation → all lines ready → serve. Recalling a held order keeps one original bill and does not deduct stock twice.
- Payment dialog and kitchen board checked at 320, 768, 844 landscape and 1920 pixel widths. A separate browser injection of Safari's EventSource SecurityError leaves the storefront running with a visible polling status and no runtime error.
- A populated local logical backup restored all **54 tables and 121 records** with exact record matching, foreign-key validation and integrity checks. SHA-256: `16527c5200cc8f17f744f9f3ca49eb4c209a3e044dabc48f225798ee643c878f`. It includes payment and kitchen records and their schema. It is **not** an export or restore of the user's existing production data.

## Outstanding gates — do not mark complete

| Gate | Evidence or input still missing |
| --- | --- |
| Original production data | User confirmed real data must be preserved. Need a private read-only PostgreSQL export, a reviewed mapping to the target schema, reconciliation of records/balances/invoices/stock/tenant ownership, and a separate restored target. No live data has been overwritten. |
| Hosted concurrency | No staging credentials are present in this execution environment. The earlier cloud attempt failed before its concurrency stage. Run the staging-only checker with privately configured credentials, then extend acceptance to manual receipt and kitchen contention. Local transaction tests are not a hosted pass. |
| Printer | No model/connection selected; USB/Bluetooth or network is under consideration. Browser print controls do not prove paper output. Verify receipt width, item notes, kitchen routing, disconnect/retry and duplicate-print behavior on the actual setup. |
| Physical mobile | Test the updated storefront on the user's iPhone/Safari, then payment/dialog navigation and actual Android/iPhone driver GPS, camera, permissions and reconnect. Simulated viewports are not device certification. |
| Notifications | Configure a sender/provider and an explicit consenting test recipient. Verify successful delivery and visible retry/failure handling. No real messages were sent. Current notification delivery is not a verified durable outbox. |
| Recovery/monitoring | Configure private off-host backup storage, retention, alerts and an operator response process; repeat timed restore against actual production data and establish measured recovery objectives. |
| Remaining billing edge cases | Partial-receipt reversal, mixed/bank refund reconciliation, and safe table merge are not delivered. Started kitchen ticket amendments require an explicit reconciliation workflow. Do not offer these as complete functionality. |
| Cutover | Only after the above gates: final reconciled snapshot/delta, controlled write pause, operator acceptance, target smoke checks and rollback decision. Keep the original service/database recoverable. |

## Practical acceptance sequence

1. Reload the deployed customer app on Safari and confirm the menu opens without the red error page.
2. On staging, use labelled test restaurants and test amounts only. Open cashier shifts, collect partial cash, reload, complete via verified-test bank reference and reconcile each drawer.
3. Exercise a multi-station order, pay before cooking, verify it stays visible, prepare each line and serve/pick up. Test a second device acting on an old revision.
4. Provide the existing production export through a private file attachment or approved database connection. Do not paste passwords or database tokens into chat.
5. Complete hardware/provider/hosted acceptance and production-data recovery before authorizing cutover.
