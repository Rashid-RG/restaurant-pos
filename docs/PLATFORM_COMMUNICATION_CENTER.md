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
- An authenticated Brevo webhook endpoint now exists but is **disabled by default**, and no real Brevo webhook has been registered or exercised. Delivery statuses are still unverified until controlled staging tests validate provider calls and event receipts.
- Remaining release gates include verifying Brevo's actual webhook authenticity mechanism and event format, controlling raw event retention, protecting against replay and ordering errors, mapping provider identifiers safely, and isolated staging tests with a real approved test mailbox.

### Brevo transactional webhook authentication (staging only)
- Implemented a disabled-by-default authenticated Brevo event endpoint: `POST /api/platform/communications/brevo/webhook`. **No webhook is registered or configured with Brevo as part of this commit**.
- The endpoint requires all these isolated staging variables: `PLATFORM_COMMUNICATIONS_ENABLED=true`, `PLATFORM_COMMUNICATIONS_STAGE=staging`, `PLATFORM_COMMUNICATIONS_EMAIL_MODE=sandbox`, `PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_ENABLED=true`, and a server-only `PLATFORM_COMMUNICATIONS_BREVO_WEBHOOK_TOKEN` of at least 32 characters. Do not set these on production or a staging instance that shares the production database.
- Brevo documents token-based `auth: {type:'bearer', token:'...'}` for webhook configuration. Configure **only this dedicated token**, never a login JWT or the Brevo API sending key. The endpoint authenticates before any database read or write, compares credentials without direct timing-leaky string equality and rejects malformed/expired/unsupported events.
- Brevo transactional payload fields `event`, `message-id` and `ts_event` are normalized. Only supported delivery/bounce/suppression events affect a **previously accepted and registered** message ID. Duplicate and outdated events are ignored.
- The webhook never sends email and never returns customer addresses, notice bodies, recipient identifiers, message IDs or credentials. Application-level payload size is capped in tests; deployment must also configure a strict proxy/body-size limit, request throttling, HTTPS and relevant network protections.
- Before enabling webhook delivery reporting, validate actual Brevo provider-message-ID matching between API responses and webhook events, replay behavior, IP filtering, alerting, bounced-recipient suppression, and operational procedures on a separate staging database.
- Official references: https://developers.brevo.com/docs/secured-webhooks and https://developers.brevo.com/docs/transactional-webhooks

### Brevo event integrity and suppression precedence
- Authenticated webhook events must now include a valid recipient email and must match the address in the exact queued announcement/tenant/owner row linked to the Brevo provider message ID. A provider message-ID match alone is not sufficient to update the lifecycle.
- Event matching uses no caller-supplied tenant or user IDs, and webhook responses do not expose recipient email addresses.
- Terminal suppression states (`hard_bounce`, `blocked`, `invalid`, `spam`, `unsubscribed`) cannot be cleared by later delivered/soft-bounce events. A verified, newer suppression event **can override** an earlier delivered receipt, since delivered mail may later be reported as spam or unsubscribed.
- All updates still use conditional SQL state transitions and monotonically increasing event timestamps to reject duplicate, stale or concurrently racing status changes.
- An email event receipt is a provider report, not confirmation that a human opened or read the notice. The separate in-app acknowledgment evidence remains authoritative for a recorded owner acknowledgment.
- Before activation, validate accepted Brevo API message IDs against real webhook IDs, configure a verified test sender and controlled recipient, confirm a separate staging database, and perform a real isolated sandbox delivery test.

### Mandatory isolation attestation for Brevo network traffic
- `PLATFORM_COMMUNICATIONS_DATABASE_ISOLATED=true` is now a **separate fail-closed condition** for Brevo sandbox provider requests and authenticated webhook ingestion. Missing/false prevents those operations even if the other flags are enabled.
- This is an *operational attestation*, **not** an automatic guarantee. Before setting it, the operator must verify that the connected `TURSO_DATABASE_URL` is a separate staging database and no production customer records are accessible. Never assume isolation from the service name alone.
- The in-app inbox and non-sending queue/preview functions remain independently staged. This flag does not activate a sender, schedule a test, register a Brevo webhook, or deploy changes.
- All mocked provider tests set the attestation explicitly; real external traffic remains prohibited until separate approval.

### Verified provider suppression enforcement
- The staged email worker now checks historical Brevo provider receipts for **verified** hard bounces, blocked/invalid addresses, spam complaints and unsubscribes before attempting a new send to the same restaurant owner and email address.
- Suppression checks are scoped by tenant, owner and normalized email. A suppressed queue row is moved to `suppressed` rather than resent, and the worker repeats its suppression check inside the conditional claim to reduce race windows.
- The read-only dry-run now reports `provider_suppressed` as a blocking reason. The single-recipient manual runner refuses to send if any queued recipient is suppressed.
- This applies to the sandbox Communication Center only; it does **not** claim to establish commercial unsubscribe management for unrelated GastroFlow order notifications or other messaging programs.
- Verified Brevo suppression evidence must not be cleared automatically. A controlled review and lawful resubscription/consent workflow, database-backed integration tests and provider-specific webhook validation remain release requirements.

### Dormant quota-bound sandbox worker (not scheduled)
- `lib/communications/platform-sandbox-email-worker.js` is an **unmounted, one-job-per-tick** foundation. It is intentionally not imported from the app server or wired into HTTP routes, cron, Render jobs, or production infrastructure. **No automatic email sending is active.**
- Sending requires all existing Brevo/test-address/isolated-staging gates **plus** `PLATFORM_COMMUNICATIONS_AUTO_WORKER_ENABLED=true`, `PLATFORM_COMMUNICATIONS_EMAIL_STOP=false`, `PLATFORM_COMMUNICATIONS_EMAIL_WORKER_ACK=I_APPROVE_STAGING_SANDBOX_WORKER`, and a strict `PLATFORM_COMMUNICATIONS_EMAIL_DAILY_CAP` integer from 1 to 5. Missing controls stop the worker.
- The caller must supply one exact announcement ID. A read-only preview must identify exactly one due, eligible queued owner with zero blocked rows before quota can be reserved. The downstream queue worker performs its own ownership, allowlist, suppression and state-claim checks again before contacting the injected provider.
- Additive `platform_owner_email_sandbox_quota` holds one UTC-date row with a **durable atomic reservation counter** shared across workers. The conditional update prevents sending once the daily cap is exhausted. Quota reservations are intentionally not refunded on crashes or ambiguous outcomes.
- Emergency stop is fail-closed: anything other than an exact `PLATFORM_COMMUNICATIONS_EMAIL_STOP=false` prevents this worker from starting. Stop is checked at the start of a tick, not as an interrupt during an already-in-flight provider HTTP request.
- This is **not a deployable automated email service**: operator approval, database isolation confirmation, job scheduling, rate limiting, monitoring, bounce/unsubscribe governance and actual Brevo sandbox end-to-end tests are still missing. The caps reduce but do not eliminate all concurrent-send races during runtime flag changes.
- Automated tests inject a mock Brevo HTTP response. Do not enable the worker's flags or run it against actual Brevo without a separately authorized isolated-staging smoke test.

### Local database-backed sandbox worker acceptance tests
- Added `tests/platform-sandbox-email-worker-libsql.test.js`. It creates a temporary **local** libSQL database with the required minimal tables and never reads `TURSO_DATABASE_URL` or actual Brevo credentials.
- The test performs real SQL queue claims and receipt inserts with a **mock provider**, confirms provider API acceptance does not populate `deliveredAt`, and confirms a second notice cannot exceed the same UTC daily cap.
- It also inserts historical unsubscribe evidence linked to the same authenticated owner/email and proves that the worker declines to reserve quota or invoke an email provider.
- These tests validate basic local database behavior only; they do not yet test concurrent remote Turso sessions, Render configuration, live Brevo webhook delivery, power-loss recovery or native client behavior. Commercial sign-off remains pending.

### Local acceptance-to-provider-event-to-suppression regression
- The local libSQL integration suite now sends **only to a fake in-process provider**, records a Brevo-style API acceptance ID, applies a server-verified hard-bounce event to the matching queued owner and email, and checks that a second announcement is rejected before any further provider call.
- The same suite verifies that a mismatched recipient email and an unknown provider message ID cannot alter the recorded receipt state.
- These tests provide stronger module-to-module evidence but **are not actual Brevo sandbox delivery or webhook acceptance tests**; those require verified isolated Render staging, approved credentials, a test mailbox, and explicit operator authorization.

### Crash and ambiguous-send local database verification
- Added isolated libSQL regression tests for an injected Brevo timeout: the claimed job becomes `manual_review` with an attempt count, and a subsequent tick must not contact the provider again.
- A separate simulated worker-crash case creates a stale `sending` claim; the non-sending reconciliation function transitions it into `manual_review` without triggering a retry.
- These cases deliberately prioritize prevention of duplicate emails over automatic recovery of uncertain outcomes. A human reviewer must reconcile external provider evidence before deciding whether a failed or ambiguous message can ever be resent.
- An additional local concurrency test runs two worker ticks against the same database with a shared one-email-per-day quota; it must allow only one provider attempt. Remote multi-process Turso concurrency still requires an isolated staging test.
- The local tests use only ephemeral database files and mock provider functions. Real Brevo delivery, Render/Turso isolation, remote multi-instance contention, push-provider integration, and actual Android/iPhone device tests are still outstanding.

### Duplicate Brevo provider-ID collision safeguard
- The sandbox queue now requires a **new, uniquely persisted** Brevo provider message ID before changing a claimed email to `accepted`. A conflicting ID (including one associated with a different restaurant or announcement) leaves that email in `manual_review` rather than incorrectly accepting it.
- The local libSQL integration test processes two different notices with a deliberately duplicated fake Brevo message ID, confirms only one provider receipt exists, the second notice is in manual review, and a later worker tick does not resend it.
- Manual review requires checking the provider's authoritative activity or delivery evidence. The code does not claim that an actual provider timeout or collision can be automatically reconciled without human involvement.

### Safe deployment checklist
- Confirm `gastroflow-staging` Render service branch `codex/production-readiness`.
- Inspect `TURSO_DATABASE_URL` safely in Render dashboard to establish a separately isolated staging database. Do not print secrets.
- Only after owner approval, explicitly configure both feature-gate variables on staging.
- Run isolated database tests and verify rollback behavior.
- Deploy only to staging after explicit approval.
- Confirm owner A cannot read or acknowledge owner B's messages, managers cannot receive owner-only notices, and inactive tenants are excluded.
