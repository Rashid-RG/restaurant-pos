# GastroFlow staging — Brevo Free transactional email setup

GastroFlow uses the Brevo HTTPS transactional email endpoint for login, registration and checkout verification codes. No Brevo SDK or paid plan is required.

## Step 1 — Create a Brevo account
Visit https://www.brevo.com/ and choose the **Free** plan. Brevo currently advertises 300 sends per day across email types. A free account is not unlimited; transactional emails beyond the daily quota may be queued.

## Step 2 — Verify your sending address
In Brevo **Senders, Domains & Dedicated IPs**, register and verify an email address you control, such as `hello@your-domain.example`. Follow Brevo's verification and domain authentication instructions. The app does **not** create or own a sender on your behalf.

## Step 3 — Create a private API key
In Brevo **SMTP & API → API Keys**, generate an API key for **GastroFlow staging**. Do not put it in GitHub, browser source, customer settings, a screenshot, or this chat.

## Step 4 — Add these in Render
Open Render → **My Workspace** → **gastroflow-staging** (not production) → **Environment**. Add:

| Key | Value |
|---|---|
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | Your secret Brevo API key |
| `BREVO_FROM_EMAIL` | The address verified in Brevo |
| `BREVO_FROM_NAME` | `GastroFlow` |

Save to apply. Render normally initiates a new deployment when environment variables change. Use the existing `gastroflow-staging` service only.

**Never use a made-up sender email:** Brevo requires an authorized sender. `EMAIL_PROVIDER=brevo` makes the app fail closed if credentials or sender are missing instead of sending through an unrelated provider.

## Step 5 — Verify actual delivery
1. Open `https://gastroflow-staging.onrender.com/customer/`.
2. Select a restaurant that accepts online orders.
3. Open registration or checkout; enter an email address you can receive.
4. Request an email OTP.
5. Confirm a real message arrives in that inbox and that its six-digit code is accepted.
6. Confirm an incorrect or expired code is rejected, and that the same successful code cannot be used twice.
7. Check Brevo's transactional logs if the provider accepted an email but it did not arrive.

`sendEmail()` considers a Brevo `messageId` proof of **API acceptance**, not proof of inbox delivery. Verify actual inbox delivery and monitor bounces/spam.

## Safety and troubleshooting
- **Verification unavailable:** check `EMAIL_PROVIDER`, `BREVO_API_KEY` and `BREVO_FROM_EMAIL`.
- **Brevo rejects request:** confirm sender is verified and API key belongs to the right account.
- **Too many requests:** check daily quota and per-destination rate limiting.
- **Email in spam:** authenticate your sender domain (DKIM/SPF/DMARC) where possible.
- **Lost key:** revoke it in Brevo, generate a new key, update Render, never commit it.
- **Production:** do not copy these staging secrets automatically; configure and verify production separately when ready.

Official documentation:
- https://developers.brevo.com/docs/send-a-transactional-email
- https://developers.brevo.com/docs/getting-started-with-senders-and-domains
- https://developers.brevo.com/docs/api-key-authentication
