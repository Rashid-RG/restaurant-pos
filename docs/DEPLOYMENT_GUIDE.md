# Deployment guide — draft pilot release

This branch has local validation, not a completed live rollout. Keep the existing service and database recoverable until a separate staging deployment passes the checklist below. Do not point the existing service at an empty database.

## Environment and commands

Use Node 24. Build with `npm ci && npm run build:all`, start with `npm run start:production`, and use `/api/health` as the readiness endpoint. The server listens only after database initialization succeeds.

Set `NODE_ENV=production`, explicit HTTPS `CORS_ORIGIN` values, distinct random `JWT_SECRET` and `CUSTOMER_JWT_SECRET` values of at least 32 characters, `ADMIN_USERNAME`, a unique 12–72-byte `ADMIN_PASSWORD`, and a non-trivial six-digit `ADMIN_PIN`. Enter secrets directly in the hosting provider dashboard; never commit them. Initial owner credentials bootstrap the account; changing these variables is not a password reset workflow.

Configure `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_NOTIFY_URL` and `PAYHERE_SANDBOX=true` for staging. The notify URL must be a reachable HTTPS callback such as `https://YOUR_HOST/api/payments/payhere/webhook`. Complete real sandbox callback tests, including wrong amount, wrong currency and concurrent duplicate callbacks, before taking payments. Switching to live mode requires separate merchant validation.

Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy sits in front of the app. Other topologies require an explicit trust policy before deployment.

## Storage choices

For a self-hosted single instance, configure `DATABASE_FILE` on a persistent volume. `node scripts/backup.js` performs a local SQLite online backup and integrity verification. Store encrypted backups outside the host and practice restoration. Compose binds the app to loopback for a local reverse proxy.

For the proposed free Render demonstration, set `TURSO_DATABASE_URL=libsql://...` and `TURSO_AUTH_TOKEN` for a compatible libSQL database. The new Turso engine is not interchangeable with this adapter. Production on Render refuses local file storage. Do not set `DATABASE_URL`: the PostgreSQL path is unfinished and explicitly blocked in production.

Remote libSQL export and restore have not been implemented in this branch. Validate cloud latency, transaction concurrency, migration, quota behavior and provider-assisted recovery before accepting pilot data. Schema initialization currently uses startup migrations; a versioned migration runner remains a launch gap.

## Safe rollout

1. Inventory the live service's database and uploaded files; obtain a consistent backup and verify a restore in isolation.
2. Create a separate staging service and empty durable database, using isolated test credentials and PayHere sandbox.
3. Build the branch and validate all three routes, owner login, role and tenant separation, kitchen flow, payment replay, stock races, driver assignment, GPS freshness and restart recovery.
4. Rehearse migration into staging; reconcile row counts, stock quantities, order states, invoice totals and cash balances. Record the migration version and rollback procedure.
5. Test SMS/email providers, GPS permissions, sleep/reconnect behavior and actual printers. A cloud server cannot directly reach a restaurant's private LAN printer; use a secured local print bridge.
6. Deploy in a maintenance window only after the operator accepts the pilot gates. Watch errors, payment reconciliation, kitchen lag and stock discrepancies, and retain the old database until the migration is accepted.

Do not horizontally scale this draft: events are in memory and the database gate serializes one application process. Introduce durable event delivery, replay and a cross-process distribution mechanism before multiple instances.

## Free hosting limits

Render free web services sleep after inactivity, have cold starts, and do not preserve local filesystem changes across lifecycle events. Free Render Postgres expires after 30 days. Use free hosting for development, demonstrations or a consciously limited pilot, not as an availability guarantee during restaurant service. External database, maps, notification and storage quotas must also be monitored.

Sources: [Render free services](https://render.com/docs/free), [Turso pricing](https://turso.tech/pricing), [libSQL JavaScript SDK](https://docs.turso.tech/sdk/ts/reference), [PayHere checkout API](https://support.payhere.lk/api-%26-mobile-sdk/checkout-api).

## Release evidence

Read [the full review](COMPREHENSIVE_REVIEW_2026-11-05.md) and its launch gaps. Local tests are evidence for the tested scenarios only. Docker execution, hosted CI, external database behavior, payment provider callbacks, notification delivery and hardware operation still need their own passing evidence.
