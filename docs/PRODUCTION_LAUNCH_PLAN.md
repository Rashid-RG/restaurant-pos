# GastroFlow production launch plan

The current release is a staging candidate. Passing automated tests does not authorize a production-data cutover or establish that external services and devices work.

## Next target

Prepare a supervised cash/manual-bank pilot with two independently owned test restaurants, then clear the gates below. Keep gateway collection and automatic SaaS charging disabled until their separate acceptance tests pass. The existing production service and database remain recoverable during this work.

| Order | Gate | Evidence required | Remaining access or input |
|---|---|---|---|
| 1 | Checkout recovery | Lost response, reload and concurrent retries return one order; stock and loyalty change once; group host recovers the same order | Code and local automated tests are included in this revision; verify final hosted deployment |
| 2 | Hosted tenant concurrency | Two restaurants order and settle concurrently with unique invoices, correct stock and no cross-tenant data | Valid staging test credentials supplied through private environment variables; run the existing staging-only checker from an authorized environment that can reach the service |
| 3 | Production-data migration | Read-only source export; isolated target restore; reconcile tenant ownership, every record, invoices, balances, stock, open orders and delivery assignments | Access to a supported export of the existing production PostgreSQL database; do not replace DATABASE_URL or import over the live service |
| 4 | Automated recovery | Private off-host backup, failure alert, retained copies and a timed restore to a replacement target | Private storage destination and its credentials; confirm retention and recovery goals. Existing staging restore evidence covers a small manual snapshot only |
| Deferred | Online payment and subscription acceptance | Independent provider notifications; duplicate and delayed callbacks; renewal, failed collection, cancellation and refund reconciliation | Merchant sandbox configuration. Real payments and automatic restaurant charging remain off until accepted |
| 6 | Notifications | Intended test customer receives the correct message once; provider failure and retries are visible | Configured sender/provider and explicit test recipient details; no real messages should be sent to arbitrary contacts |
| 7 | Restaurant and driver devices | Counter checkout, kitchen workflow, printer/bridge, delivery assignment, real-phone GPS, offline/reconnect and proof upload | Printer model/connection, a test printer/local bridge and test phones |
| 8 | Operations | Actionable error/backup alerts, measured latency, incident procedure and agreed recovery objectives | Alert destination and responsible operator; hosting must meet the agreed availability requirements |
| 9 | Controlled cutover | Final reconciled backup/delta, no simultaneous writes to old/new systems, smoke checks and rollback decision | Operator acceptance of the measured results and a cutover window |

## Run the limited hosted correctness check

`scripts/cloud-concurrency-check.py` permits only the named staging URL and requires `CONFIRM_STAGING_LOAD_TEST=1`. It provisions labelled QA restaurants, runs twelve orders with six concurrent workers and settlement retries, verifies invoices/stock/isolation, and suspends the QA restaurants afterward. It does not charge a gateway or send notifications.

Supply `STAGING_URL`, `STAGING_USERNAME`, `STAGING_PASSWORD` and `CONFIRM_STAGING_LOAD_TEST` through private process environment variables, then run `python scripts/cloud-concurrency-check.py`. Do not put credentials in chat, command arguments, committed files or public logs. A tunnel/proxy error is a failed connectivity precondition, not a passing concurrency result. Do not weaken network controls to run the test.

This small check is not a capacity or uptime benchmark. Public-order, driver, report/export, support, subscription and recovery concurrency still need broader acceptance coverage.

## Checkout recovery contract

The customer checkout saves one private recovery key and its request in browser session storage. `Idempotency-Key` carries that key on each retry. The server stores only the key digest, scopes it to the restaurant and binds it to the normalized request and owning customer identity. A conflicting request returns 409. The recovery row commits with the order, ingredient/menu reservation and loyalty deduction. Recovery returns the current status and original receipt without repricing or reserving stock again.

The customer can recover a previous checkout after a lost response or reload. It is not safe to clear the recovery and submit a replacement without checking the existing order. Session recovery is limited to that browser session; the private tracking access or authenticated account is still needed on another device. Older API clients without an idempotency key retain their legacy behavior and do not gain retry guarantees automatically.

A private group host can recover a checked-out group's confirmation. Participants and other restaurants cannot use this access. The group's normal expiry still applies.

Payment-window completion is a hint, not payment confirmation. The customer UI checks the authoritative order payment state before announcing confirmation. This UI correction does not substitute for real merchant lifecycle tests.

## Existing implementation limits

Historical orders without inventory snapshots need explicit reconciliation before stock reversals. Complete subscription changes/proration/dunning, durable event replay, multi-instance event delivery, comprehensive financial settlement and electronic refund operations are still release work. See [SAAS_RELEASE_GATES.md](SAAS_RELEASE_GATES.md) for the full evidence and limits.

## Responsive interface acceptance

The latest interface follow-up covers the POS/admin, customer and driver apps at eight phone/tablet/landscape/desktop sizes. See [DEVICE_RESPONSIVENESS.md](DEVICE_RESPONSIVENESS.md) for the measured checks. Browser viewport checks are distinct from the physical-device gate above.


## Current service increment

See [CASH_BANK_SERVICE_READINESS.md](CASH_BANK_SERVICE_READINESS.md) for the cash/bank ledger, kitchen fulfillment, Safari fix and current validation. The user confirmed existing production data is real and must be preserved, and has not chosen a printer. The current environment has no staging/source database credentials. Hosted contention, original-data recovery, provider and actual-device gates remain incomplete.
