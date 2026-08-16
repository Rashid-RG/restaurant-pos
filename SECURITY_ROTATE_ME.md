# SECURITY: Credentials to Rotate Immediately

> **CAUTION**: The following credentials were found in the `.env` file and may have been exposed.
> Rotate them in every platform where they are used before putting this app back in production.

## Credentials Found

| Credential | Platform | Action Required |
|---|---|---|
| `NOTIFY_LK_API_KEY` (value: `vZU61cOOuVoBiRxwmGdQ`) | notify.lk dashboard | Generate a new API key |
| `EMAIL_PASS` (Gmail App Password: `bffwxxbuqcordfvl`) | Google Account > Security > App Passwords | Revoke and regenerate |
| `PAYHERE_MERCHANT_SECRET` (`4OcPJrUbZxs8n4V8...`) | payhere.lk dashboard | Re-generate Merchant Secret |
| `JWT_SECRET` (`super_secret_restaurant_pos_key_2026`) | Environment variable | Replace with `openssl rand -hex 64` output |
| `CUSTOMER_JWT_SECRET` | Environment variable | Replace with `openssl rand -hex 64` output |
| `ADMIN_PASSWORD` (`admin123`) | App seeding | Set a strong password in env before next deploy |

## How to Generate Strong Secrets

```bash
# Generate a 64-byte hex JWT secret (Linux/macOS)
openssl rand -hex 64

# Or using Node.js (cross-platform)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Updated .env Template

```
JWT_SECRET=REPLACE_WITH_64_BYTE_HEX_SECRET
CUSTOMER_JWT_SECRET=REPLACE_WITH_64_BYTE_HEX_SECRET
ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD_MIN_16_CHARS
NOTIFY_LK_API_KEY=REPLACE_WITH_NEW_API_KEY
NOTIFY_LK_USER_ID=...
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=REPLACE_WITH_NEW_APP_PASSWORD
PAYHERE_MERCHANT_ID=...
PAYHERE_MERCHANT_SECRET=REPLACE_WITH_NEW_SECRET
```

## Rotation Checklist

- [ ] notify.lk API key rotated
- [ ] Gmail App Password revoked and regenerated
- [ ] PayHere merchant secret rotated  
- [ ] JWT_SECRET updated in production environment
- [ ] CUSTOMER_JWT_SECRET updated in production environment
- [ ] ADMIN_PASSWORD set to a strong, unique value (16+ chars)
- [ ] All active sessions invalidated (users re-login after JWT rotation)
- [ ] .env verified NOT tracked by git: `git status .env` (should show nothing)
