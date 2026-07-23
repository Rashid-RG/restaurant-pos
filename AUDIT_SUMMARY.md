# GastroFlow POS — Consolidated Master Audit Summary

> **Single Source of Truth Document** consolidating system features, security verification, customer PWA integration, hardware connectivity, and production readiness audit findings.

---

## 1. System Architecture Overview

GastroFlow is a full-stack, Sri Lankan localized (LKR, PayHere) POS & Customer Web Application designed for single-restaurant operations and multi-tenant SaaS scaling.

| Component | Tech Stack | Port | Primary Target |
|---|---|---|---|
| **Backend API** | Node.js, Express, SQLite3 / PostgreSQL (`pg`), Zod | 5000 | Core business logic, payments, SSE real-time |
| **Staff POS** | React 18, Vite, Vanilla CSS design tokens | 3000 | Staff checkout, floor plan, kitchen KDS, inventory |
| **Customer PWA** | React 18, Vite, Service Worker, Leaflet Maps | 3001 | Public diners, QR table ordering, live driver tracking |

---

## 2. Security & Compliance Audit Findings (Part A Verification)

All critical security vulnerability remediations are complete and verified in code:

- **A1. Server-Enforced Webhook Signature Validation:** PayHere webhooks require valid `md5sig` signature calculated from `merchant_id`, `order_id`, `payhere_amount`, `payhere_currency`, `status_code`, and `md5(PAYHERE_MERCHANT_SECRET)`.
- **A2. Client Amount Tampering Prevention:** Order totals are priced and signed exclusively by the backend (`resolveAndCalculateBill`). Webhook settlement asserts stored total vs PayHere total.
- **A3. Payment Isolation:** Payment settlement occurs strictly server-to-server (`settleOrderPaid()`). Frontends poll status via SSE. Client-side simulation routes are restricted to non-production environments.
- **A4. Authorization Gates:** Kitchen accept/reject and managerial void/discount routes enforce JWT verification and `requireRole(['owner', 'manager', 'cashier'])`.
- **A5. CORS Isolation:** Production CORS strictly validates origin against `CORS_ORIGIN` allow-list while allowing LAN/localhost during development.
- **A6. PCI-DSS Compliance:** Card storage (`customer_cards`) only retains token, card type, last 4 digits, and expiration date (no PAN/CVV).
- **A7. Secrets Fail-Fast:** Application startup terminates immediately if `JWT_SECRET` or `PAYHERE_MERCHANT_SECRET` are missing or default in `production`.
- **A8. Stock Deduction Concurrency:** Stock updates utilize atomic SQL queries (`UPDATE ... WHERE stock >= quantity`) to prevent race conditions.

---

## 3. Core POS & Customer PWA Capabilities

### Fiscal Invoicing & Billing
- Sequential gapless fiscal numbers (`INV-xxxxxx`) via atomic `invoice_counter` allocations during settlement.
- ESC/POS thermal printing support (58mm & 80mm layouts) with auto cash drawer kick signal.
- 49 Vitest unit tests verifying bill calculation, tax, discounts, tips, and LKR rounding invariants.

### Inventory & BOM Recipes
- Ingredient-level inventory tracking (`ingredients` table) with minimum stock alerts.
- Recipe Bill of Materials (`recipes` table) mapping menu items to raw material requirements and auto-deducting raw ingredients upon sales.

### Real-Time Live Tracking & Geolocation
- Map picking via Leaflet + OpenStreetMap tiles with server-proxied geocoding (`/api/public/geocode`).
- Live driver tracking with SSE coordinates updates and standalone rider GPS emitter (`/driver/:orderId`).

### Platform & Multi-Tenancy
- Dual DB adapter supporting zero-config SQLite (`restaurant.db`) and production PostgreSQL.
- Request payload validation using Zod middleware schemas (`lib/validation.js`).
- SaaS tenant isolation using `tenant_id` and tenant provisioning endpoints (`/api/saas/tenants`).

---

## 4. Production Readiness Checklist

- [x] Fail-fast secret verification in production (`NODE_ENV=production`)
- [x] Unauthenticated health check endpoint (`GET /api/health`)
- [x] Graceful process shutdown handling (`SIGTERM` / `SIGINT`)
- [x] Staff POS password recovery & reset UI (`Login.jsx`)
- [x] Containerization via [`Dockerfile`](file:///c:/Users/DELL/Downloads/restaurant-pos/Dockerfile) & [`docker-compose.yml`](file:///c:/Users/DELL/Downloads/restaurant-pos/docker-compose.yml)
- [x] Vitest billing engine unit test suite (100% green, 49 tests)
