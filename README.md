# GastroFlow POS

A restaurant **Point-of-Sale + customer online-ordering** platform built for Sri Lanka (LKR, PayHere), with a long-term goal of becoming a multi-tenant SaaS.

It is two front-end apps sharing one Express backend and one database:

| App | Path | Dev port | Users | Auth |
|---|---|---|---|---|
| **Staff POS / Admin** | `src/` | 3000 | Owner, Manager, Cashier, Kitchen | JWT + role + manager PIN |
| **Customer PWA** | `apps/customer-web/` | 3001 | Public diners | Guest or customer JWT |
| **Backend API** | `server.js` | 5000 | — | `app.use(authenticateToken)` splits public/private routes |

**Stack:** React 18 + Vite · Express 4 · SQLite3 · bcryptjs · jsonwebtoken · helmet · express-rate-limit · dotenv · Server-Sent Events (SSE) for real-time updates.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the values (see Environment below)
npm run start:all         # runs API (5000) + POS (3000) + customer app (3001) together
```

Both front ends proxy `/api` to the backend on port 5000.

### Individual processes

```bash
npm run server            # backend only  (node server.js)
npm run dev               # POS only       (Vite, :3000)
npm run customer:dev      # customer app   (Vite, :3001)
```

### Builds

```bash
npm run build             # build the POS app
npm run customer:build    # build the customer PWA
```

---

## Environment variables

The server **fails fast at boot in production** if a required secret is missing or left at an insecure default.

```bash
NODE_ENV=production
PORT=5000

# Auth — required in production (no insecure fallback is allowed to boot)
JWT_SECRET=                # staff tokens
CUSTOMER_JWT_SECRET=       # customer tokens (falls back to JWT_SECRET if unset)

# PayHere
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=   # required in production
PAYHERE_NOTIFY_URL=https://api.yourdomain.com/api/payments/payhere/webhook

# CORS — single allowed origin in addition to the localhost dev ports
CORS_ORIGIN=https://order.yourdomain.com

# Optional: point SQLite at a different file (used by the test scripts for isolation)
DATABASE_FILE=./restaurant.db
```

> **Note:** the code currently reads a single `CORS_ORIGIN`. localhost dev origins (`:3000`, `:5173`, `:5174`) are always allowed.

---

## Project structure

```
restaurant-pos/
├── server.js                     # Express API + SQLite (all routes)
├── restaurant.db                 # SQLite database (auto-created/seeded on boot)
├── vite.config.js                # POS dev server (:3000) + /api proxy
├── src/                          # Staff POS / Admin app
│   ├── components/POSView.jsx    # ordering, payment, receipt
│   ├── context/POSContext.jsx    # POS state + API calls
│   └── database/db.js            # REST client wrapper
└── apps/customer-web/            # Customer PWA
    ├── index.html                # PWA meta, viewport, manifest link
    ├── public/                   # manifest.json, sw.js, offline.html, icons
    └── src/
        ├── App.jsx               # shell: header, nav, cart sheet, providers
        ├── i18n/translations.js  # en / si / ta dictionary
        ├── context/
        │   ├── LanguageContext.jsx  # global language (persisted)
        │   ├── CartContext.jsx
        │   └── CustomerAuthContext.jsx
        └── views/                # MenuView, CartCheckoutView, OrderTrackingView, ProfileView, LoginRegisterView
```

---

## Key principles

- **The server is always authoritative on money.** Clients send intent (item IDs, quantities, modifier IDs, promo code, tip); the server prices everything in `resolveAndCalculateBill`. Never trust a client-supplied amount.
- **Public vs private routes** are split by `app.use(authenticateToken)`. Public customer/payment routes are defined *before* it; staff routes *after* it with `requireRole(...)`.
- **Money-affecting actions write to `audit_logs`**, and multi-step DB writes run in transactions with rollback.
- **PCI:** no raw card numbers are stored — only a provider token + last four + expiry (`customer_cards`).

---

## Payments (PayHere)

The payment flow is **server-to-server** and cannot be faked by the browser:

1. Client places the order → server prices and stores it (status `pending`).
2. Client requests `/api/payments/payhere/checkout` with the **order id only**; the server signs the **stored order total** and returns the checkout params + `notifyUrl`.
3. In production the browser hands off to PayHere, which calls the server `notify_url` (`/api/payments/payhere/webhook`) server-to-server.
4. The webhook **requires a valid `md5sig`** and asserts `payhere_amount === order.total` before settling.
5. Clients learn the result by polling the order status / SSE — no browser code can mark an order paid.

In local development (`import.meta.env.DEV`) a **server-side** simulate endpoint (`/api/payments/payhere/dev-simulate`, hard-disabled in production) settles the order using its own stored total.

---

## Fiscal invoice numbering

Every settled order is assigned a **gapless, sequential fiscal invoice number** (a dedicated `invoice_counter` table + a `UNIQUE` index on `orders.invoiceNumber`). Numbers are allocated **only at payment settlement**, inside the same transaction — held, pending, and cancelled orders never consume a number. The number is shown on POS and customer receipts as `INV-000123`.

---

## Internationalization

The customer app supports **English, Sinhala (සිංහල), and Tamil (தமிழ்)** via a shared `LanguageContext`. The language switcher lives in the header, the choice is persisted, and any untranslated key falls back to English. Add or extend strings in `apps/customer-web/src/i18n/translations.js`.

---

## Customer PWA highlights

- Installable PWA — `manifest.json` (maskable icons), service worker (app-shell precache, stale-while-revalidate for the menu, offline fallback), and an "Add to Home Screen" prompt.
- Mobile-first responsive layout (phone → tablet → desktop), safe-area insets, ≥44px touch targets, pinch-zoom enabled.
- Menu browse/search/filters, modifiers (server-priced), guest + registered checkout, loyalty & promo codes, order history + reorder.
- Online **tips**, **order cancellation** (while pending), delivery fees/minimums, menu images (emoji fallback).
- Live order tracking over SSE and an AI ordering assistant.

---

## Testing

There is no bundled test runner yet. The `resolveAndCalculateBill` money path and the payment/invoice flows are the priority for a proper suite (Vitest recommended).

Ad-hoc integration checks used during development live under the scratchpad and exercise the API against an isolated DB copy via the `DATABASE_FILE` override (e.g. gapless invoice numbering, tip repricing, order cancellation rules).

---

## Roadmap & detailed brief

This README documents the current state. The full feature inventory, priorities, and build order live in:

- **`CLAUDE.md`** — the master development brief (Part A security fixes, Part B feature inventory, Part C mobile-first, Part D design system, Part E modernization, Part G build order).
- **`AUDIT_REVIEW.md`** — deep security + feature audit.
- **`UPGRADE_PLAN.md`** — strategy and SaaS positioning.
- **`BUILD_PLAN.md`** — implementation blueprint, schema, API contract, milestones.

### Notable gaps still open

Notification infrastructure (email/SMS, password reset, OTP), ingredient-level inventory + recipes, split bill, table transfer/merge, X-report & tax report, CSV/PDF export, ESC/POS thermal printing, PostgreSQL migration, and multi-tenancy. See `CLAUDE.md` for the prioritized list.
