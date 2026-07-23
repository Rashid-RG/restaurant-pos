# GastroFlow — Deep System Re-Audit

**Date:** 20 July 2026
**Scope:** Full re-scan of the staff POS + `apps/customer-web`, checked against the modern online-ordering feature list.
**Note:** The system has grown substantially since the first audit (~3,800 → ~10,200 lines). Much of `UPGRADE_PLAN.md` Phases 0–2 is now **done**. This document supersedes those findings.

---

## 1. Headline

The build has moved fast and far. Auth, PINs, shifts, audit logs, normalized `order_items`, a real server-side billing engine, SSE real-time, and a genuinely feature-rich customer PWA all exist now. **The feature coverage is impressive.**

But there is a **critical, exploitable payment bypass** in the PayHere flow that gives away free food. Fix this before anything else ships.

---

## 2. 🔴 CRITICAL — Payment can be bypassed (free orders)

Three defects chain together into a complete bypass.

**2.1 — The webhook skips signature verification when the signature is absent.**
`server.js`, `/api/payments/payhere/webhook`:
```js
if (md5sig && md5sig !== expectedSignature) {
  return res.status(400).json({ error: 'Invalid signature verification.' });
}
```
If `md5sig` is **omitted entirely**, the condition short-circuits and verification is skipped. The handler then marks the order `paid`, frees the table, and awards loyalty points.

> **Exploit:** `POST /api/payments/payhere/webhook` with `{"order_id":"<any id>","status_code":"2"}` — no signature — marks any order paid. The endpoint sits before the `app.use(authenticateToken)` line, so it is fully public.

**Fix:** Require `md5sig` — reject when missing. Verify unconditionally:
```js
if (!md5sig || md5sig !== expectedSignature) return res.status(400).json({ error: 'Invalid signature.' });
```
Also refuse to run at all if `PAYHERE_MERCHANT_SECRET` is unset, rather than falling back to `'mock_merchant_secret'`.

**2.2 — The checkout endpoint signs any amount the client sends.**
`/api/payments/payhere/checkout` takes `amount` straight from `req.body` and returns a **valid signature** for it. A client can request a signature for LKR 1.00 on a LKR 10,000 order.

**Fix:** Ignore `amount` from the body. Look up the order in the DB and sign `order.total`. Also verify in the webhook that `payhere_amount` matches the stored `order.total` before marking paid.

**2.3 — Both front ends call the webhook themselves to fake success.**
`POSView.jsx` (`handlePaymentComplete`) and `CartCheckoutView.jsx` (`handlePayHereSuccessSimulation`) both `POST` to the webhook from the browser with `status_code: '2'`. Payment is currently **entirely simulated** — no money moves, and the client declares its own success.

**Fix:** Remove both client-side webhook calls. Redirect to the real PayHere checkout URL and let PayHere call your `notify_url` server-to-server. Keep the simulation behind an explicit `NODE_ENV !== 'production'` dev-only flag.

---

## 3. 🟠 Other security findings

| # | Finding | Detail | Fix |
|---|---|---|---|
| 3.1 | **Staff actions are public** | `/api/public/orders/:id/accept` and `/reject` are defined **before** `app.use(authenticateToken)` (line 1780), so anyone can accept/reject any online order and set the ETA. | Move both behind auth + `requireRole(['owner','manager','cashier'])`. |
| 3.2 | **CORS effectively open** | `cors({ origin: true, credentials: true })` reflects *any* origin and allows credentials. | Allow-list the POS and customer-web origins explicitly. |
| 3.3 | **Missing table breaks saved cards** | `/api/customer/cards` reads/writes `customer_cards`, but that table **does not exist** in `restaurant.db`. Both endpoints throw 500. | Create the table, or remove the feature until PayHere tokenization is real. Store only a provider token + last four — never a PAN. |
| 3.4 | **Hardcoded secret fallbacks** | `JWT_SECRET` falls back to `'super_secret_restaurant_pos_key_2026'`; PayHere to `'mock_merchant_secret'`. | Fail fast on boot if unset in production. |
| 3.5 | **Stock check is not atomic** | `resolveAndCalculateBill` checks stock, then a later `UPDATE menu_items SET stock = stock - ?` applies it. A concurrent order can oversell (TOCTOU). SQLite's write serialization masks this today; PostgreSQL will not. | Use a conditional update (`WHERE stock >= ?`) and verify rows affected. |
| 3.6 | **Variable shadowing** | `const type` is declared twice in `/api/public/orders` (lines 1239 and 1262). Legal but confusing. | Remove the inner redeclaration. |

**Correction to my earlier audit:** I previously flagged `/api/menu_items` and `/api/customers` as unauthenticated. That was **wrong** — `app.use(authenticateToken)` at line 1780 covers every route defined after it, which includes both. The public-routes-then-global-auth ordering is a sound pattern. The genuine exceptions are the ones listed in 3.1.

---

## 4. ✅ What's genuinely well built

Credit where due — these are done properly:

- **Server-authoritative billing.** `resolveAndCalculateBill` re-fetches every menu item *and every modifier* from the DB and explicitly guards against spoofed `priceDelta`. This was the #1 issue in the first audit and it is now correctly solved.
- **Normalized `order_items`** — item-level reporting is now possible.
- **Real-time via SSE** — `/api/stream/orders/:id` for customer tracking and `/api/stream/pos` for staff, with proper subscriber cleanup on `close`.
- **Transactions** around order placement with `ROLLBACK` on failure.
- **Auth stack** — bcryptjs, JWT, helmet, express-rate-limit, dotenv, role checks, manager PIN override.
- **Audit logging** (`writeAuditLog`) and **shift management** with a real Z-report (float, expected vs counted, over/short, voids).
- **Pro billing features** — service charge, tips, rounding adjustment, split tender, refunds.
- **Input validation** — Sri Lankan phone format and delivery address completeness are both validated server-side.

---

## 5. Customer app — feature coverage vs the modern checklist

### ✅ Implemented

| Feature | Where |
|---|---|
| Menu browse, search, categories | `MenuView.jsx` |
| **Modifiers/customization** with price deltas | `CartContext.jsx` + server-verified |
| Order types: **dine-in QR / takeaway / delivery** | `CartCheckoutView.jsx`; QR binds via `gastroflow_dinein_table` |
| Guest + registered checkout | `CustomerAuthContext.jsx` |
| Saved addresses + autocomplete | `/api/customer/addresses` |
| **Loyalty points redemption** | server-verified in `resolveAndCalculateBill` |
| **Promo codes** | `promotions` table |
| Order history + **personalized reorder favourites** | `MenuView.jsx` top-3 |
| **Live order tracking** | SSE, `OrderTrackingView.jsx` |
| PayHere + cash-on-delivery options | `CartCheckoutView.jsx` |
| **AI ordering chatbot** | `/api/ai/chat` |
| **Group cart** (shared ordering link) | `group_carts` table |
| **Dietary filters** (veg etc.) | `MenuView.jsx` + `dietaryTags` |
| **Multi-language** | translation strings in `MenuView.jsx` |
| Feedback/ratings | `feedbacks` table |
| Staff accept/reject with ETA | `/accept`, `/reject` |

That is a strong feature set — genuinely ahead of where I expected.

### ❌ Still missing

| Gap | Impact | Priority |
|---|---|---|
| **Not actually a PWA** | No `manifest.json`, no service worker — despite the CSS header calling it one. Can't be installed to home screen, no offline shell. | P1 |
| **Scheduled ordering** | The API accepts `scheduledTime`, but there is **no UI** to set it. Half-built. | P1 |
| **Push notifications** | No web-push. Customers must keep the tab open to see status. | P1 |
| **Prep-time / ETA before ordering** | ETA only appears after staff accept; customers can't see it at checkout. | P1 |
| **Delivery fees & zones** | `deliveryFee` is hardcoded `0` on every order. No zone logic, no minimum order. | P1 |
| **Real address geocoding** | Uses `MOCK_COLOMBO_LOCATIONS` — mock data, no map, no lat/lng. | P2 |
| **Group cart real-time** | Polls on `setInterval` instead of using the SSE layer you already built. | P2 |
| **Menu images** | `imageUrl` exists in schema but the UI still shows emoji. | P2 |
| **Online-store controls** | No open/closed toggle, no "86 item" from the POS side reaching the customer app. | P1 |
| **Allergen data** | Dietary tags exist; specific allergen declarations don't. | P2 |
| Wallet (Apple/Google Pay), driver map tracking | Not started. | P3 |

---

## 6. Architecture gaps still open

- **Still SQLite, still single-tenant.** No `tenant_id` anywhere. The SaaS goal (`UPGRADE_PLAN.md` §7, `BUILD_PLAN.md` M6) has not been started. Every additional feature built now increases the migration cost later.
- **`server.js` is 2,434 lines in one file** with 50 routes. It needs splitting into modules before it becomes unmaintainable.
- **No tests.** The billing engine is now genuinely complex — service charge, promos, loyalty, rounding, tips, modifiers. This is exactly the code that must have unit tests.
- **No TypeScript, no migrations.** Schema is still created ad hoc in code; the missing `customer_cards` table (3.3) is a direct symptom.
- **Thermal printing still not implemented** — receipts and the Z-report both still use `window.print()`.

---

## 7. Recommended order of work

**Now (before any deployment):**
1. Fix the PayHere webhook signature check (2.1).
2. Sign the stored order total, not the client-supplied amount (2.2).
3. Remove client-side webhook calls; wire the real redirect + `notify_url` (2.3).
4. Put `/accept` and `/reject` behind auth (3.1).
5. Lock CORS to known origins (3.2).
6. Create `customer_cards` or remove the endpoints (3.3).
7. Fail fast on missing secrets (3.4).

**Next:** unit tests for `resolveAndCalculateBill`; split `server.js` into modules; add the PWA manifest + service worker; finish scheduled ordering UI; delivery fees/zones; online-store open-closed toggle.

**Then:** the PostgreSQL + multi-tenant migration (`BUILD_PLAN.md` M1/M6) — the longer this waits, the more expensive it gets.

---

## 8. Bottom line

Feature-wise you are close to a competitive product, and the billing engine fix was done right. Two things stand between this and something sellable: **the payment bypass must be closed**, and **the multi-tenant foundation has to be laid before the codebase grows further**. Everything else on the list is incremental.
