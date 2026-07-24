# 🍽️ GastroFlow — Enterprise Restaurant POS, Customer Marketplace & Logistics Platform

<div align="center">

![GastroFlow Banner](https://img.shields.io/badge/GastroFlow-SaaS_Commercial_Platform-ff6b35?style=for-the-badge&logo=fastapi&logoColor=white)
![Build Status](https://img.shields.io/badge/Build-Passing_100%25-10b981?style=for-the-badge&logo=vite&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-87_Passed-3b82f6?style=for-the-badge&logo=vitest&logoColor=white)
![Real-Time](https://img.shields.io/badge/Real--Time-SSE_Sync-8b5cf6?style=for-the-badge&logo=socketdotio&logoColor=white)
![Localization](https://img.shields.io/badge/Localization-EN_|_SI_|_TA-f59e0b?style=for-the-badge&logo=googletranslate&logoColor=white)

**A Real-Time, Multi-Tenant Commercial Restaurant Operating System, Multi-Store Online Marketplace, and Driver Delivery Logistics Network.**

[Features](#-key-features--capabilities) • [System Architecture](#-%EF%B8%8F-3-system-platform-architecture) • [Getting Started](#-getting-started) • [Tech Stack](#-%EF%B8%8F-technology-stack) • [License](#-credits--ownership)

</div>

---

## 📌 Platform Overview

**GastroFlow** is an enterprise-grade, multi-tenant SaaS ecosystem designed for modern food service operations, multi-outlet restaurant chains, and food delivery marketplaces.

Comparable to industry standards such as **Toast POS**, **Deliverect**, **UberEats**, and **DoorDash**, GastroFlow seamlessly connects three core applications into a unified, real-time data flow:

```
                          ┌──────────────────────────────────────┐
                          │   GastroFlow Core Cloud API & DB     │
                          │   (Multi-Tenant Express + SQLite/PG) │
                          └──────────────────┬───────────────────┘
                                             │
             ┌───────────────────────────────┼───────────────────────────────┐
             │                               │                               │
             ▼                               ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│   System 1: POS & KDS     │   │ System 2: Customer Web    │   │ System 3: Driver App      │
│   (Cashier / Kitchen /    │   │ (Marketplace / QR Scan /  │   │ (Real-Time GPS / Auto-    │
│   Table Split / Thermal)  │   │ AI Voice / PayHere / PWA) │   │ Dispatch / Proof Delivery)│
└───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
```

---

## 🌟 3-System Platform Architecture

### 🏪 System 1: Restaurant POS & Kitchen Hub (`src/`)
* **Cashier & Counter Terminal:** High-speed touch checkout, table management, split-bill calculator (Even, Itemized, Custom Tenders).
* **Kitchen Display System (KDS):** Station routing (*Hot Kitchen*, *Cold Bar*, *Desserts*), prep timer countdowns, and sound alerts.
* **Offline Sales Queue Engine:** Local `IndexedDB` transaction storage with auto-sync (`/api/orders/offline-sync`) upon network restoration.
* **ESC/POS Thermal Spooler:** Direct printing support for receipts, kitchen dockets, and gapless fiscal invoices (`INV-XXXXXX`).

### 🍔 System 2: Customer Web & Marketplace App (`apps/customer-web/`)
* **Multi-Store Marketplace PWA:** Installable PWA with store directory, promo badges, and cuisine filters.
* **Precision Location Engine:** DoorDash-style **Interactive Leaflet Map Pin Picker**, forward geocoding, live address autocomplete search, and high-accuracy GPS lock.
* **Google Gemini AI Concierge & Voice Assistant:** Powered by **Google Gemini 1.5 Flash** for menu recommendations, budget combo building, and hands-free 🎙️ **Web Speech API** voice ordering.
* **Dual OTP Authentication:** Customer registration & login via **Email OTP** or **SMS Phone OTP**.
* **Tri-Lingual Localization:** Native dynamic switching between **English**, **Sinhala (සිංහල)**, and **Tamil (தமிழ்)**.
* **Payment Gateway:** Secure PayHere gateway integration with server-to-server webhook signature verification (`MD5`).

### 🛵 System 3: Driver Logistics & Fleet Partner App (`apps/driver-web/`)
* **Real-Time GPS Tracker:** High-frequency location broadcasting (`lat`, `lng`, `heading`, `speed`) every 5 seconds.
* **Proximity Auto-Dispatch:** Smart assignment engine routing unassigned orders to the closest available active rider.
* **Proof of Delivery (POD):** Interactive **HTML5 Canvas Signature Pad** and camera photo capture modal.
* **Turn-by-Turn Navigation:** 1-tap Google Maps routing and direct WhatsApp customer communication.

---

## 🛠️ Technology Stack

| Component | Technologies Used |
| :--- | :--- |
| **Frontend Frameworks** | React 18 · Vite 5 · PWA (Service Workers, Web Manifests) |
| **Styling & UI Design** | Custom Vanilla CSS Design System · Lucide Icons · Recharts |
| **Backend & API** | Node.js · Express 4 · Server-Sent Events (SSE) for Real-Time Push |
| **Database & ORM** | SQLite3 (Write-Ahead Logging mode) / PostgreSQL Ready |
| **AI & Voice Services** | Google Gemini 1.5 Flash API · Browser Web Speech API (`SpeechRecognition` & `SpeechSynthesis`) |
| **Maps & Geolocation** | Leaflet 1.9 · OpenStreetMap Nominatim Geocoding · HTML5 Geolocation API |
| **Security & Auth** | JWT Authentication · bcryptjs · Helmet HTTP Security · Express Rate Limiter |
| **Testing Framework** | Vitest (87 Unit & Integration Tests Passing) |

---

## 🚀 Quick Start & Installation

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation & Environment Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Rashid-RG/restaurant-pos.git
   cd restaurant-pos
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Launch all 3 applications concurrently:**
   ```bash
   npm run start:all
   ```

| Service | Local Address | Purpose |
| :--- | :--- | :--- |
| **Staff POS & Admin** | `http://localhost:3000` | Cashier, Kitchen KDS, Inventory, Reports |
| **Customer App** | `http://localhost:3001` | Customer PWA Marketplace & Ordering |
| **Driver Rider App** | `http://localhost:3002` | Fleet Driver Logistics & GPS Tracking |
| **Backend API** | `http://localhost:5000` | Unified REST API & SSE Real-Time Stream |

---

## 🧪 Testing & Verification

GastroFlow includes a comprehensive automated test suite powered by **Vitest**:

```bash
# Run full automated test suite
npm test
```

```
 RUN  v1.6.1 C:/Users/DELL/Downloads/restaurant-pos

 ✓ tests/plans.test.js  (5 tests)
 ✓ tests/billing.test.js  (49 tests)
 ✓ tests/tenant_isolation.test.js  (12 tests)
 ✓ tests/integration.test.js  (15 tests)
 ✓ tests/enterprise_features.test.js  (6 tests)

 Test Files  5 passed (5)
      Tests  87 passed (87)
   Duration  3.43s
```

---

## 🔒 Security Architecture & Money Integrity

- **Server-Authoritative Billing:** All item prices, taxes, service charges, discounts, and delivery fees are calculated on the server (`resolveAndCalculateBill`). Client-side price tampering is impossible.
- **Gapless Fiscal Invoicing:** Sequential, non-repeating fiscal numbers (`INV-000001`) allocated exclusively upon payment settlement inside database transactions.
- **PCI-DSS Compliance:** Card tokens and masked numbers only — zero raw credit card storage.
- **Multi-Tenant Isolation:** `X-Tenant-Id` header enforcement guarantees strict database isolation per store branch.

---

## 📄 Credits & Ownership

Crafted & Engineered by **RS Technologies 🇱🇰**  
**Founder & Chief Architect:** M.R.M Rashid  
*Certified Proprietary SaaS Engine · All Rights Reserved.*
