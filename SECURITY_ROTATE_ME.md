# ⚠️ Rotate these credentials — action required

Your working `.env` (now git-ignored) contains **live** credentials that were sitting in plaintext. Because they existed unprotected, treat them as **potentially exposed** and rotate them:

1. **Gmail app password** (`SMTP_PASS`) — go to your Google Account → Security → App passwords, **revoke** the current one, and generate a new app password. Put the new value in `.env` as `SMTP_PASS`.
2. **Notify.lk API key** (`NOTIFY_LK_API_KEY`) — log into Notify.lk, regenerate the API key, and update `.env`.

## What was already done for you
- `.gitignore` now excludes `.env`, `*.db*`, `node_modules/`, and `dist/`, so these never get committed.
- `.env.example` uses placeholders only (safe to commit) and documents the correct variable names.
- Production **fail-fast** is restored: the server refuses to boot in `NODE_ENV=production` if `JWT_SECRET` or `PAYHERE_MERCHANT_SECRET` is missing or a known insecure default.

## Before going live, set real values in `.env`
```
NODE_ENV=production
JWT_SECRET=<long random string>      # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
PAYHERE_MERCHANT_ID=<your id>
PAYHERE_MERCHANT_SECRET=<your secret>   # PAYHERE_SECRET is accepted as an alias
SMTP_PASS=<new gmail app password>
NOTIFY_LK_API_KEY=<new notify.lk key>
```

Delete this file once you've rotated everything.
