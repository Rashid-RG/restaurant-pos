# Billing review and fixes

This follow-up reviews the shared billing engine, actual staff checkout and refund endpoints, customer checkout estimates, delivery cash settlement, offline repricing, split tender, invoices and cashier shift closure. It extends the original review snapshot. Changes remain on a draft pull request and have not been deployed to the existing Render service.

## Fixes in this draft

| Area | Result |
| --- | --- |
| Item pricing | Server menu and modifier prices determine the bill; unknown and duplicate modifiers are rejected rather than silently dropped or charged twice. |
| Input validation | Malformed discounts, non-finite tips/fees, negative delivery fees and invalid rate/promotion configuration cannot produce accepted totals. |
| Receipt arithmetic | Monetary components round to cents before subsequent calculations; displayed subtotal, discounts, service charge, tax, tip, delivery and rounding adjustment reconcile to the saved total. The existing final whole-unit rounding policy is retained. |
| Staff delivery fees | An authorized staff-entered fee is validated, included in pricing and saved with delivery contact details. Public customer fees continue to use the server delivery calculation. |
| Tender checks | Manual cash/card/split tenders must match the saved order total in cents. Negative, over-precise, missing split portions and embedded unverified gateway payments are rejected. Card means an external terminal payment recorded by staff, not an automatic card charge. |
| Settlement | The order is re-read inside the transaction. Concurrent retries return one invoice and award loyalty once. Kitchen users cannot settle payments, and gateway orders cannot be converted to paid by supplying a cash method. |
| Settled-order protection | Paid pending orders cannot be repriced, cancelled or rejected through the ordinary open-order controls. Status-only requests cannot rewrite tips or tender records. |
| Refunds | Authorized cash refunds have a stable request ID and journal record. Retrying the same request does not issue another refund; concurrent refunds cannot exceed the remaining balance. |
| Stock on refunds | Refunding money does not automatically return prepared food to stock. Physical stock adjustments remain a separate operator action. |
| Rejection retries | Rejection and stock restoration are transactional and repeatable without restoring the same items twice. |
| Cash drawer | Closure uses this cashier's settlement time, includes the cash part of split tenders and shift cash movements, subtracts journaled cash refunds and preserves an actual cash count of zero. Duplicate shift handlers have been removed. |
| Staff checkout | Captured request IDs survive a retry while the current intent remains in memory, duplicate submit buttons are guarded, cash shortfalls are rejected and receipts use returned server values. Change displayed after checkout uses the paid receipt total even after the cart has been cleared. |
| Even portions | Portions allocate integer cents so their sum matches the bill; a remainder is distributed explicitly. |
| Manager PIN | Refund and POS PIN inputs accept the six-digit production PIN. |
| Delivery proof | See the separate delivery-proof follow-up: evidence and COD completion commit together. |

## Validation

169 automated tests pass across 11 files, including shared calculation tests and new HTTP scenarios. The HTTP tests exercise spoofed prices, modifier and delivery pricing, malformed tender amounts/methods, tip mutation, cash/card split portions, kitchen authorization, gateway bypass, concurrent settlement, single loyalty/invoice allocation, paid-order protection, refund retry/conflict/races, duplicate rejection and cashier drawer reconciliation.

The rounding example `199.99 × 3`, with configured 10% service charge and 8% tax, saves subtotal `599.97`, service charge `60.00`, tax `52.80`, rounding `0.23` and total `713.00`. These are test settings, not a statement of applicable tax law.

All three frontend bundles, backend syntax checks, TypeScript checks and production restart smoke tests pass locally. Browser checks cover actual staff checkout and delivery-proof error/retry behavior. Provider transactions are not simulated as proof of real payment processing.

## Remaining release gates

- Table merging is temporarily disabled: its former proportional calculation could discard service charges or discounts. Keep tickets separate until merge uses a validated pricing and inventory contract.
- Sequential diner-portion collection is still client state until final settlement. It is not a durable partial-payment ledger; do not depend on it for recovery after browser closure. Standard complete split-tender settlement has server validation.
- Electronic and mixed-tender refunds require provider reconciliation and remain blocked in the cash-refund endpoint. There is no live gateway refund integration in this change.
- Card terminal receipts, real PayHere sandbox callbacks, chargebacks, reversals and refund confirmations need provider-backed acceptance tests.
- Cash handover from a driver needs a dedicated cash-custody ledger and reconciliation. Driver-collected COD is not treated as cashier drawer cash before handover.
- Ingredient movements must be unified across every order, modification, cancellation, refund, offline and group-cart path. Financial refunds intentionally do not imply food restocking.
- Reports and exports still need end-to-end verification of gross versus net sales, refund dates, mixed tender, shift attribution and historical data. Shift summary/X-report screens may still use legacy gross-sale aggregation; the revised close-shift calculation is the authoritative tested closure path.
- Existing discounts and charges are monetary snapshots, but a complete versioned quote and tax-rate history, immutable general ledger and durable customer checkout idempotency are future work.
- The proof and refund journals require durable database configuration, migrations, backup/restore validation and operational retention rules. Remote cloud behavior remains unverified locally.

Passing the local suite establishes the tested scenarios. It does not establish complete financial certification or a completed production rollout.
