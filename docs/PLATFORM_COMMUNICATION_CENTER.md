# GastroFlow — Platform Communication Center

## Scope and status (2026-11-20, continued)
Owner-targeted in-app communication foundation on `codex/production-readiness`. Not yet approved for commercial launch. No Render deploy in this change.

### Implemented foundation
- Dedicated Platform Owner Communication Center tab and composer.
- Draft creation, recipient preview, active-restaurant owner targeting, publish, cancel, owner-only inbox and acknowledgments.
- Tenant + user keyed recipient records, bounded inbox queries, audit events and read/acknowledgment counts.
- Platform template library (create/list/delete) and template selection in the composer.
- Versioned policy/disclaimer messages with required acknowledgment, SHA-256 content fingerprint, and atomic draft/version/audit writes.
- UTC scheduled publication in an additive schedule table, 30-second staging dispatcher after database readiness, current eligibility recheck, restart recovery, and cancellation before dispatch.
- Durable, idempotent per-user/per-tenant/channel in-app delivery ledger with delivery status shown on platform reports. These are inbox insertion events, **not** proof of human reading or provider delivery.
- Scheduling UI accepts local date/time, converts to UTC epoch for backend validation, and stores execution times independently of browser state.
- Platform owner access enforced by the existing platform_ownership table; both feature gates required for platform and owner routes.
- Existing basic platform-wide broadcast feature remains separate and unchanged.
- Explicit gates: `PLATFORM_COMMUNICATIONS_ENABLED=true` AND `PLATFORM_COMMUNICATIONS_STAGE=staging`. Without both, endpoints return 404 and schema initialization is not invoked.
- No email/push sending or staging customers contacted from this module.

### API endpoints
Authenticated platform owner:
- POST `/api/platform/communications/preview` with `{ "audience": {"scope":"all","tenantIds":[]} }`
- GET/POST `/api/platform/communications/templates`: list/create reusable templates.
- DELETE `/api/platform/communications/templates/:id`: delete a reusable template.
- POST `/api/platform/communications`: create validated draft (policy/disclaimer requires `policyVersion` and acknowledgment).
- GET `/api/platform/communications`: list.
- POST `/api/platform/communications/:id/publish`: transactional snapshot of currently eligible owners.
- POST `/api/platform/communications/:id/schedule`: schedule a draft with `scheduledAt` (UTC epoch milliseconds).
- POST `/api/platform/communications/:id/cancel`.
- GET `/api/platform/communications/:id/report`.

Authenticated restaurant owner (only own user+tenant):
- GET `/api/owner/communications`
- POST `/api/owner/communications/:id/read`
- POST `/api/owner/communications/:id/acknowledge`

### Remaining commercial acceptance gates
1. Re-run CI verification for the latest commit, including all app builds and isolated DB boot; run `npm run check`, `npm test`, `npm run build:all`.
2. Integration tests against actual libSQL schema with active, suspended, deleted, platform, multiple-owner, and multi-tenant cases; cancellation races; duplicate publish retries.
3. Scheduled in-app publication is implemented, but validate clock drift, concurrent workers, and retry cases; add reliable email/push delivery jobs, idempotency and dead-letter queues.
4. Templates, attachments, signed media, multilingual English/Sinhala/Tamil; content sanitization, size/accessibility review.
5. Versioned legal disclaimers and immutable consent evidence; consent vs notice acknowledgment review by counsel.
6. Email and native push integration using staging-only sandbox recipients, opt-out rules, quotas and provider failure/retry handling. External channels are NOT activated by the current in-app ledger.
7. Audit log immutability, publishing approvals, emergency stop, metrics, delivery analytics, recipient opt-out compliance.
8. Distinct channel permissions and tests for customer/driver/manager audiences; owner targeting must never implicitly expand to them.
9. Reconcile existing global broadcast UI and avoid conflicting urgent banners.
10. Verify staging uses a separate Turso database before migration approval. Back up and test restoration. Never deploy to production or run destructive changes.

### Sandbox email delivery foundation
- Queue code lives in `lib/communications/platform-email-queue.js`; staging queue table and admin queue endpoints live in `routes/platform-communications.js`.
- Email queue is disabled unless ALL are configured: `PLATFORM_COMMUNICATIONS_ENABLED=true`, `PLATFORM_COMMUNICATIONS_STAGE=staging`, `PLATFORM_COMMUNICATIONS_EMAIL_ENABLED=true`, `PLATFORM_COMMUNICATIONS_EMAIL_MODE=sandbox`, and `PLATFORM_COMMUNICATIONS_TEST_EMAILS` containing explicitly approved, comma-separated testing addresses.
- The UI's **Queue allowed sandbox emails** action only creates queued records; it never sends.
- The injected-provider worker is not mounted in server startup. No live, automatic or transactional emails are delivered by this change. It must first be connected to an explicit staging sandbox provider and tested.
- All queued addresses must match the exact allowlist, and the worker rechecks current owner membership, tenant status, announcement publication and expiration before calling the sandbox transport.
- After a provider timeout or other ambiguous failure, work is marked `manual_review` rather than automatically retried; safe retry policies require provider idempotency contracts.
- Interrupted `sending` claims can be moved to `manual_review` via platform-only reconciliation, with no automatic resend. A reviewer can close a specific tenant/user/announcement claim as failed without invoking any transport.
- Recovery endpoints: `POST /api/platform/communications/email-queue/reconcile` and `POST /api/platform/communications/:id/email-queue/:tenantId/:userId/close-review` (both gated by the sandbox allowlist).
- Queue insertion, HTTP inbox delivery and provider acceptance are separate statuses. Provider acceptance is not evidence of inbox arrival or human reading.
- Never use actual customers' email addresses in the allowlist during staging.
- Future steps: dedicated controlled worker, stale sending reconciliation, delivery webhooks, permanent failures and backoff, unsubscribe/transactional-message policy, bounce suppression, quotas, isolation and load tests.

### Read-only email dry run and delivery review (November 20, 2026)
- Platform Owner action **Dry-run sandbox delivery eligibility** checks the bounded queued batch (up to 100 entries by default). It rechecks live tenant status, owner membership, publication/expiry and exact email allowlist without changing the database or invoking any sender.
- Results expose aggregated eligible/blocked counts and reason codes only; recipient addresses are not returned.
- `GET /api/platform/communications/:id/email-queue/preview`: dry-run counts with `dryRun:true,sent:0`.
- `GET /api/platform/communications/:id/email-queue/reviews`: platform-only list of uncertain sending outcomes, without email addresses.
- The UI allows explicitly closing a specific review record as failed. It does not retry or send mail.
- All operations require the preexisting staging module gates; dry-run and review endpoints additionally require the sandbox-email allowlist gate.
- A dry run is **not** a provider send, deliverability verification, real-time customer delivery, or permission to use real customer addresses.

### Explicit Brevo sandbox provider adapter
- `lib/communications/platform-brevo-sandbox.js` provides an injected sandbox-only Brevo transport interface. It does not register a server timer, REST send endpoint, or automatic worker and therefore does **not** send mail on deployment.
- In addition to every existing communications and email sandbox gate, require `PLATFORM_COMMUNICATIONS_BREVO_SEND_ENABLED=true` and `PLATFORM_COMMUNICATIONS_EMAIL_TRANSPORT=brevo_sandbox`. The adapter also requires Brevo credentials and a configured sender.
- Read-only platform-owner endpoint `GET /api/platform/communications/email/status` and UI readiness indicator summarize configured gates and test-recipient count without disclosing recipient addresses or secrets. It never triggers delivery.
- The adapter is **not mounted to an automatic job or manual-send route**; only a future separately approved test runner should inject it into the queue worker. Provider HTTP acceptance and actual mailbox delivery remain separate statuses.
- Every destination is checked against `PLATFORM_COMMUNICATIONS_TEST_EMAILS` again immediately before the provider call. A mismatched recipient cannot invoke the provider.
- Unit tests inject a fake HTTP fetcher. They must never contact the external Brevo API or send customer email.
- Brevo HTTP success represents **provider acceptance**, not delivery to a mailbox or human reading. Do not describe `accepted` as verified mailbox delivery.
- The existing queue state uses a legacy `deliveredAt` column to represent provider acceptance; that naming should be corrected through an additive schema update and a provider webhook process before commercial release.
- Before any real sandbox trial: confirm **separate staging database**, test-address ownership, verified sender, sending quota, duplicate prevention and approval to turn on the provider gate. No production/live broadcast is approved.

### Multilingual restaurant-owner notices (English / Sinhala / Tamil)
- The Platform Owner can attach **human-written** Sinhala (`si`) and Tamil (`ta`) title and body to each new English announcement. Partial translations are rejected in the composer; the server uses strict field and size validation.
- Approved translations persist in a separate additive `platform_owner_announcement_translations` table, written in the same draft-creation transaction. No automatic AI translation is performed.
- Restaurant owners can select English / සිංහල / தமிழ் in the inbox. `GET /api/owner/communications?lang=en|si|ta` uses a server-side language allowlist with bound SQL parameters. It never takes tenant/user identity from a query parameter.
- Where a requested translation is missing, the API returns the English original with `contentLanguage:'en'` and the owner UI explains the fallback.
- The original English text remains the canonical content for existing `policyVersion` and `contentHash` records. Legal reviewers must approve all translated versions before using them for binding consent. Translation fingerprints, version-specific legal consent and approval workflow remain future release gates.
- Staging sandbox email composition currently uses the original English message only; translated email delivery is not implemented.
- Translation fields are optional for compatibility with preexisting drafts and messages. No existing data is overwritten or deleted.

### Translation approval and acknowledgment evidence
- Sinhala/Tamil text can be entered when a draft is created, but **owners receive English until an authorized platform owner explicitly approves each translation**.
- Platform endpoints: `GET /api/platform/communications/:id/translations`, `POST /api/platform/communications/:id/translations/:locale/approve` and `POST /api/platform/communications/:id/translations/:locale/revoke`.
- Approvals are stored separately in `platform_owner_translation_approvals` with reviewer ID, approval timestamp and a SHA-256 fingerprint of the approved locale text. Revocation makes the owner inbox fall back to English. No existing translation text is deleted.
- Owner acknowledgment now records an additive, tenant-scoped evidence row containing announcement, user, tenant, displayed approved language (or English fallback), content hash, policy version and timestamp. Duplicate acknowledgment inserts are ignored so existing evidence isn't overwritten.
- Platform endpoint `GET /api/platform/communications/:id/acknowledgments` returns aggregated language/version evidence counts without disclosing account IDs.
- An administrative approval click **does not certify legal translation quality** and does not prove a person viewed the translated text. Independent language review, immutable snapshot proof, explicit consent language and legal advice remain separate release gates. Original in-app read/ack timestamps remain unchanged.
- All new tables are additive, and still guarded by the staging-only communication flags. Do not run on a database shared with production.

### Owner acknowledgment receipt and dormant push consent
- `GET /api/owner/communications/:id/receipt` returns only the signed-in owner's own immutable first-acknowledgment evidence (content hash, language, version and recorded timestamp). The tenant and account identities come only from authentication, never from URL or request body.
- Receipt visibility requires an active tenant and owner role. A receipt proves that the server stored an acknowledgment action, not that a human read or understood the notice.
- `GET /api/owner/communications/push-preference` and `POST /api/owner/communications/push-preference` provide an owner-scoped, opt-in preference for a **future** push channel.
- `platform_owner_communication_push_preferences` is additive and records only tenant ID, owner ID, preference and last-updated timestamp. It stores **no device token or personal device identifier**.
- The UI clearly states that push is not operational. There is no push sender, token-registration endpoint, delivery job, or automatic push broadcast in this phase.
- Device registration, revocation, data-retention policy, platform-specific permission UX, web/native push credentials, and actual device testing remain required before any push delivery is activated.

### Dormant owner installation enrollment (no push delivery)
- Added `lib/communications/platform-push-enrollment.js` and additive `platform_owner_communication_devices` table. These enroll an installation identifier, **not** a push token; no FCM/APNs integration, background sender, web push permission request or device notification occurs.
- Enrollment is disabled unless all are set in an isolated staging environment: `PLATFORM_COMMUNICATIONS_ENABLED=true`, `PLATFORM_COMMUNICATIONS_STAGE=staging`, `PLATFORM_COMMUNICATIONS_PUSH_ENROLLMENT_ENABLED=true` and a secret `PLATFORM_COMMUNICATIONS_DEVICE_HMAC_KEY` of at least 32 characters. Treat this as a sensitive server-only secret; never publish it or put it in the browser.
- API: `GET /api/owner/communications/devices`, `POST /api/owner/communications/devices` with `{installationId: UUIDv4, platform: web|android|ios}`, and `POST /api/owner/communications/devices/revoke` with `{installationId: UUIDv4}`.
- All endpoints require an authenticated active restaurant owner. Enrollment additionally requires explicit future-push opt-in; owner/tenant values are taken only from the authenticated context. Device installation UUIDs are never persisted: only keyed HMAC-SHA256 digests are stored and a shortened non-sensitive prefix returned for display.
- A global unique digest prevents one installation being silently associated with multiple accounts/tenants. Re-enrollment requires the same owner and tenant. Turning the push preference off revokes active installation rows.
- The registry is a preparation step only. It is **not** a complete native push integration: no token upload, secure encrypted provider token storage, device validation, installation migration, delivery queue or push sender is implemented.
- HMAC key rotation and race-safe enrollment across multiple workers must be validated before deployment. Never register actual customer devices on shared production databases.

### Manual one-recipient Brevo sandbox runner (not activated)
- `lib/communications/platform-brevo-manual-runner.js` exports `runOneApprovedSandboxBrevoEmail` for a deliberately **unmounted** test runner. It is not used by any endpoint, startup code or background worker. No emails are sent merely because this code exists.
- Requires all previously documented sandbox/provider/recipient gates, plus `PLATFORM_COMMUNICATIONS_MANUAL_SEND_ENABLED=true`, an explicit announcement ID, and a per-call `SEND_ONE_APPROVED_SANDBOX_EMAIL` confirmation.
- A read-only preview must identify **exactly one** eligible queued sandbox recipient and no additional blocked or pending records. It then calls the existing worker with `limit:1` and an announcement filter; the worker independently revalidates the owner and claims the queue record.
- Approval to perform a real Brevo sandbox test send and proof of a **separate isolated staging Turso database** are still required before operator invocation. Never set these flags on production or a database shared with live customer records.
- Automated tests inject a fake HTTP provider; they do not send real messages. Provider acceptance cannot be equated with mailbox receipt. Existing ambiguous outcomes are marked for manual review instead of blindly resending.
- Missing commercial release work: an explicitly controlled operational invocation mechanism, real sandbox delivery smoke test with approved test mailbox, provider event verification, accepted-versus-delivered status, bounce/unsubscribe handling, concurrency protections, quotas, and comprehensive live-device/staging acceptance testing.

### Provider acceptance versus verified mailbox events
- A separate additive `platform_owner_communication_email_receipts` table records Brevo `providerMessageId`, announcement/tenant/owner mapping, API acceptance timestamp and later verified provider event status. Receipt reports contain aggregated event counts, never email addresses.
- The queue worker now stores Brevo API acceptance without populating the old `deliveredAt` field: an HTTP 2xx and message ID **never prove mailbox delivery**. The legacy field may remain populated on preexisting rows and must not be interpreted as a mailbox-delivered signal.
- `lib/communications/platform-brevo-receipts.js` provides an **unmounted** verified-event processor. It only accepts a caller-supplied `verified:true` flag after an upstream verifier authenticates the provider; it MUST NEVER be called with `verified:true` directly from untrusted HTTP requests.
- Supported normalized lifecycle event codes: `delivered`, `hard_bounce`, `soft_bounce`, `blocked`, `invalid`, `spam`, `unsubscribed`. Events are scoped to previously registered provider message IDs and applied with idempotent, monotonically timestamped status updates.
- **No Brevo webhook endpoint, signature verifier or automatic event receiver exists yet.** Consequently these statuses are only a preparation layer, not evidence that any actual customer or tester received an email. The status processor is not connected to the public application.
- Remaining release gates include verifying Brevo's actual webhook authenticity mechanism and event format, controlling raw event retention, protecting against replay and ordering errors, mapping provider identifiers safely, and isolated staging tests with a real approved test mailbox.

### Brevo transactional webhook authentication (staging only)
- Implemented a disabled-by-default authenticated Brevo event endpoint: `POST /api/platform/communications/brevo/webhook`. **No webhook is registered or configured with Brevo as part of this commit**.
- The endpoint requires all these isolated staging variables: `PLATFORM_COMMUNICATIONS_ENABLED=true`, `PLATFORM_COMMUNICATIONS_STAGE=staging`, `PLATFORM_COMMUNICATIONS_EMAIL_MODE=sandbox`, `PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED=true`, and a server-only `PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN` of at least 32 characters. Do not set these on production or a staging instance that shares the production database.
- Brevo documents token-based `auth: {type:'bearer', token:'...'}` for webhook configuration. Configure **only this dedicated token**, never a login JWT or the Brevo API sending key. The endpoint authenticates before any database read or write, compares credentials without direct timing-leaky string equality and rejects malformed/expired/unsupported events.
- Brevo transactional payload fields `event`, `message-id` and `ts_event` are normalized. Only supported delivery/bounce/suppression events affect a **previously accepted and registered** message ID. Duplicate and outdated events are ignored.
- The webhook never sends email and never returns customer addresses, notice bodies, recipient identifiers, message IDs or credentials. Application-level payload size is capped in tests; deployment must also configure a strict proxy/body-size limit, request throttling, HTTPS and relevant network protections.
- Before enabling webhook delivery reporting, validate actual Brevo provider-message-ID matching between API responses and webhook events, replay behavior, IP filtering, alerting, bounced-recipient suppression, and operational procedures on a separate staging database.
- Official references: https://developers.brevo.com/docs/secured-webhooks and https://developers.brevo.com/docs/transactional-webhooks

### Safe deployment checklist
- Confirm `gastroflow-staging` Render service branch `codex/production-readiness`.
- Inspect `TURSO_DATABASE_URL` safely in Render dashboard to establish a separately isolated staging database. Do not print secrets.
- Only after owner approval, explicitly configure both feature-gate variables on staging.
- Run isolated database tests and verify rollback behavior.
- Deploy only to staging after explicit approval.
- Confirm owner A cannot read or acknowledge owner B's messages, managers cannot receive owner-only notices, and inactive tenants are excluded.
