# GastroFlow — Changes & Additions Plan

**Updated:** 2026-07-22 · **Source:** `SYSTEM_REPORT.md` (code-verified audit) · **Purpose:** concrete list of completed fixes, changes, and additions.

Legend: **[x]** Completed · **P0** do now · **P1** before launch · **P2** important · **P3** later · effort **S/M/L**

---

## PART 1 — CHANGES TO MAKE (fix drift & hygiene)

### [x] 1.1 De-duplicate the 6 repeated routes · P0 · S (COMPLETED)
`server.js` duplicate routes removed and reconciled to authoritative DB-backed implementations.

| Route | Active (kept) | Status |
|---|---|---|
| `/api/otp/send` | line 3314 (DB-backed) | ✅ Completed |
| `/api/otp/verify` | line 3343 (DB-backed) | ✅ Completed |
| `/api/ai/chat` | line 1920 (Pro Sommelier & Concierge) | ✅ Completed |
| `/api/shifts/active` | line 4015 | ✅ Completed |
| `/api/shifts/open` | line 4024 | ✅ Completed |
| `/api/shifts/close` | line 4044 | ✅ Completed |

### [x] 1.2 Finish POS `alert()` → toast migration · P1 · M (COMPLETED)
Migrated remaining `alert()` calls in `src/` to `showToast()` / `toast()` from `POSContext.jsx`.

- `src/components/Sidebar.jsx` — ✅ Converted to `showToast()`
- `src/components/Dashboard.jsx` — ✅ Converted to `showToast()`
- `src/components/Inventory.jsx` — ✅ Converted to `showToast()`
- `src/components/Settings.jsx` & `POSView.jsx` — ✅ Converted to `showToast()`

### [x] 1.3 Reconcile `CLAUDE.md`, PWA Manifests & Mobile Routing · P1 · S (COMPLETED)
- Created **3 Standalone Mobile App Identities**:
  - `GastroPOS`: `http://172.20.10.2:3000` (PWA `pos-manifest.json`, `#0f172a` Navy Slate, `🖥️` icon)
  - `GastroFood`: `http://172.20.10.2:3001` (PWA `manifest.json`, `#ff6b35` Coral Orange, `🍔` icon)
  - `GastroDriver`: `http://172.20.10.2:3001/?mode=driver` (PWA `driver-manifest.json`, `#10b981` Emerald Green, `🛵` icon)

---

## PART 3 — FEATURES ADDED (COMPLETED)

### [x] 3.1 Reporting & Compliance · P1 · M (COMPLETED)
- **X-Report API**: `/api/reports/x-report` — Live mid-shift snapshot (Gross sales, Cash/Card breakdown, Tax, Voids, Cash drawer expected float).
- **Tax / VAT Compliance Report**: `/api/reports/vat` — Sri Lanka standard 18% VAT collected report.
- **Item Profitability / COGS Report**: `/api/reports/cogs` — Cost of Goods Sold vs Price margin percentage.

### [x] 3.2 Inventory Depth · P1 · L (COMPLETED)
- **Suppliers Management**: `/api/inventory/suppliers` — Supplier directory & contact management.
- **Waste & Spoilage Logging**: `/api/inventory/waste` — Deducts damaged stock with audit log entries.

### [x] 3.3 Customer Experience Polish · P2 · S–M (COMPLETED)
- **Smart Cart Upsell & Cross-Sell Engine**: Checkout recommendation cards for drinks, sides, and desserts.
- **Allergen Declarations**: Explicit badges for Gluten, Dairy, Eggs, Nuts, and Vegan items.

### [x] 3.4 Staff & Permissions · P2–P3 · M (COMPLETED)
- **Per-Staff Sales & Performance Analytics**: `/api/staff/performance` — Ticket count, sales volume, and average ticket size per staff member.
