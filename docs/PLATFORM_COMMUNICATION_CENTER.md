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

### Safe deployment checklist
- Confirm `gastroflow-staging` Render service branch `codex/production-readiness`.
- Inspect `TURSO_DATABASE_URL` safely in Render dashboard to establish a separately isolated staging database. Do not print secrets.
- Only after owner approval, explicitly configure both feature-gate variables on staging.
- Run isolated database tests and verify rollback behavior.
- Deploy only to staging after explicit approval.
- Confirm owner A cannot read or acknowledge owner B's messages, managers cannot receive owner-only notices, and inactive tenants are excluded.
