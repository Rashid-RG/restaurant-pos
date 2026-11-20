# GastroFlow — Platform Communication Center

## Scope and status (2026-11-20)
Owner-targeted in-app communication foundation on `codex/production-readiness`. Not yet approved for commercial launch. No Render deploy in this change.

### Implemented foundation
- Dedicated Platform Owner Communication Center tab and composer.
- Draft creation, recipient preview, active-restaurant owner targeting, publish, cancel, owner-only inbox and acknowledgments.
- Tenant + user keyed recipient records, bounded inbox queries, audit events and read/acknowledgment counts.
- Existing basic platform-wide broadcast feature remains separate and unchanged.
- Explicit gates: `PLATFORM_COMMUNICATIONS_ENABLED=true` AND `PLATFORM_COMMUNICATIONS_STAGE=staging`. Without both, endpoints return 404 and schema initialization is not invoked.
- No email/push sending or staging customers contacted from this module.

### API endpoints
Authenticated platform owner:
- POST `/api/platform/communications/preview` with `{ "audience": {"scope":"all","tenantIds":[]} }`
- POST `/api/platform/communications`: create validated draft.
- GET `/api/platform/communications`: list.
- POST `/api/platform/communications/:id/publish`: transactional snapshot of currently eligible owners.
- POST `/api/platform/communications/:id/cancel`.
- GET `/api/platform/communications/:id/report`.

Authenticated restaurant owner (only own user+tenant):
- GET `/api/owner/communications`
- POST `/api/owner/communications/:id/read`
- POST `/api/owner/communications/:id/acknowledge`

### Remaining commercial acceptance gates
1. CI verification including all app builds and isolated DB boot; run `npm run check`, `npm test`, `npm run build:all`.
2. Integration tests against actual libSQL schema with active, suspended, deleted, platform, multiple-owner, and multi-tenant cases; cancellation races; duplicate publish retries.
3. Scheduling with time-zone-aware publication and automatic expiry, channel delivery jobs, retries, idempotency, and dead-letter queue.
4. Templates, attachments, signed media, multilingual English/Sinhala/Tamil; content sanitization, size/accessibility review.
5. Versioned legal disclaimers and immutable consent evidence; consent vs notice acknowledgment review by counsel.
6. Email and native push integration using staging-only sandbox recipients, opt-out rules, quotas and provider failure/retry handling.
7. Audit log immutability, publishing approvals, emergency stop, metrics, delivery analytics, recipient opt-out compliance.
8. Distinct channel permissions and tests for customer/driver/manager audiences; owner targeting must never implicitly expand to them.
9. Reconcile existing global broadcast UI and avoid conflicting urgent banners.
10. Verify staging uses a separate Turso database before migration approval. Back up and test restoration. Never deploy to production or run destructive changes.

### Safe deployment checklist
- Confirm `gastroflow-staging` Render service branch `codex/production-readiness`.
- Inspect `TURSO_DATABASE_URL` safely in Render dashboard to establish a separately isolated staging database. Do not print secrets.
- Only after owner approval, explicitly configure both feature-gate variables on staging.
- Run isolated database tests and verify rollback behavior.
- Deploy only to staging after explicit approval.
- Confirm owner A cannot read or acknowledge owner B's messages, managers cannot receive owner-only notices, and inactive tenants are excluded.
