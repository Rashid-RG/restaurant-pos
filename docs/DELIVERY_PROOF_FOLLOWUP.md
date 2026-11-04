# Delivery proof follow-up

This follow-up updates the delivery-proof findings in the original comprehensive review. It is draft code on the same pull request; the existing Render service has not been changed.

## Completed behavior

- Only the assigned, authenticated driver can complete a delivery. Driver status updates cannot modify kitchen states, revive cancelled orders or skip straight from preparation to delivered.
- Completing a delivery requires a signature or photo. PNG/JPEG evidence has strict encoding, byte-size, raster-header and dimension limits. The browser converts camera photos to a bounded JPEG and removes camera metadata during re-encoding.
- Evidence, tenant, driver, saved timestamp, SHA-256 hashes, delivery state and COD settlement commit in one database transaction. A settlement failure rolls back proof and delivery status together.
- Cash completion requires an explicit collection acknowledgement. Online payment must already be verified. Driver order cards distinguish verified payment from cash still to collect.
- Duplicate completion requests return the original save receipt; they do not overwrite evidence or allocate a second invoice.
- The modal stays open during saving and after an error, retaining captured evidence for retry. It closes only after a saved-proof receipt is returned.
- Completed deliveries offer a private proof viewer. Legacy deliveries show that no proof was recorded.
- Evidence is retrievable by the assigned driver or an authenticated owner/manager in the same tenant. It is not included in public tracking or bulk order lists, and proof responses forbid caching.

## Storage and access

The `delivery_proofs` table stores bounded images with one immutable record per order. It uses the configured durable database rather than a local upload directory. Maximum decoded image sizes are 128 KiB for a signature and 512 KiB for a photo; dimensions are bounded at 2048 pixels. Raster header checks do not constitute full image decoding or malware scanning.

Driver: `GET /api/public/driver/orders/:id/proof`. Manager/owner: `GET /api/orders/:id/delivery-proof`. Staff proof access currently has an API endpoint; a dedicated staff review screen remains future work.

Evidence is retained in memory while the capture modal remains open after a failed request. Closing the modal or reloading before saving loses unsaved captures. There is no offline proof queue or background upload yet. Customer consent, operational retention/deletion rules, cloud quotas, remote backup and restore, and real-device camera/permission tests remain release tasks. No recipient identity verification or guarantee of genuine delivery can be inferred solely from a signature or photo.

## Validation

The HTTP regression suite covers authentication, assignment and tenant restrictions, missing evidence/cash acknowledgement, invalid/oversized images, lifecycle/payment gating, concurrent duplicate requests, private retrieval, history metadata, prepaid photo-only delivery and transactional rollback/retry on settlement failure.

The mobile browser exercise checks photo conversion, required evidence, failed-save retention, successful retry, cash settlement, saved-proof viewing and reload persistence. It reports no page errors or horizontal overflow at 390 px. The combined follow-up passes 169 automated tests, production restart smoke checks and all three app builds. Actual cloud persistence still requires validation.

The older CI workflow now uses Node 24 and a single test worker, matching the project's engine and new verification workflow. The previous commit's Verify job passed on GitHub.
