# SaaS Subscription Billing (Phase 5)

## What's implemented (verified)

- **Plan tiers** — `lib/plans.js` defines `basic` / `pro` / `enterprise` with seat +
  monthly-order limits (unit-tested in `tests/plans.test.js`).
- **Live metering** — `getTenantUsage(tenantId)` reads real counts (users,
  orders-this-month) from the DB.
- **Enforcement** (integration-tested):
  - Staff seat cap on `POST /api/users` → `402 {code:'plan_limit'}` when at limit.
  - Monthly order cap + suspended-tenant block on `POST /api/public/orders`.
- **Endpoints:**
  - `GET /api/saas/plans` — public pricing/tier list.
  - `GET /api/saas/usage` — a tenant's own plan + usage vs limits (owner/manager).
  - `PATCH /api/saas/tenants/:id` — platform admin sets `plan`/`status`
    (records the plan **after** payment is confirmed out-of-band).

## What's NOT implemented (needs a live payment provider)

Recurring subscription **charging** is not wired — it needs a real gateway
(Stripe Billing, or PayHere recurring) with live credentials, which can't be
exercised in this environment. The integration points are:

1. **Checkout / subscribe** — create a subscription for a tenant on a chosen plan.
   Add `POST /api/saas/subscribe` that creates a provider checkout session and
   returns its URL. (Stripe: `checkout.sessions.create` with a recurring price.)
2. **Provider webhook** — on `invoice.paid` / `customer.subscription.updated`,
   look up the tenant and call the existing `PATCH` logic to set `plan`/`status`.
   Verify the webhook signature exactly as the PayHere webhook does.
3. **Dunning** — on `invoice.payment_failed`, set `status='suspended'` (order
   creation already blocks suspended tenants).
4. **Env:** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (or PayHere recurring
   keys). Add to `.env.example`; never commit real values.

### Done-when
- [ ] A tenant can self-serve subscribe to a plan and is charged recurringly.
- [ ] Provider webhook flips `plan`/`status` (signature-verified).
- [ ] Failed payment suspends the tenant; the storefront blocks new orders.

Until then, plan changes are applied manually by a platform admin via `PATCH`
after confirming payment.
