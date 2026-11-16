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
