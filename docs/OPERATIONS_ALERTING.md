# GastroFlow operational alerts (staging-first)

This feature is opt-in and **disabled by default**. It does not configure an alert destination, a backup schedule, off-host retention, or automatic failover.

## Configuration

In the **staging** service's private environment settings, set `OPS_ALERT_WEBHOOK_URL` to an HTTPS endpoint controlled by the platform operator. The endpoint must accept a JSON POST and return a successful HTTP response. Never put the URL in source code, a public chat, or logs: its path may contain a private webhook token.

The payload contains only `source`, `event`, and `at`; it does **not** include account details, query strings, database errors, payment records, order IDs, or tenant IDs.

Events:

- `database_unavailable`: after 3 consecutive failed health probes (the probe runs every 30 seconds).
- `database_recovered`: the first successful probe following an open database incident.
- `backup_failed`: when `npm run backup` runs and exits with a backup error.

HTTP delivery has a bounded timeout, does not follow redirects, and never blocks an incoming order/payment request. Webhook delivery failures produce a generic server-side status; they are not retried durably. Do not interpret a notification as proof of a successful database backup.

## Backups and release boundaries

`npm run backup` still writes a local SQLite verified copy or a Turso logical snapshot into `BACKUP_DIRECTORY`. It must be run by an explicitly configured operator/scheduler. No schedule, off-host upload, retention policy, missed-backup heartbeat, or recurring restore verification is enabled by this change.

Before calling backups reliable, configure private off-host storage, automatic schedules, failure/missed-run monitoring, retention and encryption, and a documented restore drill into a separate target database. Never restore over live restaurant data.

## Missed/stale backup detection

Run `npm run backup:check` **from an operator-controlled external scheduler** after a scheduled `npm run backup`. The check reads only `BACKUP_DIRECTORY` and exits nonzero when no recognized backup exists, the latest eligible backup is stale, or the backup files are invalid. `BACKUP_MAX_AGE_HOURS` defaults to 26 hours (configure it to exceed your intended schedule plus permitted delay). The check can emit `backup_missing` through the same optional webhook.

This is **not a scheduler**: no automatic backup jobs are enabled on Render. The checker confirms a recent locally stored SQLite-format file or a matching Turso logical snapshot checksum; it does not prove that a SQLite snapshot can be restored, that any copy is stored off host, or that the latest backup includes every expected record. Preserve sensitive backups off-host with access controls and independently test a restore to a new database.

The webhook is best suited to an HTTPS automation or incident receiver that can route these minimal event codes to the authorized operator. Avoid logging incoming webhook URLs or forwarding them to unrelated services. Test on staging before enabling in production.


## Encrypted backup export preparation

The optional `npm run backup:crypto -- encrypt INPUT OUTPUT` command creates an AES-256-GCM authenticated, password-protected archive **only from a preexisting local backup file**. `npm run backup:crypto -- decrypt INPUT OUTPUT` restores decrypted *backup bytes* into a **new file only**; it never imports them into a database or overwrites an existing file.

Configure `BACKUP_ENCRYPTION_SECRET` privately in the operator environment (at least 32 UTF-8 bytes, ideally a randomly generated high-entropy secret). Store the secret separately from encrypted archives, and retain a tested recovery copy of the secret. Losing it means losing access to encrypted backups. Never commit the secret, put it into a command argument, or print it in logs.

Example, after a successful `npm run backup`:

```bash
npm run backup:crypto -- encrypt /private/backups/gastroflow-example.json /private/export/gastroflow-example.enc.json
npm run backup:crypto -- decrypt /private/export/gastroflow-example.enc.json /private/verification/recovered.json
node scripts/verify-restore.js /private/verification/recovered.json
```

The last verification command is appropriate for **Turso logical JSON** backups; an SQLite `.db` backup requires separate SQLite integrity/recovery testing. Both encryption commands reject symlink inputs and existing output paths. This procedure **does not upload files** and the original unencrypted source remains present, so operators must secure or dispose of plaintext copies according to an approved retention procedure. No cloud storage provider, recurring schedule, automated retention, or encrypted off-host upload is configured by this implementation. Never connect these scripts directly to live production credentials without a separately approved backup/recovery runbook.


## Operator-controlled off-host encrypted upload (opt-in)

The optional `npm run backup:upload -- /private/export/backup.enc.json` sends **only an encrypted archive** to a short-lived, pre-signed HTTPS **PUT** URL. The runner must privately configure both:

- `BACKUP_UPLOAD_PRESIGNED_URL` — a provider-issued, short-lived object-upload URL with PUT permission only
- `BACKUP_UPLOAD_HOST` — the exact expected public storage hostname (no scheme, path, or port)

The command refuses plaintext files, symlinks, unexpected destination hosts, non-HTTPS schemes, credentialed URLs, redirects, and failed PUT responses. It reports only the encrypted archive's byte count and SHA-256 digest, never the pre-signed URL. Use a unique, non-overwriting object key and short-lived permissions. Configure destination-side encryption, versioning, private access, retention and object-lock as appropriate.

This is **not connected to any provider or scheduled on staging**. A successful PUT alone does not establish durable remote retention or restoration correctness. Have an authorized operator download a test archive into a separate environment, compare SHA-256, decrypt it into a new file, and verify restoration into a new empty local database. Never apply restores to the existing production Turso database. Keep plaintext temporary backup files private and manage their disposal separately. Provider credentials and signed URLs must never enter GitHub or application logs.
