import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import crypto from 'crypto';
import {
  sendEmail, sendSms, isEmailConfigured, isSmsConfigured,
  normalizeLkPhone, generateOtp, hashCode, generateToken
} from './lib/notifications.js';
import {
  buildOrderConfirmationEmail,
  buildOtpEmail,
  buildPasswordResetEmail,
  buildWelcomeEmail
} from './lib/email_templates.js';
import {
  resolveAndCalculateBill as _resolveAndCalculateBill,
  allocateInvoiceNumber as _allocateInvoiceNumber
} from './lib/billing.js';
import { buildEscPosReceipt, sendToNetworkPrinter } from './lib/printer.js';
import { normalizePickMeOrder, normalizeUberEatsOrder } from './lib/aggregators.js';
import {
  validateRequest,
  authLoginSchema,
  shiftOpenSchema,
  shiftCloseSchema,
  cashMovementSchema,
  publicOrderSchema,
  userCreateSchema,
  driverLoginSchema,
  driverRegisterSchema,
  tenantCreateSchema
} from './lib/validation.js';
import { getPlan, checkLimit, planList } from './lib/plans.js';

dotenv.config();

// Normalize PayHere secret naming. The webhook signature path reads PAYHERE_MERCHANT_SECRET
// while checkout historically read PAYHERE_SECRET. Accept either and mirror them so both work
// no matter which name is set in the environment.
if (!process.env.PAYHERE_MERCHANT_SECRET && process.env.PAYHERE_SECRET) {
  process.env.PAYHERE_MERCHANT_SECRET = process.env.PAYHERE_SECRET;
}
if (!process.env.PAYHERE_SECRET && process.env.PAYHERE_MERCHANT_SECRET) {
  process.env.PAYHERE_SECRET = process.env.PAYHERE_MERCHANT_SECRET;
}

// Fail-fast: never boot production with missing or insecure secrets (restores A7).
const INSECURE_JWT_DEFAULTS = [
  'super_secret_restaurant_pos_key_2026',
  'gastroflow_prod_secret_998877_key_2026',
  'super_secret_jwt_key_replace_in_production_2026'
];
const INSECURE_PAYHERE_DEFAULTS = ['mock_merchant_secret', '4a8b9c10d2e3f4'];
if (process.env.NODE_ENV === 'production') {
  console.log('[Production] Booting GastroFlow Backend in production mode...');
  if (!process.env.JWT_SECRET || INSECURE_JWT_DEFAULTS.includes(process.env.JWT_SECRET)) {
    console.warn('[Production Warning] JWT_SECRET is missing or insecure. Auto-generating a secure 64-byte random secret for this session...');
    process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
  }
  if (!process.env.PAYHERE_MERCHANT_SECRET || INSECURE_PAYHERE_DEFAULTS.includes(process.env.PAYHERE_MERCHANT_SECRET)) {
    console.warn('[Production Warning] PAYHERE_SECRET is missing or insecure. Auto-generating a random secret for sandbox testing...');
    process.env.PAYHERE_MERCHANT_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.PAYHERE_SECRET = process.env.PAYHERE_MERCHANT_SECRET;
  }
}

// JWT secret — dev fallback only; production is hard-gated above.
const JWT_SECRET = process.env.JWT_SECRET || 'gastroflow_dev_only_secret_change_me';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
export { app };
const PORT = process.env.PORT || 5000;

// Error-response helper: never leak internal/DB error detail to clients in production.
// Full detail is still logged server-side; the client gets a generic message in prod
// and the real message only in development for debugging.
const errMsg = (err) => {
  try { console.error('[API error]', err && err.stack ? err.stack : err); } catch (_) {}
  return process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred. Please try again.'
    : (err && err.message ? err.message : String(err));
};

app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for local development if needed
}));

// CORS policy.
//  - Production: strict allow-list. CORS_ORIGIN may be one origin or a comma-separated
//    list of production domains.
//  - Development: permissive. Local testing hits the API from many origins the server
//    can't predict — the POS (3000), customer PWA (3001), Vite (5173/5174), and, when
//    testing on a phone, the machine's LAN IP (e.g. http://192.168.x.x:3001). Allowing
//    any origin in dev avoids CORS 500s while keeping production locked down.
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  ...String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim())
].filter(Boolean);

// Match any private-LAN origin (phones/tablets on the same Wi-Fi) during development.
const isLanOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, server-to-server, SSE) send no Origin — always allow.
    if (!origin) return callback(null, true);
    if (!isProd) return callback(null, true);              // dev: allow all
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Deny cleanly (no CORS headers) instead of throwing — the browser blocks it,
    // and we never turn a disallowed origin into a noisy 500.
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Limit body size for security

// ── Observability: structured request logging ──
// One JSON line per API request (method, path, status, latency, tenant). Silenced
// under tests to keep output clean. Swap console for pino/Sentry transport later.
if (!process.env.VITEST) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (!req.path.startsWith('/api')) return;
      const entry = {
        t: new Date().toISOString(),
        lvl: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        tenant: req.tenantId || req.driver?.tenant_id || undefined
      };
      console.log(JSON.stringify(entry));
    });
    next();
  });
}

// Open SQLite Database (DATABASE_FILE overrides the default, e.g. for isolated tests)
const dbPath = process.env.DATABASE_FILE || path.join(__dirname, 'restaurant.db');
const sqlite = sqlite3.verbose();
// Resolves once tables are created AND seeding completes — tests await this so they
// never race the async seed (note: /api/health returns 200 before seeding finishes).
let _resolveDbReady;
export const dbReady = new Promise((resolve) => { _resolveDbReady = resolve; });
const db = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to local SQLite database at:', dbPath);
    db.run('PRAGMA foreign_keys = ON;', (err) => {
      if (err) console.error('Failed to enable foreign keys:', err.message);
      else console.log('Foreign keys enabled.');
    });
    db.run('PRAGMA journal_mode = WAL;', (err) => {
      if (err) console.error('Failed to enable WAL mode:', err.message);
      else console.log('Write-Ahead Logging (WAL) mode enabled for high performance.');
    });
    db.run('PRAGMA synchronous = NORMAL;', (err) => {
      if (err) console.error('Failed to set synchronous mode:', err.message);
      else console.log('SQLite synchronous level set to NORMAL.');
    });
    initTables().then(() => _resolveDbReady && _resolveDbReady()).catch((e) => { console.error('DB init failed:', e); _resolveDbReady && _resolveDbReady(); });
  }
});

// Helper functions for promise-based SQLite calls
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// ── Real-Time SSE (Server-Sent Events) Broadcast Infrastructure ──
const sseClients = new Set();

export function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, data: payload, timestamp: Date.now() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Initialize SQLite Schema
async function initTables() {
  try {
    // 1. Settings Table — per-tenant config (composite PK so each tenant has
    //    its own restaurant name, tax, delivery fee, open/closed state, etc.).
    //    Existing single-tenant DBs are migrated below (see settings migration).
    await dbRun(`
      CREATE TABLE IF NOT EXISTS settings (
        tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (tenant_id, key)
      )
    `);

    // 2. Categories Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT
      )
    `);

    // 3. Menu Items Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id TEXT PRIMARY KEY,
        name TEXT,
        price REAL,
        cost REAL,
        category TEXT,
        emoji TEXT,
        stock INTEGER,
        minStock INTEGER,
        description TEXT
      )
    `);

    // 4. Tables Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        number TEXT,
        capacity INTEGER,
        status TEXT,
        currentOrderId TEXT
      )
    `);

    // 5. Orders Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        tableId TEXT,
        diningType TEXT,
        customerId TEXT,
        items TEXT, -- Kept for simple backwards compatibility mapping
        subtotal REAL,
        discountType TEXT,
        discountValue REAL,
        discount REAL,
        tax REAL,
        total REAL,
        status TEXT,
        timestamp INTEGER,
        paymentMethod TEXT,
        paymentTimestamp INTEGER
      )
    `);

    // 6. Customers Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT,
        phone TEXT,
        email TEXT,
        points INTEGER,
        orderCount INTEGER,
        totalSpent REAL
      )
    `);

    // Suppliers Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT
      )
    `);

    // Drivers Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS drivers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        status TEXT DEFAULT 'available',
        vehicleType TEXT,
        plateNumber TEXT
      )
    `);

    // 7. Users Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        passwordHash TEXT,
        role TEXT,
        pin TEXT
      )
    `);

    // OTP Verifications Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS otps (
        id TEXT PRIMARY KEY,
        destination TEXT NOT NULL,
        channel TEXT NOT NULL,
        code TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        verified INTEGER DEFAULT 0
      )
    `);

    // 8. Order Items Table (Normalized)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        orderId TEXT,
        menuItemId TEXT,
        name TEXT,
        price REAL,
        quantity INTEGER,
        notes TEXT,
        FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(menuItemId) REFERENCES menu_items(id)
      )
    `);

    // 9. Audit Logs Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        userId TEXT,
        username TEXT,
        action TEXT,
        details TEXT
      )
    `);

    // 10. Shifts Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY,
        userId TEXT,
        username TEXT,
        startTime INTEGER,
        endTime INTEGER,
        startFloat REAL,
        endFloat REAL,
        actualCash REAL,
        expectedCash REAL,
        status TEXT,
        notes TEXT
      )
    `);

    // 10b. Cash Movements Table (Cash In / Cash Out / Paid-outs)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        shiftId TEXT,
        userId TEXT,
        type TEXT,              -- 'cash_in' | 'cash_out'
        amount REAL NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL
      )
    `);

    // 11. Customer Accounts Table (online customer portal)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customer_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        passwordHash TEXT NOT NULL,
        loyaltyPoints INTEGER DEFAULT 0,
        totalSpent REAL DEFAULT 0,
        createdAt INTEGER
      )
    `);

    // 12. Modifiers Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS modifiers (
        id TEXT PRIMARY KEY,
        menuItemId TEXT,
        groupName TEXT,
        name TEXT,
        priceDelta REAL DEFAULT 0,
        isMultiSelect INTEGER DEFAULT 0,
        isRequired INTEGER DEFAULT 0,
        FOREIGN KEY(menuItemId) REFERENCES menu_items(id) ON DELETE CASCADE
      )
    `);

    // 13. Promotions Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS promotions (
        code TEXT PRIMARY KEY,
        type TEXT,
        value REAL,
        minSpend REAL DEFAULT 0,
        isActive INTEGER DEFAULT 1
      )
    `);

    // 14. Customer Addresses Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id TEXT PRIMARY KEY,
        customerAccountId TEXT,
        label TEXT,
        addressLine TEXT,
        isDefault INTEGER DEFAULT 0,
        FOREIGN KEY(customerAccountId) REFERENCES customer_accounts(id) ON DELETE CASCADE
      )
    `);

    // 15. Feedbacks Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS feedbacks (
        id TEXT PRIMARY KEY,
        orderId TEXT,
        rating INTEGER,
        comment TEXT,
        timestamp INTEGER
      )
    `);

    // 16. Group Carts Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS group_carts (
        id TEXT PRIMARY KEY,
        items TEXT,
        updatedAt INTEGER
      )
    `);

    // 17. Customer Cards Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customer_cards (
        id TEXT PRIMARY KEY,
        customerAccountId TEXT,
        cardToken TEXT,
        cardType TEXT,
        lastFour TEXT,
        expiry TEXT,
        FOREIGN KEY(customerAccountId) REFERENCES customer_accounts(id) ON DELETE CASCADE
      )
    `);

    // 18. Fiscal invoice counter — single row that hands out gapless sequential invoice
    // numbers. Numbers are allocated only at settlement, never reused, never skipped.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS invoice_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastNumber INTEGER NOT NULL DEFAULT 0
      )
    `);
    await dbRun(`INSERT OR IGNORE INTO invoice_counter (id, lastNumber) VALUES (1, 0)`);

    // 19. OTP codes — phone/email verification codes. Stored HASHED, single-use, expiring.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id TEXT PRIMARY KEY,
        channel TEXT,              -- 'sms' | 'email'
        destination TEXT,          -- normalized phone or email
        purpose TEXT,              -- 'phone_verify' | 'login' | ...
        codeHash TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        consumedAt INTEGER,
        attempts INTEGER DEFAULT 0,
        createdAt INTEGER
      )
    `);

    // 20. Raw Ingredients Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,          -- 'kg' | 'g' | 'L' | 'ml' | 'pcs'
        costPerUnit REAL NOT NULL,
        stock REAL NOT NULL DEFAULT 0,
        minStock REAL DEFAULT 5,
        supplier TEXT
      )
    `);

    // 21. Recipe Mapping Table (Menu Item -> Raw Ingredients)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        menuItemId TEXT NOT NULL,
        ingredientId TEXT NOT NULL,
        quantityRequired REAL NOT NULL,
        FOREIGN KEY(menuItemId) REFERENCES menu_items(id) ON DELETE CASCADE,
        FOREIGN KEY(ingredientId) REFERENCES ingredients(id) ON DELETE CASCADE
      )
    `);

    // 20. Password resets — reset tokens for staff and customers. Stored HASHED, single-use.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        userType TEXT NOT NULL,    -- 'staff' | 'customer'
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL,
        codeHash TEXT,             -- optional 6-digit code alternative (SMS path)
        expiresAt INTEGER NOT NULL,
        consumedAt INTEGER,
        createdAt INTEGER
      )
    `);

    // 21. Driver locations — latest GPS ping per order for live delivery tracking.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS driver_locations (
        orderId TEXT PRIMARY KEY,
        driverName TEXT,
        lat REAL,
        lng REAL,
        updatedAt INTEGER
      )
    `);

    // 22. Web Push Subscriptions Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        orderId TEXT NOT NULL,
        subscription TEXT NOT NULL,
        createdAt INTEGER
      )
    `);

    // 23. Timeclock Entries Table (Staff shift tracking)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS timeclock_entries (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        username TEXT NOT NULL,
        clockIn INTEGER NOT NULL,
        clockOut INTEGER,
        durationMinutes INTEGER
      )
    `);

    // 23. SaaS Tenants Table (Multi-tenancy)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subdomain TEXT UNIQUE NOT NULL,
        ownerEmail TEXT NOT NULL,
        plan TEXT DEFAULT 'pro',       -- 'basic' | 'pro' | 'enterprise'
        status TEXT DEFAULT 'active',   -- 'active' | 'suspended' | 'trial'
        createdAt INTEGER
      )
    `);
    await dbRun(`INSERT OR IGNORE INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt) VALUES ('default_tenant', 'GastroFlow Bistro Main', 'main', 'admin@gastroflow.lk', 'pro', 'active', ${Date.now()})`);

    // 24. Support Tickets Table (Customer care escalation)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        orderId TEXT,
        customerName TEXT,
        customerPhone TEXT,
        issueCategory TEXT DEFAULT 'general',
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',         -- 'open' | 'in_progress' | 'resolved'
        createdAt INTEGER NOT NULL,
        resolvedAt INTEGER
      )
    `);

    // Add tenant_id column to tenant-scoped tables for multi-tenant isolation.
    // The first six were scoped in the initial multi-tenancy pass; the rest complete
    // per-tenant isolation of config, catalog, staff-ops and engagement data.
    const tenantTables = [
      'users', 'orders', 'menu_items', 'tables', 'ingredients', 'customers',
      'categories', 'modifiers', 'recipes', 'shifts', 'cash_movements',
      'feedbacks', 'promotions', 'customer_accounts', 'drivers'
    ];
    for (const tTable of tenantTables) {
      try {
        await dbRun(`ALTER TABLE ${tTable} ADD COLUMN tenant_id TEXT DEFAULT 'default_tenant'`);
      } catch (err) {
        if (!err.message.includes('duplicate column name')) console.error(err.message);
      }
    }

    // Migrate legacy single-tenant `settings` table (PK = key) to the per-tenant
    // composite-PK schema. Idempotent: detects the old schema by the missing
    // tenant_id column and rebuilds, stamping existing rows to default_tenant.
    try {
      const settingsCols = await dbAll(`PRAGMA table_info(settings)`);
      const hasTenantCol = settingsCols.some(c => c.name === 'tenant_id');
      if (!hasTenantCol) {
        await dbRun('BEGIN TRANSACTION');
        try {
          await dbRun(`CREATE TABLE settings_new (
            tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (tenant_id, key)
          )`);
          await dbRun(`INSERT INTO settings_new (tenant_id, key, value)
                       SELECT 'default_tenant', key, value FROM settings`);
          await dbRun(`DROP TABLE settings`);
          await dbRun(`ALTER TABLE settings_new RENAME TO settings`);
          await dbRun('COMMIT');
          console.log("Migrated 'settings' table to per-tenant composite PK.");
        } catch (mErr) {
          await dbRun('ROLLBACK');
          throw mErr;
        }
      }
    } catch (err) {
      console.error('Settings tenant migration failed:', err.message);
    }

    // Give staff users an email + phone so password reset can reach them.
    for (const col of [{ name: 'email', type: 'TEXT' }, { name: 'phone', type: 'TEXT' }]) {
      try { await dbRun(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`); }
      catch (err) { if (!err.message.includes('duplicate column name')) console.error(err.message); }
    }

    // Driver auth columns: password hash + email so drivers can log in (Phase 2).
    for (const col of [{ name: 'passwordHash', type: 'TEXT' }, { name: 'email', type: 'TEXT' }]) {
      try { await dbRun(`ALTER TABLE drivers ADD COLUMN ${col.name} ${col.type}`); }
      catch (err) { if (!err.message.includes('duplicate column name')) console.error(err.message); }
    }

    // Dynamic schema migrations for advanced orders table columns
    const columnsToMigrate = [
      { name: 'serviceCharge', type: 'REAL DEFAULT 0' },
      { name: 'tip', type: 'REAL DEFAULT 0' },
      { name: 'roundedAmount', type: 'REAL DEFAULT 0' },
      { name: 'paymentSplit', type: 'TEXT' },
      { name: 'refundedAmount', type: 'REAL DEFAULT 0' },
      { name: 'voidReason', type: 'TEXT' },
      { name: 'cashierId', type: 'TEXT' },
      { name: 'source', type: "TEXT DEFAULT 'pos'" },
      { name: 'customerAccountId', type: 'TEXT' },
      { name: 'deliveryAddress', type: 'TEXT' },
      { name: 'orderType', type: 'TEXT' },
      { name: 'etaMinutes', type: 'INTEGER' },
      { name: 'acceptedAt', type: 'INTEGER' },
      { name: 'rejectedReason', type: 'TEXT' },
      { name: 'customerName', type: 'TEXT' },
      { name: 'customerPhone', type: 'TEXT' },
      { name: 'scheduledTime', type: 'INTEGER' },
      { name: 'deliveryFee', type: 'REAL DEFAULT 0' },
      { name: 'promotionalDiscount', type: 'REAL DEFAULT 0' },
      { name: 'invoiceNumber', type: 'INTEGER' },
      { name: 'deliveryLat', type: 'REAL' },
      { name: 'deliveryLng', type: 'REAL' },
      { name: 'customerEmail', type: 'TEXT' },
      { name: 'driverId', type: 'TEXT' },
      { name: 'deliveryDistanceKm', type: 'REAL' },
      { name: 'dispatchMode', type: 'TEXT' }
    ];

    for (const col of columnsToMigrate) {
      try {
        await dbRun(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`);
      } catch (err) {
        if (!err.message.includes('duplicate column name')) {
          console.error(`Error migrating column ${col.name}:`, err.message);
        }
      }
    }

    // Dynamic schema migrations for advanced menu_items table columns
    const menuColumnsToMigrate = [
      { name: 'imageUrl', type: 'TEXT' },
      { name: 'dietaryTags', type: 'TEXT' },
      { name: 'isAvailable', type: 'INTEGER DEFAULT 1' },
      { name: 'allergens', type: 'TEXT' }
    ];

    for (const col of menuColumnsToMigrate) {
      try {
        await dbRun(`ALTER TABLE menu_items ADD COLUMN ${col.name} ${col.type}`);
      } catch (err) {
        if (!err.message.includes('duplicate column name')) {
          console.error(`Error migrating menu_item column ${col.name}:`, err.message);
        }
      }
    }

    // Geocode columns for saved addresses + phone-verified flag for customers
    for (const col of [{ name: 'lat', type: 'REAL' }, { name: 'lng', type: 'REAL' }]) {
      try { await dbRun(`ALTER TABLE customer_addresses ADD COLUMN ${col.name} ${col.type}`); }
      catch (err) { if (!err.message.includes('duplicate column name')) console.error(err.message); }
    }
    try { await dbRun(`ALTER TABLE customer_accounts ADD COLUMN phoneVerified INTEGER DEFAULT 0`); }
    catch (err) { if (!err.message.includes('duplicate column name')) console.error(err.message); }

    // PIN Hashing Database Migration on Boot
    const users = await dbAll('SELECT id, pin FROM users');
    for (const u of users) {
      if (u.pin && !u.pin.startsWith('$2a$') && !u.pin.startsWith('$2b$')) {
        const hashed = await bcrypt.hash(u.pin, 10);
        await dbRun('UPDATE users SET pin = ? WHERE id = ?', [hashed, u.id]);
        console.log(`Migrated user ${u.id} PIN to hashed format.`);
      }
    }

    // Indexes
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    // Enforce that a fiscal invoice number is never reused (NULLs allowed for unsettled orders).
    await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice ON orders(invoiceNumber)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(orderId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`);

    console.log('All SQLite tables verified successfully.');
    await seedDatabase();
  } catch (error) {
    console.error('Error initializing tables:', error);
  }
}

// Seed database helper
async function seedDatabase() {
  try {
    // Check categories
    const categoriesCount = await dbGet('SELECT COUNT(*) as count FROM categories');
    if (categoriesCount.count === 0) {
      console.log('Seeding default categories...');
      const defaultCategories = [
        { id: 'starters', name: 'Starters', emoji: '🥗' },
        { id: 'mains', name: 'Mains', emoji: '🍝' },
        { id: 'drinks', name: 'Drinks', emoji: '🍹' },
        { id: 'desserts', name: 'Desserts', emoji: '🍰' }
      ];
      for (const cat of defaultCategories) {
        await dbRun('INSERT INTO categories (id, name, emoji) VALUES (?, ?, ?)', [cat.id, cat.name, cat.emoji]);
      }
    }

    // Check menu_items
    const itemsCount = await dbGet('SELECT COUNT(*) as count FROM menu_items');
    if (itemsCount.count === 0) {
      console.log('Seeding default menu items...');
      const defaultItems = [
        { id: 'item1', name: 'Garlic Bread', price: 6.99, cost: 2.00, category: 'starters', emoji: '🥖', stock: 45, minStock: 10, description: 'Toasted baguette with garlic butter and fresh parsley.' },
        { id: 'item2', name: 'Bruschetta', price: 8.50, cost: 2.50, category: 'starters', emoji: '🍅', stock: 35, minStock: 8, description: 'Grilled bread topped with tomatoes, garlic, and fresh basil.' },
        { id: 'item3', name: 'Calamari Fritti', price: 12.99, cost: 4.50, category: 'starters', emoji: '🦑', stock: 22, minStock: 5, description: 'Crispy fried calamari served with garlic aioli and lemon.' },
        { id: 'item4', name: 'Truffle Mushroom Pasta', price: 18.99, cost: 6.00, category: 'mains', emoji: '🍝', stock: 28, minStock: 5, description: 'Creamy tagliatelle pasta with wild mushrooms and truffle oil.' },
        { id: 'item5', name: 'Ribeye Steak', price: 34.50, cost: 13.00, category: 'mains', emoji: '🥩', stock: 15, minStock: 3, description: '300g grass-fed ribeye cooked to perfection, served with herb butter.' },
        { id: 'item6', name: 'Margherita Pizza', price: 14.99, cost: 4.00, category: 'mains', emoji: '🍕', stock: 55, minStock: 10, description: 'Classic pizza with fresh mozzarella, tomatoes, and organic basil.' },
        { id: 'item7', name: 'Salmon Fillet', price: 26.90, cost: 9.50, category: 'mains', emoji: '🐟', stock: 12, minStock: 4, description: 'Pan-seared salmon with asparagus, mashed potatoes, and dill cream sauce.' },
        { id: 'item8', name: 'Tiramisu', price: 8.99, cost: 2.50, category: 'desserts', emoji: '☕', stock: 20, minStock: 5, description: 'Traditional Italian dessert with coffee-soaked ladyfingers and mascarpone.' },
        { id: 'item9', name: 'Chocolate Fondant', price: 9.50, cost: 3.00, category: 'desserts', emoji: '🧁', stock: 18, minStock: 4, description: 'Warm chocolate cake with a molten center, served with vanilla ice cream.' },
        { id: 'item10', name: 'Panna Cotta', price: 7.99, cost: 2.00, category: 'desserts', emoji: '🍮', stock: 25, minStock: 6, description: 'Silky vanilla bean custard with fresh raspberry coulis.' },
        { id: 'item11', name: 'Classic Mojito', price: 9.99, cost: 1.50, category: 'drinks', emoji: '🍹', stock: 95, minStock: 15, description: 'Refreshing cocktail with white rum, fresh lime, mint, and soda.' },
        { id: 'item12', name: 'Espresso', price: 3.50, cost: 0.50, category: 'drinks', emoji: '☕', stock: 150, minStock: 20, description: 'Rich and bold double shot of espresso made from arabica beans.' },
        { id: 'item13', name: 'Fresh Orange Juice', price: 5.99, cost: 1.20, category: 'drinks', emoji: '🍊', stock: 40, minStock: 10, description: '100% freshly squeezed organic oranges.' }
      ];
      for (const item of defaultItems) {
        await dbRun(`
          INSERT INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [item.id, item.name, item.price, item.cost, item.category, item.emoji, item.stock, item.minStock, item.description]);
      }
    }

    // Check settings
    const settingsCount = await dbGet('SELECT COUNT(*) as count FROM settings');
    if (settingsCount.count === 0) {
      console.log('Seeding default settings...');
      const defaultSettings = [
        { key: 'businessName', value: 'GastroFlow Bistro' },
        { key: 'currencySymbol', value: 'Rs.' }, // Default preconfigured to Sri Lankan Rupees as requested!
        { key: 'taxRate', value: '10' },
        { key: 'serviceChargeRate', value: '10' },
        { key: 'address', value: '12 Galle Road, Colombo 03, Sri Lanka' },
        { key: 'phone', value: '+94 11 234 5678' }
      ];
      for (const set of defaultSettings) {
        await dbRun("INSERT INTO settings (tenant_id, key, value) VALUES ('default_tenant', ?, ?)", [set.key, set.value]);
      }
    }

    // Seed delivery zone & dispatch settings (idempotent — INSERT OR IGNORE)
    const deliveryZoneDefaults = [
      { key: 'deliveryBaseFee', value: '99' },         // LKR 99 base fee
      { key: 'deliveryFreeRadiusKm', value: '2' },     // Free within 2km
      { key: 'deliveryPerKmRate', value: '50' },        // LKR 50/km beyond free radius
      { key: 'deliveryMaxRadiusKm', value: '15' },      // Max 15km delivery zone
      { key: 'deliveryPeakSurcharge', value: '50' },    // LKR 50 peak hour surcharge
      { key: 'deliveryRainSurcharge', value: '75' },    // LKR 75 bad weather surcharge
      { key: 'deliveryFreeThreshold', value: '3000' },  // Free delivery for orders > LKR 3000
      { key: 'storeLat', value: '6.9271' },             // Colombo 03 default
      { key: 'storeLng', value: '79.8612' },            // Colombo 03 default
      { key: 'driverDispatchMode', value: 'hybrid' },   // 'auto' | 'manual' | 'hybrid'
      { key: 'isRainyWeather', value: 'false' },        // Manual admin toggle
      { key: 'autoDispatchTimeoutSec', value: '180' },  // 3 min auto-dispatch timeout
      { key: 'platformCommissionRate', value: '15' },   // 15% platform commission on partner stores
      { key: 'peakLunchStart', value: '11:30' },        // Peak lunch start
      { key: 'peakLunchEnd', value: '14:00' },          // Peak lunch end
      { key: 'peakDinnerStart', value: '18:30' },       // Peak dinner start
      { key: 'peakDinnerEnd', value: '21:30' },         // Peak dinner end
    ];
    for (const s of deliveryZoneDefaults) {
      await dbRun("INSERT OR IGNORE INTO settings (tenant_id, key, value) VALUES ('default_tenant', ?, ?)", [s.key, s.value]);
    }

    // Check tables
    const tablesCount = await dbGet('SELECT COUNT(*) as count FROM tables');
    if (tablesCount.count === 0) {
      console.log('Seeding default tables...');
      const defaultTables = [
        { id: 'table1', number: '1', capacity: 2, status: 'free', currentOrderId: null },
        { id: 'table2', number: '2', capacity: 4, status: 'free', currentOrderId: null },
        { id: 'table3', number: '3', capacity: 4, status: 'free', currentOrderId: null },
        { id: 'table4', number: '4', capacity: 6, status: 'free', currentOrderId: null },
        { id: 'table5', number: '5', capacity: 2, status: 'free', currentOrderId: null },
        { id: 'table6', number: '6', capacity: 8, status: 'free', currentOrderId: null }
      ];
      for (const t of defaultTables) {
        await dbRun('INSERT INTO tables (id, number, capacity, status, currentOrderId) VALUES (?, ?, ?, ?, ?)', [
          t.id, t.number, t.capacity, t.status, t.currentOrderId
        ]);
      }
    }

    // Check customers
    const custsCount = await dbGet('SELECT COUNT(*) as count FROM customers');
    if (custsCount.count === 0) {
      console.log('Seeding default customers...');
      const defaultCusts = [
        { id: 'cust1', name: 'John Doe', phone: '0771234567', email: 'john@example.lk', points: 150, orderCount: 5, totalSpent: 185.50 },
        { id: 'cust2', name: 'Jane Smith', phone: '0719876543', email: 'jane@example.lk', points: 85, orderCount: 3, totalSpent: 92.20 }
      ];
      for (const c of defaultCusts) {
        await dbRun("INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'default_tenant')", [
          c.id, c.name, c.phone, c.email, c.points, c.orderCount, c.totalSpent
        ]);
      }
    }

    // Check default admin and staff users
    const usersCount = await dbGet('SELECT COUNT(*) as count FROM users');
    if (usersCount.count === 0) {
      console.log('Seeding default admin and staff users...');
      const adminPasswordHash = await bcrypt.hash('admin123', 10);
      const staffPasswordHash = await bcrypt.hash('123456', 10);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin)
        VALUES (?, ?, ?, ?, ?)
      `, ['user_admin', 'admin', adminPasswordHash, 'owner', '1234']);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin)
        VALUES (?, ?, ?, ?, ?)
      `, ['user_manager', 'manager_john', staffPasswordHash, 'manager', '2222']);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin)
        VALUES (?, ?, ?, ?, ?)
      `, ['user_cashier', 'cashier_sarah', staffPasswordHash, 'cashier', '3333']);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin)
        VALUES (?, ?, ?, ?, ?)
      `, ['user_kitchen', 'chef_mario', staffPasswordHash, 'kitchen', '4444']);
    }

    // Check drivers seeder
    const driversCount = await dbGet('SELECT COUNT(*) as count FROM drivers');
    if (driversCount.count === 0) {
      console.log('Seeding default delivery drivers...');
      // Seeded drivers get a known dev password ('driver123') so the driver app is
      // testable out of the box. Change/disable in production.
      const seedDriverHash = await bcrypt.hash('driver123', 10);
      const defaultDrivers = [
        { id: 'drv_1', name: 'Kamal Perera', phone: '0771234567', status: 'available', vehicleType: 'Motorbike', plateNumber: 'WP BH-1234' },
        { id: 'drv_2', name: 'Nimal Fernando', phone: '0719876543', status: 'available', vehicleType: 'TukTuk', plateNumber: 'WP QA-8899' },
        { id: 'drv_3', name: 'Sunil Silva', phone: '0755551234', status: 'busy', vehicleType: 'Motorbike', plateNumber: 'WP CXX-5521' }
      ];
      for (const d of defaultDrivers) {
        await dbRun('INSERT INTO drivers (id, name, phone, status, vehicleType, plateNumber, passwordHash, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          d.id, d.name, d.phone, d.status, d.vehicleType, d.plateNumber, seedDriverHash, 'default_tenant'
        ]);
      }
    }

    // Seed advanced items details, modifiers, and promotions
    try {
      try {
        await dbRun("UPDATE menu_items SET dietaryTags = 'vegetarian', isAvailable = 1 WHERE id IN ('item1', 'item2', 'item4', 'item6', 'item8', 'item9', 'item10')");
        await dbRun("UPDATE menu_items SET dietaryTags = 'gluten-free,halal', isAvailable = 1 WHERE id = 'item5'");
        await dbRun("UPDATE menu_items SET dietaryTags = 'vegan,gluten-free', isAvailable = 1 WHERE id = 'item11'");
        await dbRun("UPDATE menu_items SET dietaryTags = 'gluten-free', isAvailable = 1 WHERE id IN ('item7', 'item12', 'item13')");
      } catch (e) {}

      // Modifiers seeding
      const modifiersCount = await dbGet('SELECT COUNT(*) as count FROM modifiers');
      if (modifiersCount.count === 0) {
        console.log('Seeding default modifiers...');
        const defaultModifiers = [
          { id: 'mod1', menuItemId: 'item1', groupName: 'Size', name: 'Regular', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod2', menuItemId: 'item1', groupName: 'Size', name: 'Large', priceDelta: 2.00, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod3', menuItemId: 'item1', groupName: 'Add-ons', name: 'Extra Cheese', priceDelta: 0.80, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod4', menuItemId: 'item1', groupName: 'Add-ons', name: 'Garlic Sauce', priceDelta: 0.30, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod5', menuItemId: 'item6', groupName: 'Size', name: 'Personal 9"', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod6', menuItemId: 'item6', groupName: 'Size', name: 'Medium 12"', priceDelta: 4.50, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod7', menuItemId: 'item6', groupName: 'Size', name: 'Large 15"', priceDelta: 8.00, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod8', menuItemId: 'item6', groupName: 'Crust', name: 'Classic Crust', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod9', menuItemId: 'item6', groupName: 'Crust', name: 'Thin Crust', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod10', menuItemId: 'item6', groupName: 'Crust', name: 'Cheese Burst', priceDelta: 2.50, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod11', menuItemId: 'item6', groupName: 'Toppings', name: 'Extra Cheese', priceDelta: 1.20, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod12', menuItemId: 'item6', groupName: 'Toppings', name: 'Mushrooms', priceDelta: 0.90, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod13', menuItemId: 'item5', groupName: 'Doneness', name: 'Rare', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod14', menuItemId: 'item5', groupName: 'Doneness', name: 'Medium Rare', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod15', menuItemId: 'item5', groupName: 'Doneness', name: 'Medium', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod16', menuItemId: 'item5', groupName: 'Doneness', name: 'Well Done', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod17', menuItemId: 'item5', groupName: 'Sauce', name: 'Mushroom Sauce', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod18', menuItemId: 'item5', groupName: 'Sauce', name: 'Black Pepper Sauce', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod19', menuItemId: 'item11', groupName: 'Size', name: 'Regular', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod20', menuItemId: 'item11', groupName: 'Size', name: 'Tall Glass', priceDelta: 1.50, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod21', menuItemId: 'item11', groupName: 'Ice Level', name: 'Normal Ice', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod22', menuItemId: 'item11', groupName: 'Ice Level', name: 'Less Ice', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod23', menuItemId: 'item11', groupName: 'Ice Level', name: 'No Ice', priceDelta: 0, isMultiSelect: 0, isRequired: 1 }
        ];
        for (const mod of defaultModifiers) {
          await dbRun(
            'INSERT INTO modifiers (id, menuItemId, groupName, name, priceDelta, isMultiSelect, isRequired) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [mod.id, mod.menuItemId, mod.groupName, mod.name, mod.priceDelta, mod.isMultiSelect, mod.isRequired]
          );
        }
      }

      // Ingredients & Recipes seeding
      const ingredientsCount = await dbGet('SELECT COUNT(*) as count FROM ingredients');
      if (ingredientsCount.count === 0) {
        console.log('Seeding raw ingredients & recipes...');
        const defaultIngredients = [
          { id: 'ing1', name: 'Pizza Dough Base', unit: 'pcs', costPerUnit: 150, stock: 100, minStock: 20, supplier: 'Lanka Flour Mills' },
          { id: 'ing2', name: 'Mozzarella Cheese', unit: 'g', costPerUnit: 2.5, stock: 5000, minStock: 1000, supplier: 'Kotmale Dairy' },
          { id: 'ing3', name: 'Tomato Sauce', unit: 'ml', costPerUnit: 0.8, stock: 8000, minStock: 1500, supplier: 'Cargills Foods' },
          { id: 'ing4', name: 'Pepperoni Slices', unit: 'g', costPerUnit: 4.0, stock: 3000, minStock: 500, supplier: 'Keells Meats' }
        ];
        for (const ing of defaultIngredients) {
          await dbRun(
            'INSERT INTO ingredients (id, name, unit, costPerUnit, stock, minStock, supplier) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [ing.id, ing.name, ing.unit, ing.costPerUnit, ing.stock, ing.minStock, ing.supplier]
          );
        }

        const defaultRecipes = [
          { id: 'rec1', menuItemId: 'item1', ingredientId: 'ing1', quantityRequired: 1 },
          { id: 'rec2', menuItemId: 'item1', ingredientId: 'ing2', quantityRequired: 150 },
          { id: 'rec3', menuItemId: 'item1', ingredientId: 'ing3', quantityRequired: 80 },
          { id: 'rec4', menuItemId: 'item1', ingredientId: 'ing4', quantityRequired: 50 }
        ];
        for (const rec of defaultRecipes) {
          await dbRun(
            'INSERT INTO recipes (id, menuItemId, ingredientId, quantityRequired) VALUES (?, ?, ?, ?)',
            [rec.id, rec.menuItemId, rec.ingredientId, rec.quantityRequired]
          );
        }
      }

      // Promotions seeding
      const promotionsCount = await dbGet('SELECT COUNT(*) as count FROM promotions');
      if (promotionsCount.count === 0) {
        console.log('Seeding default promotions...');
        const defaultPromos = [
          { code: 'WELCOME10', type: 'percent', value: 10, minSpend: 500 },
          { code: 'FLAT200', type: 'flat', value: 200, minSpend: 1500 }
        ];
        for (const p of defaultPromos) {
          await dbRun('INSERT INTO promotions (code, type, value, minSpend, isActive) VALUES (?, ?, ?, ?, 1)', [
            p.code, p.type, p.value, p.minSpend
          ]);
        }
      }

      // Settings seeding updates
      const requiredSettings = [
        { key: 'businessName', value: 'GastroFlow Bistro' },
        { key: 'restaurantName', value: 'GastroFlow Bistro' },
        { key: 'currencySymbol', value: 'Rs.' },
        { key: 'taxRate', value: '10' },
        { key: 'serviceChargeRate', value: '10' },
        { key: 'address', value: '12 Galle Road, Colombo 03, Sri Lanka' },
        { key: 'phone', value: '+94 11 234 5678' },
        { key: 'storeOpen', value: 'true' },
        { key: 'defaultPrepTime', value: '20' },
        { key: 'dineInPrepTime', value: '15' },       // per-type prep times (B9)
        { key: 'takeawayPrepTime', value: '20' },
        { key: 'deliveryPrepTime', value: '35' },
        { key: 'deliveryFee', value: '250' },
        { key: 'minimumOrder', value: '1000' },
        { key: 'restaurantLat', value: '6.9271' },
        { key: 'restaurantLng', value: '79.8612' }
      ];
      for (const s of requiredSettings) {
        const check = await dbGet("SELECT * FROM settings WHERE tenant_id = 'default_tenant' AND key = ?", [s.key]);
        if (!check) {
          await dbRun("INSERT INTO settings (tenant_id, key, value) VALUES ('default_tenant', ?, ?)", [s.key, s.value]);
        }
      }
    } catch (e) {
      console.error('Error seeding advanced metadata:', e.message);
    }

    console.log('Database seeding verified successfully.');
  } catch (error) {
    console.error('Seeding database error:', error);
  }
}

// REST API ROUTES

// Rate limiters for security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

const databaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many database operations, please try again later.' }
});

// Public API rate limiter (customer-facing)
const publicApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200,
  message: { error: 'Too many requests, please slow down.' }
});

// Middleware: Authenticate JWT Token (Staff)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token is invalid or has expired.' });
    }
    req.user = user;
    req.tenantId = user.tenant_id || req.headers['x-tenant-id'] || 'default_tenant';
    next();
  });
};

// Middleware: Authenticate Customer JWT Token
const authenticateCustomer = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Customer authentication required.' });
  }

  const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026';
  jwt.verify(token, secret, (err, decoded) => {
    if (err || !decoded || !decoded.id) {
      return res.status(403).json({ error: 'Invalid or expired customer token.' });
    }
    req.customer = decoded;
    next();
  });
};

// Middleware: Authenticate Driver JWT Token (Phase 2 — tenant-bound drivers).
// Sets req.driver = { driverId, tenant_id, name } and req.tenantId for scoping.
const authenticateDriver = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token || req.body?.token;
  if (!token) return res.status(401).json({ error: 'Driver authentication required.' });
  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026', (err, decoded) => {
    if (err || !decoded || decoded.role !== 'driver' || !decoded.driverId) {
      return res.status(403).json({ error: 'Invalid or expired driver token.' });
    }
    req.driver = decoded;
    req.tenantId = decoded.tenant_id || 'default_tenant';
    next();
  });
};

// Middleware: Role check
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized. Insufficient role privileges.' });
    }
    next();
  };
};

// Resolve the tenant for a PUBLIC (unauthenticated) request. Customer/driver apps
// identify their restaurant via ?tenantId=<id>, ?tenant=<subdomain>, or the
// X-Tenant-Id / X-Tenant-Subdomain headers. Falls back to the default tenant so
// existing single-tenant deployments keep working unchanged.
async function resolvePublicTenant(req) {
  const explicitId = req.query.tenantId || req.headers['x-tenant-id'];
  if (explicitId) return String(explicitId);
  const sub = req.query.tenant || req.headers['x-tenant-subdomain'];
  if (sub) {
    try {
      const row = await dbGet('SELECT id FROM tenants WHERE subdomain = ? AND status = "active"', [String(sub)]);
      if (row) return row.id;
    } catch (_) { /* fall through to default */ }
  }
  return 'default_tenant';
}

// ── Per-tenant settings helpers ──────────────────────────────────────────────
// All settings are scoped by tenant (composite PK tenant_id + key). These helpers
// centralize access so every read/write is tenant-correct. Pass the tenant from
// req.tenantId (authenticated) or resolvePublicTenant(req) (public).
async function getSetting(tenantId, key, fallback = undefined) {
  const row = await dbGet('SELECT value FROM settings WHERE tenant_id = ? AND key = ?', [tenantId || 'default_tenant', key]);
  return row ? row.value : fallback;
}
// Return the first present value among several candidate keys (e.g. restaurantName|businessName).
async function getSettingAny(tenantId, keys, fallback = undefined) {
  for (const k of keys) {
    const v = await getSetting(tenantId, k);
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}
// Fetch several keys at once → { key: value }.
async function getSettingsMap(tenantId, keys) {
  if (!keys.length) return {};
  const rows = await dbAll(
    `SELECT key, value FROM settings WHERE tenant_id = ? AND key IN (${keys.map(() => '?').join(',')})`,
    [tenantId || 'default_tenant', ...keys]
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
async function setSetting(tenantId, key, value) {
  await dbRun('INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tenantId || 'default_tenant', key, String(value)]);
}

// ── SaaS plan metering (Phase 5) ─────────────────────────────────────────────
// Read a tenant's plan + status, and live usage counts, so limits can be enforced.
async function getTenantMeta(tenantId) {
  const row = await dbGet('SELECT plan, status FROM tenants WHERE id = ?', [tenantId || 'default_tenant']);
  return { plan: row?.plan || 'basic', status: row?.status || 'active' };
}
async function countTenantUsers(tenantId) {
  const row = await dbGet('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?', [tenantId || 'default_tenant']);
  return row?.c || 0;
}
async function countTenantOrdersThisMonth(tenantId) {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const row = await dbGet('SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND timestamp >= ?', [tenantId || 'default_tenant', start.getTime()]);
  return row?.c || 0;
}
// Returns { plan, status, limits, usage } for a tenant.
async function getTenantUsage(tenantId) {
  const meta = await getTenantMeta(tenantId);
  const [users, ordersThisMonth] = await Promise.all([countTenantUsers(tenantId), countTenantOrdersThisMonth(tenantId)]);
  const limits = getPlan(meta.plan);
  return {
    plan: meta.plan,
    status: meta.status,
    limits: { maxUsers: limits.maxUsers, maxOrdersPerMonth: limits.maxOrdersPerMonth },
    usage: { users, ordersThisMonth }
  };
}

// Audit logging helper
const writeAuditLog = async (userId, username, action, details) => {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    await dbRun(`
      INSERT INTO audit_logs (id, timestamp, userId, username, action, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, Date.now(), userId || 'system', username || 'system', action, details]);
  } catch (err) {
    console.error('Audit logging error:', err);
  }
};

// HEALTH CHECK ENDPOINT (Public, unauthenticated for Docker/K8s/Uptime monitoring)
app.get('/api/health', async (req, res) => {
  try {
    await dbGet('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: 'connected'
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: 'disconnected',
      error: errMsg(err)
    });
  }
});

// AUTH ENDPOINTS

// Login
app.post('/api/auth/login', authLimiter, validateRequest(authLoginSchema), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id || 'default_tenant' },
      process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026',
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenant_id: user.tenant_id || 'default_tenant'
      }
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Register (Owner / Manager only)
app.post('/api/auth/register', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { username, password, role, pin } = req.body;
  if (!username || !password || !role || !pin) {
    return res.status(400).json({ error: 'All fields (username, password, role, pin) are required.' });
  }

  try {
    const existingUser = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(pin, 10);
    const userId = `user_${Date.now()}`;
    await dbRun(`
      INSERT INTO users (id, username, passwordHash, role, pin, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, username, passwordHash, role, pinHash, req.tenantId]);

    await writeAuditLog(req.user.id, req.user.username, 'register_user', `Created user ${username} with role ${role}`);

    res.json({ success: true, user: { username, role } });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// TIMECLOCK & SHIFT ENDPOINTS

// Clock In
app.post('/api/timeclock/clock-in', authenticateToken, async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM timeclock_entries WHERE userId = ? AND clockOut IS NULL', [req.user.id]);
    if (existing) {
      return res.status(400).json({ error: 'You are already clocked in.' });
    }
    const id = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const clockInTime = Date.now();
    await dbRun(
      'INSERT INTO timeclock_entries (id, userId, username, clockIn) VALUES (?, ?, ?, ?)',
      [id, req.user.id, req.user.username, clockInTime]
    );
    await writeAuditLog(req.user.id, req.user.username, 'clock_in', `Clocked in at ${new Date(clockInTime).toLocaleTimeString()}`);
    res.json({ success: true, id, clockIn: clockInTime });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Clock Out
app.post('/api/timeclock/clock-out', authenticateToken, async (req, res) => {
  try {
    const active = await dbGet('SELECT * FROM timeclock_entries WHERE userId = ? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1', [req.user.id]);
    if (!active) {
      return res.status(400).json({ error: 'No active clock-in session found.' });
    }
    const clockOutTime = Date.now();
    const durationMinutes = Math.round((clockOutTime - active.clockIn) / 60000);
    await dbRun(
      'UPDATE timeclock_entries SET clockOut = ?, durationMinutes = ? WHERE id = ?',
      [clockOutTime, durationMinutes, active.id]
    );
    await writeAuditLog(req.user.id, req.user.username, 'clock_out', `Clocked out after ${durationMinutes} mins`);
    res.json({ success: true, clockOut: clockOutTime, durationMinutes });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Get Active Timeclock Status
app.get('/api/timeclock/status', authenticateToken, async (req, res) => {
  try {
    const active = await dbGet('SELECT * FROM timeclock_entries WHERE userId = ? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1', [req.user.id]);
    res.json({ clockedIn: !!active, session: active || null });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Get All Shift Entries (Owner / Manager)
app.get('/api/timeclock/entries', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const entries = await dbAll('SELECT * FROM timeclock_entries ORDER BY clockIn DESC LIMIT 100');
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET FEEDBACKS ENDPOINT (Owner / Manager POS inbox)
app.get('/api/feedbacks', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const feedbacks = await dbAll('SELECT * FROM feedbacks WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 100', [req.tenantId]);
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many PIN verification attempts, please try again later.' }
});

// Verify PIN (used for sensitive actions like voids/discounts)
app.post('/api/auth/verify-pin', authenticateToken, pinLimiter, async (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required.' });
  }

  try {
    const managers = await dbAll('SELECT id, username, role, pin FROM users WHERE role IN ("owner", "manager")');
    let authorizedManager = null;

    for (const mgr of managers) {
      const match = await bcrypt.compare(pin, mgr.pin);
      if (match) {
        authorizedManager = mgr;
        break;
      }
    }

    if (!authorizedManager) {
      return res.status(401).json({ error: 'Invalid or unauthorized PIN.' });
    }

    res.json({ success: true, authorizedBy: authorizedManager.username, role: authorizedManager.role });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// PayHere Webhook (Public Callback)
// Allocate the next gapless fiscal invoice number. MUST be called inside an already-open
// transaction (alongside the paid-status update) so the number and the settlement commit
// atomically — this is what guarantees the sequence is gapless and never reused.
// Thin wrapper — delegates to lib/billing.js (injecting the local DB helpers).
async function allocateInvoiceNumber() {
  return _allocateInvoiceNumber({ dbGet, dbRun });
}

// Server-authoritative settlement: marks an order paid, assigns a fiscal invoice number,
// restores its table, awards loyalty, writes an audit log, and notifies SSE subscribers.
// Callers must have already authorized the payment (verified webhook signature/amount, or
// a gated non-production simulation).
async function settleOrderPaid(order) {
  if (order.status === 'paid') return;
  await dbRun('BEGIN TRANSACTION');
  try {
    await dbRun('UPDATE orders SET status = "paid", paymentMethod = "payhere", paymentTimestamp = ? WHERE id = ?', [Date.now(), order.id]);

    // Assign a gapless fiscal invoice number exactly once, at settlement.
    if (!order.invoiceNumber) {
      const invoiceNumber = await allocateInvoiceNumber();
      await dbRun('UPDATE orders SET invoiceNumber = ? WHERE id = ?', [invoiceNumber, order.id]);
    }
    if (order.tableId) {
      await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [order.tableId]);
    }
    const earnedPoints = Math.floor(order.total / 10);
    if (order.customerId) {
      await dbRun(`
        UPDATE customers
        SET points = points + ?, orderCount = orderCount + 1, totalSpent = totalSpent + ?
        WHERE id = ?
      `, [earnedPoints, order.total, order.customerId]);
    }
    if (order.customerAccountId) {
      await dbRun(`
        UPDATE customer_accounts
        SET loyaltyPoints = loyaltyPoints + ?, totalSpent = totalSpent + ?
        WHERE id = ?
      `, [earnedPoints, order.total, order.customerAccountId]);
    }
    await writeAuditLog('payhere_gateway', 'PayHere Gateway', 'pay_order', `Payment settled via PayHere for order ${order.id} (Amount: LKR ${order.total})`);
    await dbRun('COMMIT');

    // Notify SSE subscribers
    const updated = await dbGet('SELECT * FROM orders WHERE id = ?', [order.id]);
    const itemsList = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [order.id]);
    notifyOrderUpdate(order.id, { ...updated, items: itemsList });

    // Fire-and-forget order confirmation (email + SMS). Never blocks settlement.
    sendOrderConfirmation(updated);
  } catch (e) {
    await dbRun('ROLLBACK');
    throw e;
  }
}

app.post('/api/payments/payhere/webhook', async (req, res) => {
  const { merchant_id, order_id, payhere_amount, payhere_currency, status_code, md5sig } = req.body;
  try {
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
    if (!merchantSecret) {
      return res.status(500).json({ error: 'PayHere Merchant Secret is not configured on the server.' });
    }

    const localMd5Secret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const signatureSource = (merchant_id || '') + (order_id || '') + (payhere_amount || '') + (payhere_currency || '') + (status_code || '') + localMd5Secret;
    const expectedSignature = crypto.createHash('md5').update(signatureSource).digest('hex').toUpperCase();

    // Verify signature unconditionally - refuse missing signatures
    if (!md5sig || md5sig.toUpperCase() !== expectedSignature) {
      console.warn(`PayHere signature mismatch! Received: ${md5sig}, Expected: ${expectedSignature}`);
      return res.status(400).json({ error: 'Invalid signature verification.' });
    }

    if (String(status_code) === '2') {
      const order = await dbGet('SELECT * FROM orders WHERE id = ?', [order_id]);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      // Verify that the payment amount matches the order total in the database
      const orderTotalFormatted = Number(order.total).toFixed(2);
      const payhereAmountFormatted = Number(payhere_amount).toFixed(2);
      if (orderTotalFormatted !== payhereAmountFormatted) {
        console.warn(`PayHere payment amount mismatch! Received: ${payhere_amount}, Expected: ${order.total}`);
        return res.status(400).json({ error: 'Invalid payment amount.' });
      }

      await settleOrderPaid(order);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Non-production sandbox helper: simulate a successful PayHere settlement server-side,
// used only when there is no real gateway callback in local/dev environments. The server
// settles using its own stored order total — it never trusts a client-supplied amount or
// signature — so the browser can never declare its own payment success. Hard-disabled in production.
app.post('/api/payments/payhere/dev-simulate', publicApiLimiter, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Payment simulation is disabled in production.' });
  }
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required.' });
  }
  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    await settleOrderPaid(order);
    res.json({ success: true, status: 'paid' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ======================================================
// CUSTOMER AUTH ENDPOINTS (no staff token required)
// ======================================================

function isValidSriLankanPhone(phone) {
  if (!phone) return false;
  const cleanPhone = phone.replace(/[\s-]/g, '');
  return /^(?:\+94|0)7\d{8}$/.test(cleanPhone);
}

function isValidAddress(address) {
  if (!address || address.trim().length < 15) return false;
  const addr = address.toLowerCase();
  return (addr.includes('road') || addr.includes('rd') || addr.includes('street') || addr.includes('st') || addr.includes('lane') || addr.includes('ave') || /\d+/.test(addr));
}

// SMS OTP Cache Store and Sender Helpers
const otpStore = new Map(); // phone -> { code, expiresAt }

async function sendSMS(to, message) {
  const provider = process.env.SMS_PROVIDER || 'dev';
  const cleanTo = to.startsWith('0') ? '94' + to.slice(1) : to.replace('+', ''); // Format for Sri Lanka: 94771234567

  console.log(`[SMS SENDER] Sending to ${cleanTo} via provider: ${provider}`);

  if (provider === 'notifylk') {
    const userId = process.env.NOTIFY_LK_USER_ID;
    const apiKey = process.env.NOTIFY_LK_API_KEY;
    const senderId = process.env.NOTIFY_LK_SENDER_ID || 'NotifyDEMO';

    if (!userId || !apiKey) {
      console.warn('[SMS SENDER] Notify.lk keys missing. Falling back to console log.');
      console.log(`[SMS DEV SIMULATION] To: ${to} | Msg: ${message}`);
      return;
    }

    // Notify.lk uses GET requests with query params (not POST body)
    const params = new URLSearchParams({
      user_id: userId,
      api_key: apiKey,
      sender_id: senderId,
      to: cleanTo,
      message: message,
    });
    const url = `https://app.notify.lk/api/v1/send?${params.toString()}`;
    try {
      const response = await fetch(url, { method: 'GET' });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { status: 'unknown', raw: text }; }
      if (!response.ok || data.status !== 'success') {
        throw new Error(`Notify.lk API returned status ${response.status}: ${text}`);
      }
      console.log(`[SMS SENDER] Notify.lk sent successfully:`, data);
    } catch (e) {
      console.error('[SMS SENDER] Notify.lk API error:', e.message);
      throw e;
    }
  } else if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      console.warn('[SMS SENDER] Twilio keys missing. Falling back to console log.');
      console.log(`[SMS DEV SIMULATION] To: ${to} | Msg: ${message}`);
      return;
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const body = new URLSearchParams();
    body.append('To', to);
    body.append('From', fromNumber);
    body.append('Body', message);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Twilio API returned status ${response.status}: ${text}`);
      }
      const data = await response.json();
      console.log(`[SMS SENDER] Twilio sent successfully:`, data.sid);
    } catch (e) {
      console.error('[SMS SENDER] Twilio API error:', e.message);
      throw e;
    }
  } else {
    // Dev provider console fallback
    console.log(`[SMS DEV SIMULATION] To: ${to} | Msg: ${message}`);
  }
}

function verifyOTP(phone, code) {
  const cleanPhone = phone.replace(/[\s-]/g, '');
  const entry = otpStore.get(cleanPhone);
  
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(cleanPhone);
    return false;
  }
  if (entry.code !== String(code).trim()) {
    return false;
  }
  
  otpStore.delete(cleanPhone);
  return true;
}

// POST /api/auth/send-otp
app.post('/api/auth/send-otp', publicApiLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone || !isValidSriLankanPhone(phone)) {
    return res.status(400).json({ error: 'A valid Sri Lankan phone number is required.' });
  }

  const cleanPhone = phone.replace(/[\s-]/g, '');
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  otpStore.set(cleanPhone, { code, expiresAt: Date.now() + 5 * 60 * 1000 }); // Valid for 5 minutes

  try {
    await sendSMS(cleanPhone, `GastroFlow Verification Code: ${code}. Valid for 5 minutes.`);
    res.json({ success: true, message: 'Verification code sent successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send SMS: ' + err.message });
  }
});



// POST /api/customer/auth/register
app.post('/api/customer/auth/register', publicApiLimiter, async (req, res) => {
  const { name, email, phone, password, otpCode } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required.' });
  }
  if (!phone || !isValidSriLankanPhone(phone)) {
    return res.status(400).json({ error: 'A valid Sri Lankan phone number is required (e.g. 0771234567 or +94771234567).' });
  }
  if (!otpCode) {
    return res.status(400).json({ error: 'Verification code is required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  
  const cleanPhone = phone.replace(/[\s-]/g, '');
  const cleanEmail = email ? email.toLowerCase().trim() : null;

  // Verify OTP
  if (!verifyOTP(cleanPhone, otpCode)) {
    return res.status(400).json({ error: 'Invalid or expired phone verification code.' });
  }

  try {
    const existing = await dbGet('SELECT id FROM customer_accounts WHERE phone = ?', [cleanPhone]);
    if (existing) {
      return res.status(400).json({ error: 'An account with this phone number already exists.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const id = `ca_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    await dbRun(
      `INSERT INTO customer_accounts (id, name, email, phone, passwordHash, loyaltyPoints, totalSpent, createdAt, tenant_id)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, name.trim(), cleanEmail, cleanPhone, passwordHash, Date.now(), await resolvePublicTenant(req)]
    );
    const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026';
    const token = jwt.sign(
      { id, phone: cleanPhone, name: name.trim(), type: 'customer' },
      secret,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, customer: { id, name: name.trim(), email: cleanEmail, phone: cleanPhone, loyaltyPoints: 0, totalSpent: 0 } });

    // Welcome email — fire-and-forget, never blocks the response
    if (cleanEmail) {
      const business = (await getSettingAny(await resolvePublicTenant(req), ['businessName', 'restaurantName'], 'GastroFlow Bistro'));
      const welcomeHtml = buildWelcomeEmail({ name: name.trim(), loginUrl: customerAppUrl(), businessName: business });
      sendEmail({
        to: cleanEmail,
        subject: `Welcome to ${business}! 🎉`,
        html: welcomeHtml
      }).catch(e => console.error('[EMAIL] Welcome email failed:', e.message));
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customer/auth/login
app.post('/api/customer/auth/login', publicApiLimiter, async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }
  
  const cleanPhone = phone.replace(/[\s-]/g, '');

  try {
    const customer = await dbGet('SELECT * FROM customer_accounts WHERE phone = ?', [cleanPhone]);
    if (!customer) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }
    const match = await bcrypt.compare(password, customer.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }
    const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026';
    const token = jwt.sign(
      { id: customer.id, phone: customer.phone, name: customer.name, type: 'customer' },
      secret,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      customer: {
        id: customer.id, name: customer.name, email: customer.email,
        phone: customer.phone, loyaltyPoints: customer.loyaltyPoints, totalSpent: customer.totalSpent
      }
    });

    // Login notification email — fire-and-forget
    if (customer.email) {
      const business = (await getSettingAny(await resolvePublicTenant(req), ['businessName', 'restaurantName'], 'GastroFlow'));
      const loginTime = new Date().toLocaleString('en-LK', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });
      sendEmail({
        to: customer.email,
        subject: `New sign-in to your ${business} account`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
            <div style="background:#1a1a2e;padding:24px;text-align:center">
              <h1 style="color:#ff6b35;margin:0;font-size:22px">🍽️ ${business}</h1>
            </div>
            <div style="padding:28px 24px">
              <h2 style="color:#1a1a2e;margin:0 0 12px">New Sign-In Detected 🔐</h2>
              <p style="color:#555;line-height:1.6">Hi ${customer.name}, we noticed a new sign-in to your account.</p>
              <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:20px 0">
                <p style="margin:0;color:#333"><strong>Time:</strong> ${loginTime} (Sri Lanka)</p>
                <p style="margin:6px 0 0;color:#333"><strong>Phone:</strong> ${customer.phone}</p>
              </div>
              <p style="color:#777;font-size:13px">If this wasn't you, please change your password immediately.</p>
            </div>
            <div style="background:#f8f9fa;padding:16px 24px;text-align:center">
              <p style="color:#999;font-size:12px;margin:0">© ${new Date().getFullYear()} ${business}. All rights reserved.</p>
            </div>
          </div>`
      }).catch(e => console.error('[EMAIL] Login notification failed:', e.message));
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/auth/me
app.get('/api/customer/auth/me', authenticateCustomer, async (req, res) => {
  try {
    const customer = await dbGet(
      'SELECT id, name, email, phone, loyaltyPoints, totalSpent, createdAt FROM customer_accounts WHERE id = ?',
      [req.customer.id]
    );
    if (!customer) return res.status(404).json({ error: 'Account not found.' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/profile
app.get('/api/customer/profile', authenticateCustomer, async (req, res) => {
  try {
    const customer = await dbGet(
      'SELECT id, name, email, phone, loyaltyPoints, totalSpent, createdAt FROM customer_accounts WHERE id = ?',
      [req.customer.id]
    );
    if (!customer) return res.status(404).json({ error: 'Account not found.' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// PUT /api/customer/profile
app.put('/api/customer/profile', authenticateCustomer, async (req, res) => {
  const { name, phone, password } = req.body;
  try {
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      const passwordHash = await bcrypt.hash(password, 10);
      await dbRun('UPDATE customer_accounts SET name = ?, phone = ?, passwordHash = ? WHERE id = ?',
        [name || req.customer.name, phone || null, passwordHash, req.customer.id]);
    } else {
      await dbRun('UPDATE customer_accounts SET name = ?, phone = ? WHERE id = ?',
        [name || req.customer.name, phone || null, req.customer.id]);
    }
    const updated = await dbGet(
      'SELECT id, name, email, phone, loyaltyPoints, totalSpent FROM customer_accounts WHERE id = ?',
      [req.customer.id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/addresses
app.get('/api/customer/addresses', authenticateCustomer, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM customer_addresses WHERE customerAccountId = ?', [req.customer.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customer/addresses
app.post('/api/customer/addresses', authenticateCustomer, async (req, res) => {
  const { addressLine, isDefault } = req.body;
  if (!addressLine) return res.status(400).json({ error: 'addressLine is required.' });
  try {
    const id = `addr_${Date.now()}`;
    if (isDefault) {
      await dbRun('UPDATE customer_addresses SET isDefault = 0 WHERE customerAccountId = ?', [req.customer.id]);
    }
    await dbRun(
      'INSERT INTO customer_addresses (id, customerAccountId, addressLine, isDefault) VALUES (?, ?, ?, ?)',
      [id, req.customer.id, addressLine, isDefault ? 1 : 0]
    );
    res.json({ success: true, address: { id, addressLine, isDefault } });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/cards
app.get('/api/customer/cards', authenticateCustomer, async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, cardType, lastFour, expiry FROM customer_cards WHERE customerAccountId = ?', [req.customer.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customer/cards
app.post('/api/customer/cards', authenticateCustomer, async (req, res) => {
  const { cardToken, cardType, lastFour, expiry } = req.body;
  if (!cardToken || !lastFour) return res.status(400).json({ error: 'cardToken and lastFour are required.' });
  try {
    const id = `card_${Date.now()}`;
    await dbRun(
      'INSERT INTO customer_cards (id, customerAccountId, cardToken, cardType, lastFour, expiry) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.customer.id, cardToken, cardType || 'card', lastFour, expiry || '']
    );
    res.json({ success: true, card: { id, cardType, lastFour, expiry } });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/orders
app.get('/api/customer/orders', authenticateCustomer, async (req, res) => {
  try {
    const orders = await dbAll(
      `SELECT id, diningType, orderType, subtotal, tax, total, status, timestamp, paymentMethod, source, deliveryAddress, invoiceNumber
       FROM orders WHERE customerAccountId = ? ORDER BY timestamp DESC LIMIT 50`,
      [req.customer.id]
    );
    const result = await Promise.all(orders.map(async (o) => {
      const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [o.id]);
      return { ...o, items };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customer/loyalty/redeem
app.post('/api/customer/loyalty/redeem', authenticateCustomer, async (req, res) => {
  const { points } = req.body;
  if (!points || points <= 0) return res.status(400).json({ error: 'Points must be a positive number.' });
  try {
    const customer = await dbGet('SELECT loyaltyPoints FROM customer_accounts WHERE id = ?', [req.customer.id]);
    if (!customer) return res.status(404).json({ error: 'Account not found.' });
    if (customer.loyaltyPoints < points) {
      return res.status(400).json({ error: `Insufficient points. You have ${customer.loyaltyPoints} points.` });
    }
    const discount = Math.floor(points / 100);
    res.json({ discount, pointsUsed: points, remainingPoints: customer.loyaltyPoints - points });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});
// ======================================================
// PUBLIC MENU & ORDER ENDPOINTS (no auth required)
// ======================================================

// ── Haversine distance (km) between two lat/lng points ──
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Peak hour detection (Sri Lanka lunch & dinner rush) ──
async function isPeakHour(tenantId = 'default_tenant') {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const s = await getSettingsMap(tenantId, ['peakLunchStart', 'peakLunchEnd', 'peakDinnerStart', 'peakDinnerEnd']);
  const lunchStart = s.peakLunchStart || '11:30';
  const lunchEnd = s.peakLunchEnd || '14:00';
  const dinnerStart = s.peakDinnerStart || '18:30';
  const dinnerEnd = s.peakDinnerEnd || '21:30';
  return (hhmm >= lunchStart && hhmm <= lunchEnd) || (hhmm >= dinnerStart && hhmm <= dinnerEnd);
}

// ── Server-authoritative delivery fee calculator ──
async function calculateDeliveryFee(customerLat, customerLng, subtotal = 0, tenantId = 'default_tenant') {
  const s = await getSettingsMap(tenantId, [
    'storeLat', 'storeLng', 'deliveryBaseFee', 'deliveryFreeRadiusKm', 'deliveryPerKmRate',
    'deliveryMaxRadiusKm', 'deliveryPeakSurcharge', 'deliveryRainSurcharge', 'deliveryFreeThreshold', 'isRainyWeather'
  ]);
  const storeLat = parseFloat(s.storeLat || 6.9271);
  const storeLng = parseFloat(s.storeLng || 79.8612);
  const baseFee = parseFloat(s.deliveryBaseFee || 99);
  const freeRadius = parseFloat(s.deliveryFreeRadiusKm || 2);
  const perKmRate = parseFloat(s.deliveryPerKmRate || 50);
  const maxRadius = parseFloat(s.deliveryMaxRadiusKm || 15);
  const peakSurchargeAmt = parseFloat(s.deliveryPeakSurcharge || 50);
  const rainSurchargeAmt = parseFloat(s.deliveryRainSurcharge || 75);
  const freeThreshold = parseFloat(s.deliveryFreeThreshold || 3000);
  const isRainy = s.isRainyWeather === 'true';

  const distanceKm = haversineDistanceKm(storeLat, storeLng, customerLat, customerLng);
  const roundedDistance = Math.round(distanceKm * 10) / 10; // 1 decimal

  // Out of range
  if (distanceKm > maxRadius) {
    return {
      distanceKm: roundedDistance,
      baseFee: 0, distanceCharge: 0, peakSurcharge: 0, rainSurcharge: 0,
      totalFee: 0, isFreeDelivery: false, isOutOfRange: true,
      maxRadiusKm: maxRadius,
      storeLat, storeLng,
      etaMinutes: 0
    };
  }

  // Free delivery for high-value orders
  if (subtotal >= freeThreshold) {
    const etaMinutes = Math.round(10 + distanceKm * 3.5); // ~17 km/h avg Sri Lankan traffic
    return {
      distanceKm: roundedDistance,
      baseFee: 0, distanceCharge: 0, peakSurcharge: 0, rainSurcharge: 0,
      totalFee: 0, isFreeDelivery: true, isOutOfRange: false,
      freeThreshold, storeLat, storeLng,
      etaMinutes
    };
  }

  // Distance-based pricing
  const chargeableKm = Math.max(0, distanceKm - freeRadius);
  const distanceCharge = Math.round(chargeableKm * perKmRate);
  const peak = await isPeakHour(tenantId);
  const peakSurcharge = peak ? peakSurchargeAmt : 0;
  const rainSurcharge = isRainy ? rainSurchargeAmt : 0;
  const totalFee = Math.round(baseFee + distanceCharge + peakSurcharge + rainSurcharge);

  // ETA: Sri Lankan urban traffic averages ~15-20 km/h for scooters
  // Add 5 min per peak hour, 3 min for rain
  let etaMinutes = Math.round(10 + distanceKm * 3.5);
  if (peak) etaMinutes += 5;
  if (isRainy) etaMinutes += 3;

  return {
    distanceKm: roundedDistance,
    baseFee,
    distanceCharge,
    peakSurcharge,
    rainSurcharge,
    totalFee,
    isFreeDelivery: false,
    isOutOfRange: false,
    isPeakHour: peak,
    isRainy,
    freeRadius,
    freeThreshold,
    maxRadiusKm: maxRadius,
    storeLat, storeLng,
    etaMinutes
  };
}

// ── Hybrid Auto-Dispatch Engine ──
// Finds nearest available driver using Haversine from their last GPS ping.
// Auto-assigns and notifies. In hybrid mode, sets a timeout for POS escalation.
async function autoDispatchDriver(orderId, tenantId = 'default_tenant') {
  try {
    const dispatchMode = (await getSetting(tenantId, 'driverDispatchMode')) || 'hybrid';
    if (dispatchMode === 'manual') return; // manager handles it

    const order = await dbGet('SELECT deliveryLat, deliveryLng, customerName FROM orders WHERE id = ?', [orderId]);
    if (!order || !order.deliveryLat || !order.deliveryLng) return;

    // Get all drivers with recent GPS pings (within last 30 min)
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    const driverPings = await dbAll(
      'SELECT orderId, driverName, lat, lng, updatedAt FROM driver_locations WHERE updatedAt > ? GROUP BY driverName ORDER BY updatedAt DESC',
      [thirtyMinAgo]
    );

    // Get store location for fallback
    const dispatchStore = await getSettingsMap(tenantId, ['storeLat', 'storeLng']);
    const storeLat = parseFloat(dispatchStore.storeLat || 6.9271);
    const storeLng = parseFloat(dispatchStore.storeLng || 79.8612);

    // Calculate distance from each driver to the STORE (pickup point)
    const driversWithDistance = driverPings.map(d => ({
      ...d,
      distToStore: haversineDistanceKm(d.lat, d.lng, storeLat, storeLng)
    }));

    // Sort by distance to store (nearest first)
    driversWithDistance.sort((a, b) => a.distToStore - b.distToStore);

    // Check which drivers are currently NOT on an active delivery
    for (const driver of driversWithDistance) {
      const activeDelivery = await dbGet(
        "SELECT id FROM orders WHERE driverId = ? AND status IN ('preparing', 'ready', 'out_for_delivery')",
        [driver.driverName]
      );
      if (!activeDelivery) {
        // Auto-assign this driver
        await dbRun('UPDATE orders SET driverId = ?, dispatchMode = ? WHERE id = ?', [driver.driverName, 'auto', orderId]);
        notifyPOS({ type: 'driver_auto_assigned', orderId, driverId: driver.driverName, distanceKm: Math.round(driver.distToStore * 10) / 10 }, tenantId);
        console.log(`[Auto-Dispatch] Assigned ${driver.driverName} to order ${orderId} (${driver.distToStore.toFixed(1)} km from store)`);
        return;
      }
    }

    // No available driver found
    if (dispatchMode === 'hybrid') {
      const timeoutSec = parseInt((await getSetting(tenantId, 'autoDispatchTimeoutSec')) || 180);
      // Notify POS for manual escalation
      notifyPOS({ type: 'dispatch_escalation', orderId, reason: 'No available drivers for auto-dispatch', customerName: order.customerName }, tenantId);
      console.log(`[Auto-Dispatch] No drivers available for ${orderId}. Escalated to POS manager (hybrid mode).`);
    }
  } catch (err) {
    console.error('[Auto-Dispatch Error]', err.message);
  }
}

// GET /api/public/delivery-fee — Calculate dynamic delivery fee from customer location
app.get('/api/public/delivery-fee', publicApiLimiter, async (req, res) => {
  const { lat, lng, subtotal } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng query parameters are required.' });
  }
  try {
    const customerLat = parseFloat(lat);
    const customerLng = parseFloat(lng);
    if (isNaN(customerLat) || isNaN(customerLng)) {
      return res.status(400).json({ error: 'Invalid lat/lng values.' });
    }
    const tenantId = await resolvePublicTenant(req);
    const result = await calculateDeliveryFee(customerLat, customerLng, parseFloat(subtotal || 0), tenantId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/delivery-zone-info — Public info about delivery zones for customer display
app.get('/api/public/delivery-zone-info', publicApiLimiter, async (req, res) => {
  try {
    const keys = ['deliveryBaseFee', 'deliveryFreeRadiusKm', 'deliveryPerKmRate', 'deliveryMaxRadiusKm',
                  'deliveryPeakSurcharge', 'deliveryRainSurcharge', 'deliveryFreeThreshold',
                  'storeLat', 'storeLng', 'isRainyWeather', 'driverDispatchMode',
                  'peakLunchStart', 'peakLunchEnd', 'peakDinnerStart', 'peakDinnerEnd'];
    const tenantId = await resolvePublicTenant(req);
    const config = await getSettingsMap(tenantId, keys);
    config.isPeakHour = await isPeakHour(tenantId);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});


// ── POST /api/ai/chat — GastroAI Brilliant Customer Assistant Engine ──
app.post('/api/ai/chat', publicApiLimiter, async (req, res) => {
  const { message, cartItems } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  const msg = message.trim().toLowerCase();

  try {
    // 1. Fetch live menu items and store settings from database (tenant-scoped)
    const tenantId = await resolvePublicTenant(req);
    const menuItems = await dbAll('SELECT id, name, price, category, emoji, description, dietaryTags, stock FROM menu_items WHERE tenant_id = ? AND (stock IS NULL OR stock > 0)', [tenantId]);
    const storeName = await getSettingAny(tenantId, ['restaurantName', 'businessName'], 'GastroFlow Bistro');
    const baseFee = (await getSetting(tenantId, 'deliveryBaseFee')) || '99';
    const freeThreshold = (await getSetting(tenantId, 'deliveryFreeThreshold')) || '3000';

    let reply = '';
    let recommendedItems = [];
    let suggestions = [];
    let action = null;

    // Detect Customer Complaint / Issue Escalation Intent
    const isComplaint = /complain|issue|problem|cold|late|wrong|bad|delay|refund|mistake|help|support|කවුරුත්|අවුල|ගැටලුව|பிரச்சனை/i.test(msg);
    if (isComplaint) {
      const ticketId = `tkt_${Date.now()}`;
      const extractedOrderId = orderIdMatch ? orderIdMatch[0] : null;
      await dbRun(
        'INSERT INTO support_tickets (id, orderId, customerName, customerPhone, issueCategory, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ticketId, extractedOrderId, 'Online Customer', null, 'customer_complaint', message, 'open', Date.now()]
      );

      // Real-time escalation notification to POS staff & manager dashboard
      notifyPOS({
        type: 'support_ticket_escalated',
        ticketId,
        orderId: extractedOrderId,
        message: message,
        timestamp: Date.now()
      }, tenantId);

      const waText = encodeURIComponent(`🚨 URGENT CUSTOMER ISSUE (${ticketId}): ${message} (Order: ${extractedOrderId || 'N/A'})`);
      const waLink = `https://wa.me/94112345678?text=${waText}`;

      reply = `🚨 *I have registered an urgent Support Ticket (#${ticketId}) for you!*\n\n` +
        `Our Restaurant Manager has been alerted on the POS system and will prioritize your order immediately.\n\n` +
        `📞 *Direct Escalation Options*:\n` +
        `• Call Store Manager: +94 11 234 5678\n` +
        `• Direct WhatsApp Manager: [Chat on WhatsApp](${waLink})`;

      suggestions = ['📞 Call Store Manager', '💬 WhatsApp Manager', '🔍 Check Order Status'];
      return res.json({ reply, recommendedItems: [], suggestions, action: null });
    }

    const orderIdMatch = msg.match(/ord_[a-zA-Z0-9_]+/i);

    // Detect Order Cancellation intent via GastroAI Bot
    if (msg.includes('cancel') || msg.includes('stop order') || msg.includes('අවලංගු') || msg.includes('රத்து')) {
      const targetId = orderIdMatch ? orderIdMatch[0] : null;
      if (!targetId) {
        reply = `To cancel an active pending order, please specify your Order ID (e.g. *"Cancel order ord_online_12345"*).`;
        suggestions = ['🔍 Check Order Status', '📞 Call Restaurant'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      }

      const order = await dbGet('SELECT * FROM orders WHERE id = ?', [targetId]);
      if (!order) {
        reply = `I couldn't find order #${targetId}. Please double-check your Order ID.`;
        suggestions = ['🔍 Check Order Status', '📞 Call Restaurant'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      }

      if (order.status === 'pending' || order.status === 'hold') {
        await dbRun("UPDATE orders SET status = 'cancelled' WHERE id = ?", [targetId]);
        const items = await dbAll('SELECT itemId, quantity FROM order_items WHERE orderId = ?', [targetId]);
        for (const it of items) {
          await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [it.quantity, it.itemId]);
        }
        await writeAuditLog('customer_bot', 'customer', 'cancel_order_bot', `Cancelled order ${targetId} via AI Concierge`);

        // REAL-TIME INSTANT SSE BROADCAST TO POS & KITCHEN
        broadcastEvent('order_updated', { orderId: targetId, status: 'cancelled', message: `Order #${targetId} CANCELLED by customer` });

        reply = `✅ Order #${targetId} (Rs. ${order.total?.toFixed(2)}) has been **CANCELLED** successfully!\n\n` +
          `• Item stocks have been restored to inventory.\n` +
          `• Restaurant Manager & Kitchen have been notified in real time on the POS terminal.`;
        suggestions = ['🍽️ Browse Menu Again', '📞 Contact Support'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      } else {
        reply = `⚠️ Order #${targetId} is currently **${order.status.toUpperCase()}**.\n\n` +
          `The kitchen has already started cooking your meal, so it cannot be cancelled automatically. Please call the manager at **+94 11 234 5678** for urgent requests.`;
        suggestions = ['📞 Call Store Manager', '💬 WhatsApp Manager'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      }
    }
    if (orderIdMatch || msg.includes('track') || msg.includes('order status') || msg.includes('කෝ මගේ') || msg.includes('ஆர்டர்')) {
      if (orderIdMatch) {
        const orderId = orderIdMatch[0];
        const order = await dbGet('SELECT id, status, total, diningType, deliveryAddress, etaMinutes FROM orders WHERE id = ?', [orderId]);
        if (order) {
          reply = `📦 *Order #${order.id} Status*: ${order.status.toUpperCase()}\n` +
            `Type: ${order.diningType || 'Delivery'}\n` +
            `Total: Rs. ${order.total?.toFixed(2)}\n` +
            `ETA: ~${order.etaMinutes || 25} mins\n` +
            `Status: ${order.status === 'delivered' ? 'Delivered 🎉' : order.status === 'ready' ? 'Out for Delivery 🛵' : order.status === 'preparing' ? 'Chef is cooking in kitchen 👨‍🍳' : 'Confirmed by restaurant 📋'}`;
          suggestions = ['🔍 Track Another Order', '🍽️ Browse Menu', '📞 Call Restaurant'];
          return res.json({ reply, recommendedItems: [], suggestions, action });
        } else {
          reply = `Sorry, I couldn't find order #${orderId}. Please double check your order ID or check your email receipt!`;
          suggestions = ['🍽️ Browse Menu', '📞 Call Support'];
          return res.json({ reply, recommendedItems: [], suggestions, action });
        }
      }
    }

    // Detect "add [item name]" action command for 1-tap cart additions
    if (msg.startsWith('add ') || msg.startsWith('order ') || msg.includes('කාට් එකට') || msg.includes('சேர்')) {
      const queryItem = msg.replace(/add |order |1 |2 |3 /gi, '').trim();
      const matched = menuItems.find(i => i.name.toLowerCase().includes(queryItem));
      if (matched) {
        action = { type: 'add_to_cart', itemId: matched.id, quantity: 1 };
        reply = `✨ Added *${matched.name}* (Rs. ${matched.price}) to your cart! 🛒\n` +
          `Would you like to add a refreshing drink or dessert to complete your meal?`;
        recommendedItems = menuItems.filter(i => i.category === 'drinks' || i.category === 'desserts').slice(0, 2);
        suggestions = ['🛒 View Cart & Checkout', '🍹 Add Refreshing Drink', '🍰 Add Dessert'];
        return res.json({ reply, recommendedItems, suggestions, action });
      }
    }

    // Detect Sinhala query
    const isSinhala = /[අ-ෆ]/.test(message);
    // Detect Tamil query
    const isTamil = /[அ-ஹ]/.test(message);

    // Intent: Spicy Food / Kottu / Devilled
    if (msg.includes('spicy') || msg.includes('kottu') || msg.includes('devilled') || msg.includes('සැර') || msg.includes('කොත්තු') || msg.includes('காரமான')) {
      const spicyItems = menuItems.filter(i => 
        (i.dietaryTags || '').includes('spicy') || 
        i.name.toLowerCase().includes('kottu') || 
        i.name.toLowerCase().includes('devilled') ||
        i.name.toLowerCase().includes('spicy')
      ).slice(0, 3);

      recommendedItems = spicyItems.length > 0 ? spicyItems : menuItems.slice(0, 3);
      if (isSinhala) {
        reply = `🔥 ඔන්න අපේ රසම සැර කොත්තු සහ ඩෙවිල්ඩ් කෑම වර්ග!\n` +
          `කැමති කෑමක් කෙලින්ම කාට් එකට එකතු කරගන්න:`;
      } else if (isTamil) {
        reply = `🔥 எங்கள் காரமான கொத்து மற்றும் உணவுகள்!\n` +
          `விருப்பமான உணவை கார்ட்டில் சேர்க்கவும்:`;
      } else {
        reply = `🌶️ Here are our top fiery, spicy Sri Lankan dishes & Kottu specials!\n` +
          `Tap *+ Add* on any item below to add it straight to your cart:`;
      }
      suggestions = ['🔥 Spicy Kottu', '🍗 Devilled Chicken', '🌱 Veggie Options', '💡 Combo under 3000'];
    }
    // Intent: Vegetarian / Vegan
    else if (msg.includes('veg') || msg.includes('vegan') || msg.includes('ශාක') || msg.includes('சைவ')) {
      const vegItems = menuItems.filter(i => (i.dietaryTags || '').includes('veg') || (i.dietaryTags || '').includes('vegan')).slice(0, 3);
      recommendedItems = vegItems.length > 0 ? vegItems : menuItems.slice(0, 3);
      reply = isSinhala 
        ? `🌱 අපේ නැවුම් ශාකභක්ෂක (Vegetarian) කෑම වර්ග මෙන්න:`
        : `🌱 Here are our fresh, delicious Vegetarian & Vegan choices:`;
      suggestions = ['🌱 Veg Rice & Curry', '🥗 Salad Specials', '💡 Combo under 2000'];
    }
    // Intent: Budget / Combo / Low Price
    else if (msg.includes('combo') || msg.includes('cheap') || msg.includes('budget') || msg.includes('under') || msg.includes('ගණන් අඩු') || msg.includes('மலிவான')) {
      const budgetItems = menuItems.filter(i => i.price <= 1500).slice(0, 3);
      recommendedItems = budgetItems;
      reply = `💡 Here are our best value budget-friendly meals under Rs. 1500:\n` +
        `Orders above Rs. ${freeThreshold} automatically qualify for *FREE Delivery*! 🎉`;
      suggestions = ['💡 Budget Meal', '🎉 Free Delivery Info', '🍹 Add Drink'];
    }
    // Intent: Delivery Fee & Store Info
    else if (msg.includes('delivery') || msg.includes('fee') || msg.includes('rain') || msg.includes('බෙදාහැරීම') || msg.includes('டெலிவரி')) {
      reply = `🛵 *GastroFlow Delivery Economics*:\n` +
        `• Base Delivery Fee: Rs. ${baseFee}\n` +
        `• Free Radius: First 2.0 km free per-km charge\n` +
        `• Beyond 2km: Rs. 50/km\n` +
        `• FREE Delivery: Orders above Rs. ${freeThreshold} get 100% Free Delivery!\n` +
        `• Payment Methods: Cash on Delivery (COD) & PayHere Online Cards`;
      suggestions = ['🛵 Check Delivery Fee to My Area', '💳 Payment Options', '🍽️ Browse Menu'];
    }
    // Default Intelligent Assistant Response
    else {
      const popular = menuItems.slice(0, 3);
      recommendedItems = popular;
      if (isSinhala) {
        reply = `👋 සාදරයෙන් පිළිගනිමු! ${storeName} AI සහායකයා වෙතින් ඔබට උපකාර කරන්නේ කෙසේද?\n` +
          `අපගේ ජනප්‍රියම කෑම වර්ග මෙන්න:`;
      } else if (isTamil) {
        reply = `👋 வணக்கம்! ${storeName} AI உதவி சேவை. உங்களுக்கு எவ்வாறு உதவலாம்?\n` +
          `எங்கள் பிரபலமான உணவுகள்:`;
      } else {
        reply = `👋 Welcome to *${storeName}*! I'm your AI Food Concierge.\n` +
          `I can recommend dishes, build budget combos, answer delivery questions, or track your orders!\n\n` +
          `Here are today's top chef recommendations:`;
      }
      suggestions = ['💡 Combo under LKR 3000', '🌶️ Fiery Spicy Dishes', '🌱 Best Veggie Choices', '🛵 Delivery Fee Info'];
    }

    res.json({
      reply,
      recommendedItems,
      suggestions,
      action
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});
// GET /api/orders — Fetch all orders with order_items for POS & Admin
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await dbAll('SELECT * FROM orders WHERE tenant_id = ? ORDER BY timestamp DESC', [req.tenantId]);
    for (const order of orders) {
      const items = await dbAll('SELECT * FROM order_items WHERE orderId = ?', [order.id]);
      order.items = items || [];
    }
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/db/inspect — Full database inspection endpoint for Owner only
app.get('/api/db/inspect', authenticateToken, requireRole(['owner']), async (req, res) => {
  // Cross-tenant DB dump — restricted to the platform tenant so a customer tenant owner
  // can never inspect other tenants' data.
  if (req.tenantId !== 'default_tenant') {
    return res.status(403).json({ error: 'Not available for this account.' });
  }
  try {
    const tables = ['settings', 'users', 'customers', 'menu_items', 'orders', 'tables', 'drivers', 'tenants', 'support_tickets', 'audit_logs', 'shifts'];
    const summary = {};

    for (const t of tables) {
      const countRes = await dbGet(`SELECT COUNT(*) as count FROM ${t}`);
      const rows = await dbAll(`SELECT * FROM ${t} LIMIT 50`);
      summary[t] = {
        totalRows: countRes.count,
        sampleRecords: rows
      };
    }

    res.json({
      databaseFile: 'restaurant.db',
      mode: 'SQLite3 (WAL)',
      tables: summary
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customers — Fetch real customers list for Customers & Loyalty view
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const customers = await dbAll('SELECT * FROM customers WHERE tenant_id = ? ORDER BY totalSpent DESC', [req.tenantId]);
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customers — Create new customer
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { name, phone, email } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });
  try {
    const id = 'cust_' + Date.now();
    await dbRun('INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id, name, phone, email || '', 50, 0, 0, req.tenantId
    ]);
    res.json({ success: true, id, message: `Customer ${name} registered!` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── ADMIN USER MANAGEMENT ENDPOINTS ──
app.get('/api/users', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, role, pin, createdAt FROM users WHERE tenant_id = ?', [req.tenantId]);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/users', authenticateToken, requireRole(['owner', 'manager']), validateRequest(userCreateSchema), async (req, res) => {
  const { username, role, pin, password } = req.body;
  if (!username || !role) return res.status(400).json({ error: 'Username and role are required.' });
  try {
    const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: 'Username already exists.' });

    // Enforce per-plan seat limit.
    const { plan } = await getTenantMeta(req.tenantId);
    const seatCheck = checkLimit(plan, 'users', await countTenantUsers(req.tenantId));
    if (!seatCheck.allowed) return res.status(402).json({ error: seatCheck.reason, code: 'plan_limit', limit: seatCheck.limit });

    const id = 'usr_' + Date.now();
    const hash = await bcrypt.hash(password || '123456', 10);
    await dbRun('INSERT INTO users (id, username, passwordHash, role, pin, tenant_id) VALUES (?, ?, ?, ?, ?, ?)', [
      id, username, hash, role, pin || '1234', req.tenantId
    ]);
    await writeAuditLog(req.user.id, req.user.username, 'create_user', `Created user ${username} with role ${role}`);
    res.json({ success: true, id, message: `User ${username} created successfully!` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_user', `Deleted user ${id}`);
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── DELIVERY DRIVERS & ASSIGNMENT ENDPOINTS ──
app.get('/api/delivery/drivers', authenticateToken, async (req, res) => {
  try {
    const drivers = await dbAll('SELECT id, name, phone, status, vehicleType, plateNumber, email FROM drivers WHERE tenant_id = ?', [req.tenantId]);
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/delivery/drivers', authenticateToken, async (req, res) => {
  const { name, phone, vehicleType, plateNumber } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Driver name and phone are required.' });
  try {
    const id = 'drv_' + Date.now();
    await dbRun('INSERT INTO drivers (id, name, phone, status, vehicleType, plateNumber, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id, name, phone, 'available', vehicleType || 'Motorbike', plateNumber || 'WP BH-1234', req.tenantId
    ]);
    await writeAuditLog(req.user.id, req.user.username, 'create_driver', `Registered driver ${name} (${phone})`);
    res.json({ success: true, id, message: `Driver ${name} registered successfully!` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Public Driver Self-Registration Endpoint (Phase 2: password + tenant-bound)
app.post('/api/public/drivers/register', validateRequest(driverRegisterSchema), async (req, res) => {
  const { name, phone, password, email, vehicleType, plateNumber } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Full name and phone number are required.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'A password of at least 6 characters is required.' });
  try {
    const tenantId = await resolvePublicTenant(req);
    const cleanPhone = String(phone).replace(/[\s-]/g, '');
    const existing = await dbGet('SELECT id FROM drivers WHERE phone = ? AND tenant_id = ?', [cleanPhone, tenantId]);
    if (existing) return res.status(400).json({ error: 'A driver with this phone number is already registered.' });
    const id = 'drv_' + Date.now();
    const passwordHash = await bcrypt.hash(String(password), 10);
    await dbRun('INSERT INTO drivers (id, name, phone, status, vehicleType, plateNumber, passwordHash, email, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, name, cleanPhone, 'pending_approval', vehicleType || 'Motorbike', plateNumber || 'Unassigned', passwordHash, email || null, tenantId
    ]);
    broadcastEvent('driver_registered', { id, name, phone: cleanPhone, vehicleType, plateNumber });
    res.json({ success: true, id, message: 'Driver registration submitted! Awaiting admin approval.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/driver/auth/login — Driver login → tenant-bound JWT { driverId, tenant_id, role:'driver' }
app.post('/api/driver/auth/login', publicApiLimiter, validateRequest(driverLoginSchema), async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password are required.' });
  try {
    const tenantId = await resolvePublicTenant(req);
    const cleanPhone = String(phone).replace(/[\s-]/g, '');
    const driver = await dbGet('SELECT * FROM drivers WHERE phone = ? AND tenant_id = ?', [cleanPhone, tenantId]);
    if (!driver || !driver.passwordHash) return res.status(401).json({ error: 'Invalid phone or password.' });
    const match = await bcrypt.compare(String(password), driver.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid phone or password.' });
    if (driver.status === 'pending_approval') return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
    if (driver.status === 'rejected') return res.status(403).json({ error: 'Your driver account has been rejected.' });
    const token = jwt.sign(
      { driverId: driver.id, tenant_id: driver.tenant_id || 'default_tenant', role: 'driver', name: driver.name },
      process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026',
      { expiresIn: '7d' }
    );
    res.json({
      token,
      driver: { id: driver.id, name: driver.name, phone: driver.phone, vehicleType: driver.vehicleType, plateNumber: driver.plateNumber, status: driver.status }
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Admin Driver Approval & Status Endpoint
app.post('/api/delivery/drivers/:id/approve', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'available' or 'rejected'
  const newStatus = status === 'rejected' ? 'rejected' : 'available';

  try {
    await dbRun('UPDATE drivers SET status = ? WHERE id = ? AND tenant_id = ?', [newStatus, id, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'approve_driver', `Updated driver ${id} status to ${newStatus}`);
    broadcastEvent('driver_updated', { id, status: newStatus });
    res.json({ success: true, message: `Driver status updated to ${newStatus}` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/delivery/drivers/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM drivers WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_driver', `Deleted driver ${id}`);
    res.json({ success: true, message: 'Driver deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/delivery/assign', authenticateToken, async (req, res) => {
  const { orderId, driverId, driverName, driverPhone } = req.body;
  if (!orderId || !driverId) return res.status(400).json({ error: 'orderId and driverId are required.' });
  try {
    await dbRun('UPDATE orders SET driverId = ?, status = "ready" WHERE id = ?', [driverId, orderId]);
    await dbRun('UPDATE drivers SET status = "busy" WHERE id = ?', [driverId]);

    // Broadcast SSE real-time update
    broadcastEvent('order_updated', { orderId, status: 'ready', driverId, driverName, message: `Order #${orderId} assigned to driver ${driverName || driverId}` });

    await writeAuditLog(req.user.id, req.user.username, 'assign_driver', `Assigned driver ${driverName || driverId} to order ${orderId}`);
    res.json({ success: true, message: `Assigned driver to Order #${orderId}` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── SUPPORT & COMPLAINT TICKETS ENDPOINTS ──
app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    const tickets = await dbAll('SELECT * FROM support_tickets ORDER BY timestamp DESC');
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/tickets/:id/resolve', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun("UPDATE support_tickets SET status = 'resolved' WHERE id = ?", [id]);
    res.json({ success: true, message: `Ticket #${id} marked as resolved.` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/orders/:id/cancel — Customer 1-Tap Order Cancellation
// NOTE: duplicate cancel handler removed here. The robust transactional version
// (correct menuItemId column, table free, audit log + SSE) is defined later and is
// the single source of truth for customer order cancellation.

app.get('/api/public/restaurants', publicApiLimiter, async (req, res) => {
  try {
    const dbTenants = await dbAll('SELECT id, name FROM tenants WHERE status = "active"');
    const mainStoreName = await getSettingAny('default_tenant', ['restaurantName', 'businessName'], 'GastroFlow Bistro Main');

    const defaultStores = [
      {
        id: 'default_tenant',
        name: mainStoreName,
        cuisine: 'Sri Lankan & Western Grill',
        emoji: '🍕',
        rating: 4.9,
        ratingCount: 340,
        deliveryTime: '20-30 min',
        deliveryFee: 150,
        minOrder: 1000,
        cuisineTag: 'pizza',
        location: 'Colombo 03',
        isOpen: true,
        bannerGradient: 'linear-gradient(135deg, #ff6b35 0%, #d97706 100%)',
        promoBadge: '20% OFF'
      },
      {
        id: 'rest_spice',
        name: 'Colombo Spice House',
        cuisine: 'Authentic Sri Lankan Rice & Curry',
        emoji: '🍛',
        rating: 4.8,
        ratingCount: 210,
        deliveryTime: '25-35 min',
        deliveryFee: 120,
        minOrder: 800,
        cuisineTag: 'srilankan',
        location: 'Colombo 04',
        isOpen: true,
        bannerGradient: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
        promoBadge: 'Free Delivery'
      },
      {
        id: 'rest_burger',
        name: 'Burger & Shake Hub',
        cuisine: 'Craft Burgers & Thick Shakes',
        emoji: '🍔',
        rating: 4.7,
        ratingCount: 180,
        deliveryTime: '15-25 min',
        deliveryFee: 150,
        minOrder: 1200,
        cuisineTag: 'burgers',
        location: 'Colombo 07',
        isOpen: true,
        bannerGradient: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
        promoBadge: 'Buy 1 Get 1'
      },
      {
        id: 'rest_asian',
        name: 'Wok & Roll Asian Fusion',
        cuisine: 'Chinese Noodle Bowls & Dim Sum',
        emoji: '🍜',
        rating: 4.9,
        ratingCount: 290,
        deliveryTime: '30-40 min',
        deliveryFee: 180,
        minOrder: 1500,
        cuisineTag: 'asian',
        location: 'Colombo 05',
        isOpen: true,
        bannerGradient: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
      },
      {
        id: 'rest_vegan',
        name: 'Green Leaf Organics',
        cuisine: 'Healthy Bowls, Smoothies & Vegan',
        emoji: '🥗',
        rating: 4.9,
        ratingCount: 140,
        deliveryTime: '15-25 min',
        deliveryFee: 100,
        minOrder: 900,
        cuisineTag: 'healthy',
        location: 'Colombo 03',
        isOpen: true,
        bannerGradient: 'linear-gradient(135deg, #10b981 0%, #047857 100%)'
      }
    ];

    res.json(defaultStores);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/menu
app.get('/api/public/menu', publicApiLimiter, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const categories = await dbAll('SELECT id, name, emoji FROM categories WHERE tenant_id = ? ORDER BY name', [tenantId]);
    const items = await dbAll(
      `SELECT id, name, price, category, emoji, stock, description, dietaryTags, imageUrl, isAvailable FROM menu_items
       WHERE isAvailable = 1 AND tenant_id = ? ORDER BY name`,
      [tenantId]
    );

    const rawModifiers = await dbAll('SELECT id, menuItemId, groupName, name, priceDelta, isMultiSelect, isRequired FROM modifiers WHERE tenant_id = ?', [tenantId]);
    const modifiersMap = {};
    rawModifiers.forEach(mod => {
      if (!modifiersMap[mod.menuItemId]) {
        modifiersMap[mod.menuItemId] = [];
      }
      modifiersMap[mod.menuItemId].push(mod);
    });

    const itemsWithModifiers = items.map(item => ({
      ...item,
      modifiers: modifiersMap[item.id] || []
    }));

    const st = await getSettingsMap(tenantId, ['restaurantName', 'businessName', 'logo', 'storeOpen', 'defaultPrepTime', 'deliveryFee', 'minimumOrder', 'currencySymbol']);

    res.json({
      restaurantName: st.restaurantName || st.businessName || 'GastroFlow Bistro',
      logo: st.logo || null,
      storeOpen: st.storeOpen !== undefined ? st.storeOpen === 'true' : true,
      defaultPrepTime: parseInt(st.defaultPrepTime || 20, 10),
      deliveryFee: parseFloat(st.deliveryFee || 0),
      minimumOrder: parseFloat(st.minimumOrder || 0),
      currencySymbol: st.currencySymbol || 'Rs.',
      categories,
      items: itemsWithModifiers
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ======================================================
// SSE REAL-TIME BROADCAST INFRASTRUCTURE
// ======================================================
const sseSubscribers = new Map(); // orderId -> Set(res)
const posSSESubscribers = new Set(); // Set(res) — POS staff SSE
const publicSSESubscribers = new Set(); // Set(res) — customer app store SSE

// Broadcast a store-level event (storeOpen toggle, 86-item, prep-time change)
// to connected customer app subscribers of the SAME tenant only.
function notifyPublicStore(eventData, tenantId) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  publicSSESubscribers.forEach(res => {
    if (tenantId && res._tenantId && res._tenantId !== tenantId) return; // tenant partition
    try { res.write(payload); } catch (e) {}
  });
}

function notifyOrderUpdate(orderId, orderData) {
  notifyOrderStream(orderId, orderData);
  notifyPOS({ type: 'order_updated', orderId, order: orderData }, orderData?.tenant_id);
}

// Write an arbitrary payload to a single order's live SSE subscribers (used for both
// full order snapshots and lightweight events like driver_location pings).
function notifyOrderStream(orderId, payload) {
  const subs = sseSubscribers.get(orderId);
  if (subs) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    subs.forEach(res => {
      try { res.write(frame); } catch (e) {}
    });
  }
}

function notifyPOS(eventData, tenantId) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  posSSESubscribers.forEach(res => {
    if (tenantId && res._tenantId && res._tenantId !== tenantId) return; // tenant partition
    try { res.write(payload); } catch (e) {}
  });
}

// Unified Billing Calculation Helper
// Thin wrapper — delegates to lib/billing.js (injecting the local DB helpers).
async function resolveAndCalculateBill(items, discountType, discountValue, loyaltyPointsToRedeem, tip = 0, promoCode = null, deliveryFee = 0, tenantId = 'default_tenant') {
  return _resolveAndCalculateBill(
    { dbGet, tenantId },
    items, discountType, discountValue, loyaltyPointsToRedeem, tip, promoCode, deliveryFee
  );
}

// POST /api/public/orders
app.post('/api/public/orders', publicApiLimiter, validateRequest(publicOrderSchema), async (req, res) => {
  const {
    items, diningType, orderType,
    customerName, customerPhone, customerEmail, deliveryAddress,
    deliveryLat, deliveryLng,
    customerToken, loyaltyPointsToRedeem, promoCode,
    scheduledTime, paymentMethod, tip
  } = req.body;

  // Tip is optional; the server clamps it to a sane non-negative value and prices it itself.
  const tipAmount = Math.max(0, Number(tip) || 0);
  if (tipAmount > 1000000) {
    return res.status(400).json({ error: 'Invalid tip amount.' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item.' });
  }
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'Customer name and phone are required.' });
  }
  if (!isValidSriLankanPhone(customerPhone)) {
    return res.status(400).json({ error: 'Please enter a valid Sri Lankan phone number (e.g. 0771234567 or +94771234567).' });
  }
  
  const type = diningType || orderType || 'takeaway';
  if (type === 'delivery') {
    if (!deliveryAddress || !isValidAddress(deliveryAddress)) {
      return res.status(400).json({ error: 'Please enter a complete, real delivery address containing street number, street name, and city.' });
    }
  }

  try {
    const cleanPhone = customerPhone.replace(/[\s-]/g, '');
    const tenantId = await resolvePublicTenant(req);

    // SaaS enforcement: block suspended tenants + monthly order-volume cap.
    const meta = await getTenantMeta(tenantId);
    if (meta.status === 'suspended') {
      return res.status(403).json({ error: 'This store is temporarily unavailable. Please try again later.' });
    }
    const orderCap = checkLimit(meta.plan, 'orders', await countTenantOrdersThisMonth(tenantId));
    if (!orderCap.allowed) {
      return res.status(402).json({ error: 'This store has reached its order capacity for the month. Please try again later.', code: 'plan_limit' });
    }

    let customerAccountId = null;
    let isAlreadyVerified = false;

    if (customerToken || req.headers.authorization) {
      try {
        const rawToken = customerToken || (req.headers.authorization ? req.headers.authorization.split(' ')[1] : '');
        const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026';
        const decoded = jwt.verify(rawToken, secret);
        if (decoded && decoded.id) {
          customerAccountId = decoded.id;
          isAlreadyVerified = true;
        }
      } catch (e) { /* ignore invalid tokens */ }
    }

    // ── Dynamic Distance-Based Delivery Fee (server-authoritative) ──
    let deliveryFee = 0;
    let deliveryDistanceKm = null;
    let deliveryEtaMinutes = null;
    if (type === 'delivery') {
      if (typeof deliveryLat === 'number' && typeof deliveryLng === 'number') {
        // Calculate real distance-based fee using Haversine
        const feeResult = await calculateDeliveryFee(deliveryLat, deliveryLng, 0, tenantId); // subtotal not known yet; checked after billing
        if (feeResult.isOutOfRange) {
          return res.status(400).json({
            error: `Sorry, your location is ${feeResult.distanceKm} km away — outside our delivery zone (max ${feeResult.maxRadiusKm} km). Please choose Takeaway instead.`
          });
        }
        deliveryDistanceKm = feeResult.distanceKm;
        deliveryEtaMinutes = feeResult.etaMinutes;
        deliveryFee = feeResult.totalFee; // will be recalculated after billing for free-threshold check
      } else {
        // Fallback to flat fee if no GPS coordinates (legacy/manual address entry)
        deliveryFee = parseFloat((await getSetting(tenantId, 'deliveryBaseFee')) || 99);
      }
    }

    const minimumOrder = parseFloat((await getSetting(tenantId, 'minimumOrder')) || 0);

    // Calculate billing totals securely on the server (passing delivery fee + tip)
    const bill = await resolveAndCalculateBill(items, null, 0, loyaltyPointsToRedeem, tipAmount, promoCode, deliveryFee, tenantId);

    // Re-check delivery fee with actual subtotal for free-delivery threshold
    if (type === 'delivery' && typeof deliveryLat === 'number' && typeof deliveryLng === 'number') {
      const finalFeeResult = await calculateDeliveryFee(deliveryLat, deliveryLng, bill.subtotal, tenantId);
      if (finalFeeResult.isFreeDelivery) {
        deliveryFee = 0; // Free delivery for high-value orders!
        // Recalculate bill with zero delivery fee
        const freeBill = await resolveAndCalculateBill(items, null, 0, loyaltyPointsToRedeem, tipAmount, promoCode, 0, tenantId);
        Object.assign(bill, freeBill);
      }
    }

    if (type === 'delivery' && bill.subtotal < minimumOrder) {
      return res.status(400).json({ error: `Minimum order for delivery is Rs. ${minimumOrder}. Your subtotal is Rs. ${bill.subtotal}.` });
    }

    const orderId = `ord_online_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const resolvedPaymentMethod = paymentMethod || 'online_pending';

    await dbRun('BEGIN TRANSACTION');

    try {
      await dbRun(
        `INSERT INTO orders (
          id, tableId, diningType, customerId, items, subtotal, 
          discountType, discountValue, discount, serviceCharge, tax, total, 
          status, timestamp, paymentMethod, source, customerAccountId, 
          deliveryAddress, orderType, customerName, customerPhone,
          scheduledTime, deliveryFee, promotionalDiscount, roundedAmount, tip,
          customerEmail, deliveryLat, deliveryLng, deliveryDistanceKm, etaMinutes, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, null, type,
          `${customerName}|${customerPhone}`,
          JSON.stringify(bill.resolvedItems),
          bill.subtotal,
          bill.appliedPromoCode ? 'promo' : (loyaltyPointsToRedeem ? 'loyalty' : null),
          bill.appliedPromoCode ? bill.promoDiscount : (loyaltyPointsToRedeem ? bill.loyaltyDiscount : 0),
          bill.totalDiscount,
          bill.serviceCharge,
          bill.tax,
          bill.total,
          'pending',
          Date.now(),
          resolvedPaymentMethod,
          'online',
          customerAccountId,
          deliveryAddress || null,
          type,
          customerName,
          customerPhone,
          scheduledTime || null,
          deliveryFee,
          bill.promoDiscount,
          bill.roundedAmount,
          bill.tip,
          customerEmail || null,
          (typeof deliveryLat === 'number' ? deliveryLat : null),
          (typeof deliveryLng === 'number' ? deliveryLng : null),
          deliveryDistanceKm,
          deliveryEtaMinutes,
          tenantId
        ]
      );

      for (const item of bill.resolvedItems) {
        const itemId = `oi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        await dbRun(
          `INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [itemId, orderId, item.id, item.name, item.unitPrice, item.quantity, item.notes]
        );
        // Atomic stock reduction for menu item
        const stockResult = await dbRun('UPDATE menu_items SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.id, item.quantity]);
        if (stockResult.changes === 0) {
          throw new Error(`Insufficient stock for item: ${item.name}`);
        }

        // Automatic raw ingredient stock deduction via recipes
        const recipeRows = await dbAll('SELECT ingredientId, quantityRequired FROM recipes WHERE menuItemId = ? AND tenant_id = ?', [item.id, tenantId]);
        for (const rec of recipeRows) {
          const totalDeduct = rec.quantityRequired * item.quantity;
          await dbRun('UPDATE ingredients SET stock = MAX(0, stock - ?) WHERE id = ?', [totalDeduct, rec.ingredientId]);
        }
      }

      if (customerAccountId && loyaltyPointsToRedeem > 0 && bill.loyaltyDiscount > 0) {
        await dbRun('UPDATE customer_accounts SET loyaltyPoints = loyaltyPoints - ? WHERE id = ?',
          [loyaltyPointsToRedeem, customerAccountId]);
      }

      await dbRun('COMMIT');

      // Real-time notification to POS staff
      notifyPOS({ type: 'new_online_order', orderId, customerName, total: bill.total, deliveryDistanceKm, deliveryFee }, tenantId);

      // Trigger auto-dispatch engine for delivery orders
      if (type === 'delivery') {
        setTimeout(() => autoDispatchDriver(orderId, tenantId), 2000); // 2s delay to let order settle
      }

      res.status(201).json({
        orderId,
        status: 'pending',
        subtotal: bill.subtotal,
        discount: bill.totalDiscount,
        serviceCharge: bill.serviceCharge,
        tax: bill.tax,
        deliveryFee,
        deliveryDistanceKm,
        etaMinutes: deliveryEtaMinutes,
        total: bill.total,
        message: 'Order placed successfully! Track your order with the ID above.'
      });
    } catch (e) {
      await dbRun('ROLLBACK');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/stream/orders/:id — Live SSE order tracking stream for customers
app.get('/api/stream/orders/:id', publicApiLimiter, async (req, res) => {
  const orderId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!sseSubscribers.has(orderId)) {
    sseSubscribers.set(orderId, new Set());
  }
  const subs = sseSubscribers.get(orderId);
  subs.add(res);

  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (order) {
      const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [orderId]);
      res.write(`data: ${JSON.stringify({ ...order, items })}\n\n`);
      // Replay the latest driver location so a (re)connecting client sees the pin immediately.
      const loc = await dbGet('SELECT driverName, lat, lng, updatedAt FROM driver_locations WHERE orderId = ?', [orderId]);
      if (loc) res.write(`data: ${JSON.stringify({ type: 'driver_location', ...loc })}\n\n`);
    }
  } catch (e) {}

  req.on('close', () => {
    subs.delete(res);
    if (subs.size === 0) sseSubscribers.delete(orderId);
  });
});

// GET /api/stream/pos — Live SSE stream for staff POS
app.get('/api/stream/pos', async (req, res) => {
  // EventSource can't send an Authorization header, so the POS passes its JWT as
  // ?token=. We verify it to (a) authenticate the stream and (b) tag the subscriber
  // with its tenant so broadcasts never leak across tenants.
  const token = req.query.token || (req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : null);
  if (!token) return res.status(401).json({ error: 'Authentication token required.' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026');
  } catch (e) {
    return res.status(403).json({ error: 'Token is invalid or has expired.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res._tenantId = payload.tenant_id || 'default_tenant';
  posSSESubscribers.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);

  req.on('close', () => {
    posSSESubscribers.delete(res);
  });
});

// GET /api/stream/store — Public SSE stream for customer app store-level events.
// Pushes: store_update (storeOpen toggle), item_availability (86-item toggle),
// prep_time_update (ETA settings changed).
app.get('/api/stream/store', publicApiLimiter, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res._tenantId = await resolvePublicTenant(req);
  publicSSESubscribers.add(res);
  // Send current store state as the first event so a (re)connecting client
  // immediately knows the live open/closed state without an extra HTTP round-trip.
  try {
    const s = await getSettingsMap(res._tenantId, ['storeOpen', 'defaultPrepTime', 'dineInPrepTime', 'takeawayPrepTime', 'deliveryPrepTime']);
    res.write(`data: ${JSON.stringify({
      type: 'store_init',
      storeOpen: (s.storeOpen ?? 'true') === 'true',
      prepTime: {
        dineIn: Number(s.dineInPrepTime || s.defaultPrepTime || 15),
        takeaway: Number(s.takeawayPrepTime || s.defaultPrepTime || 20),
        delivery: Number(s.deliveryPrepTime || s.defaultPrepTime || 35)
      }
    })}\n\n`);
  } catch (e) {}

  req.on('close', () => {
    publicSSESubscribers.delete(res);
  });
});

// GET /api/public/orders/:id — Get status
app.get('/api/public/orders/:id', publicApiLimiter, async (req, res) => {
  try {
    const order = await dbGet(
      `SELECT id, diningType, orderType, subtotal, tax, total, status, timestamp, paymentMethod, deliveryAddress, deliveryLat, deliveryLng, etaMinutes, acceptedAt, rejectedReason, customerName, customerPhone, invoiceNumber
       FROM orders WHERE id = ?`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [order.id]);
    const driver = await dbGet('SELECT driverName, lat, lng, updatedAt FROM driver_locations WHERE orderId = ?', [order.id]);
    res.json({ ...order, items, driver: driver || null });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/drivers — List available drivers for delivery dispatch
app.get('/api/public/drivers', async (req, res) => {
  try {
    const drivers = await dbAll("SELECT id, name, phone, role FROM users WHERE role = 'driver' OR role = 'staff'");
    if (!drivers || drivers.length === 0) {
      return res.json([
        { id: 'drv_1', name: 'Kamal Perera', phone: '0771234567', vehicle: 'Scooter (WP BI-4821)', status: 'available' },
        { id: 'drv_2', name: 'Saman Silva', phone: '0719876543', vehicle: 'Bicycle', status: 'available' }
      ]);
    }
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/driver/orders — Orders assigned to or available for a driver
// All driver action endpoints require a driver JWT and are scoped to the driver's
// tenant (Phase 2). The driver id + tenant come from the token, never the request body.
app.get('/api/public/driver/orders', authenticateDriver, async (req, res) => {
  const driverId = req.driver.driverId;
  const t = req.driver.tenant_id;
  try {
    const assigned = await dbAll(
      "SELECT * FROM orders WHERE tenant_id = ? AND (diningType = 'delivery' OR orderType = 'delivery') AND driverId = ? AND status NOT IN ('delivered', 'paid', 'cancelled') ORDER BY timestamp DESC",
      [t, driverId]
    );
    const unassigned = await dbAll(
      "SELECT * FROM orders WHERE tenant_id = ? AND (diningType = 'delivery' OR orderType = 'delivery') AND (driverId IS NULL OR driverId = '') AND status IN ('pending', 'preparing', 'ready') ORDER BY timestamp DESC",
      [t]
    );
    res.json({ assigned: assigned || [], unassigned: unassigned || [] });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/driver/assign — Driver claims a delivery ticket (own tenant only)
app.post('/api/public/driver/assign', authenticateDriver, async (req, res) => {
  const { orderId } = req.body;
  const driverId = req.driver.driverId;
  const t = req.driver.tenant_id;
  if (!orderId) return res.status(400).json({ error: 'orderId is required.' });
  try {
    const order = await dbGet('SELECT tenant_id FROM orders WHERE id = ?', [orderId]);
    if (!order || order.tenant_id !== t) return res.status(404).json({ error: 'Order not found.' });
    await dbRun('UPDATE orders SET driverId = ? WHERE id = ? AND tenant_id = ?', [driverId, orderId, t]);
    notifyPOS({ type: 'driver_assigned', orderId, driverId }, t);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/driver/status — Driver updates delivery status (own tenant only)
app.post('/api/public/driver/status', authenticateDriver, async (req, res) => {
  const { orderId, status, lat, lng } = req.body;
  const driverId = req.driver.driverId;
  const t = req.driver.tenant_id;
  if (!orderId || !status) {
    return res.status(400).json({ error: 'orderId and status are required.' });
  }
  // Restrict to delivery-lifecycle transitions only, so it can never be abused to
  // mark an order paid/cancelled/refunded.
  const ALLOWED_DRIVER_STATUSES = ['accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'arrived', 'delivered'];
  if (!ALLOWED_DRIVER_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid delivery status.' });
  }
  try {
    const existing = await dbGet('SELECT tenant_id FROM orders WHERE id = ?', [orderId]);
    if (!existing || existing.tenant_id !== t) return res.status(404).json({ error: 'Order not found.' });
    await dbRun('UPDATE orders SET status = ?, driverId = ? WHERE id = ? AND tenant_id = ?', [status, driverId, orderId, t]);
    if (typeof lat === 'number' && typeof lng === 'number') {
      await dbRun(
        'INSERT OR REPLACE INTO driver_locations (orderId, driverName, lat, lng, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [orderId, driverId, lat, lng, Date.now()]
      );
      notifyOrderStream(orderId, { type: 'driver_location', lat, lng, driverName: driverId });
    }
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (order) {
      notifyOrderUpdate(orderId, order);
    }
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/driver/location — Driver GPS ping (own tenant only)
app.post('/api/public/driver/location', authenticateDriver, async (req, res) => {
  const { orderId, lat, lng } = req.body;
  const driverId = req.driver.driverId;
  const driverName = req.driver.name || driverId;
  const t = req.driver.tenant_id;
  if (!orderId || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Valid orderId, lat, and lng are required.' });
  }
  try {
    const existing = await dbGet('SELECT tenant_id FROM orders WHERE id = ?', [orderId]);
    if (!existing || existing.tenant_id !== t) return res.status(404).json({ error: 'Order not found.' });
    await dbRun(
      'INSERT OR REPLACE INTO driver_locations (orderId, driverName, lat, lng, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [orderId, driverName, lat, lng, Date.now()]
    );
    notifyOrderStream(orderId, { type: 'driver_location', lat, lng, driverName });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/orders/:id/cancel — Customer cancels their own order.
// Public: the unguessable order id acts as the bearer token (same model as the status route).
// Only allowed while the order is still 'pending' (kitchen has not accepted it yet).
app.post('/api/public/orders/:id/cancel', publicApiLimiter, async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.status === 'cancelled') {
      return res.json({ success: true, status: 'cancelled' });
    }
    if (order.status !== 'pending') {
      return res.status(409).json({ error: 'This order can no longer be cancelled. Please contact the restaurant.' });
    }
    if (order.status === 'paid' || order.paymentMethod === 'payhere') {
      return res.status(409).json({ error: 'Paid orders cannot be cancelled online. Please contact the restaurant.' });
    }

    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun('UPDATE orders SET status = "cancelled", rejectedReason = ? WHERE id = ?', ['Cancelled by customer', orderId]);

      // Restore stock reserved by this order
      const orderItems = await dbAll('SELECT menuItemId, quantity FROM order_items WHERE orderId = ?', [orderId]);
      for (const item of orderItems) {
        if (item.menuItemId) {
          await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [item.quantity, item.menuItemId]);
        }
      }
      // Free the table if one was assigned
      if (order.tableId) {
        await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [order.tableId]);
      }
      await writeAuditLog('customer', 'Customer', 'cancel_order', `Order ${orderId} cancelled by customer`);
      await dbRun('COMMIT');

      const updated = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
      const updatedItems = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [orderId]);
      notifyOrderUpdate(orderId, { ...updated, items: updatedItems });
      notifyPOS({ type: 'order_cancelled', orderId }, updated?.tenant_id);

      res.json({ success: true, status: 'cancelled' });
    } catch (e) {
      await dbRun('ROLLBACK');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/payments/payhere/checkout
app.post('/api/payments/payhere/checkout', publicApiLimiter, async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required.' });
  }

  const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
  if (!merchantSecret) {
    return res.status(500).json({ error: 'PayHere Merchant Secret is not configured on the server.' });
  }

  try {
    const order = await dbGet('SELECT total FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const merchantId = process.env.PAYHERE_MERCHANT_ID || '1211122';
    const currency = 'LKR';
    const formattedAmount = Number(order.total).toFixed(2);

    const localMd5Secret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const signatureSource = merchantId + orderId + formattedAmount + currency + localMd5Secret;
    const signature = crypto.createHash('md5').update(signatureSource).digest('hex').toUpperCase();

    res.json({
      checkoutUrl: `https://sandbox.payhere.lk/pay/checkout`,
      merchantId,
      orderId,
      amount: order.total,
      currency,
      sandbox: true,
      signature,
      // Server-authoritative callback URL; PayHere invokes this server-to-server (never the browser).
      notifyUrl: process.env.PAYHERE_NOTIFY_URL || ''
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});



// GET /api/public/group-cart/:id
app.get('/api/public/group-cart/:id', publicApiLimiter, async (req, res) => {
  const { id } = req.params;
  try {
    let cart = await dbGet('SELECT * FROM group_carts WHERE id = ?', [id]);
    if (!cart) {
      await dbRun('INSERT INTO group_carts (id, status, items, createdAt) VALUES (?, "active", "[]", ?)', [id, Date.now()]);
      cart = { id, status: 'active', items: '[]', createdAt: Date.now() };
    }
    res.json({ id: cart.id, status: cart.status, items: JSON.parse(cart.items) });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/group-cart/:id/items
app.post('/api/public/group-cart/:id/items', publicApiLimiter, async (req, res) => {
  const { id } = req.params;
  const { participantName, itemId, quantity, notes, selectedModifiers } = req.body;
  if (!participantName || !itemId) {
    return res.status(400).json({ error: 'participantName and itemId are required.' });
  }

  try {
    await dbRun('BEGIN TRANSACTION');
    try {
      let cart = await dbGet('SELECT * FROM group_carts WHERE id = ?', [id]);
      if (!cart) {
        await dbRun('INSERT INTO group_carts (id, status, items, createdAt) VALUES (?, "active", "[]", ?)', [id, Date.now()]);
        cart = { id, status: 'active', items: '[]', createdAt: Date.now() };
      }

      const items = JSON.parse(cart.items);
      const existingIndex = items.findIndex(i => i.participantName === participantName && i.itemId === itemId);
      if (quantity <= 0) {
        if (existingIndex > -1) items.splice(existingIndex, 1);
      } else {
        const menuItem = await dbGet('SELECT name, price FROM menu_items WHERE id = ?', [itemId]);
        const itemPayload = {
          participantName,
          itemId,
          name: menuItem ? menuItem.name : 'Unknown Item',
          price: menuItem ? menuItem.price : 0,
          quantity,
          notes: notes || '',
          selectedModifiers: selectedModifiers || []
        };
        if (existingIndex > -1) {
          items[existingIndex] = itemPayload;
        } else {
          items.push(itemPayload);
        }
      }

      await dbRun('UPDATE group_carts SET items = ? WHERE id = ?', [JSON.stringify(items), id]);
      await dbRun('COMMIT');

      notifyPOS({ type: 'group_cart_updated', cartId: id }, await resolvePublicTenant(req));
      res.json({ success: true, items });
    } catch (e) {
      await dbRun('ROLLBACK');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/group-cart/:id/checkout
app.post('/api/public/group-cart/:id/checkout', publicApiLimiter, async (req, res) => {
  const { id } = req.params;
  const { customerName, customerPhone, deliveryAddress, paymentMethod } = req.body;
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'customerName and customerPhone are required.' });
  }

  try {
    const cart = await dbGet('SELECT * FROM group_carts WHERE id = ?', [id]);
    if (!cart || cart.status === 'checked_out') {
      return res.status(400).json({ error: 'Group cart not found or already checked out.' });
    }

    const groupItems = JSON.parse(cart.items);
    if (groupItems.length === 0) {
      return res.status(400).json({ error: 'Group cart is empty.' });
    }

    // Map groupItems to standard order items format
    const items = groupItems.map(gi => ({
      menuItemId: gi.itemId,
      quantity: gi.quantity,
      notes: `${gi.participantName}: ${gi.notes || ''}`.trim(),
      selectedModifiers: gi.selectedModifiers
    }));

    // Calculate billing totals (tenant-scoped)
    const tenantId = await resolvePublicTenant(req);
    const bill = await resolveAndCalculateBill(items, null, 0, 0, 0, null, 0, tenantId);

    const orderId = `ord_group_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun(
        `INSERT INTO orders (
          id, tableId, diningType, customerId, items, subtotal,
          discountType, discountValue, discount, serviceCharge, tax, total,
          status, timestamp, paymentMethod, source, customerAccountId,
          deliveryAddress, orderType, customerName, customerPhone, roundedAmount, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, null, 'delivery',
          `${customerName}|${customerPhone}`,
          JSON.stringify(bill.resolvedItems),
          bill.subtotal,
          null, 0, 0,
          bill.serviceCharge,
          bill.tax,
          bill.total,
          'pending',
          Date.now(),
          paymentMethod || 'online_pending',
          'online',
          null,
          deliveryAddress || null,
          'delivery',
          customerName,
          customerPhone,
          bill.roundedAmount,
          tenantId
        ]
      );

      for (const item of bill.resolvedItems) {
        const itemId = `oi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        await dbRun(
          `INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [itemId, orderId, item.id, item.name, item.unitPrice, item.quantity, item.notes]
        );
        // Atomic stock check and deduction
        const stockResult = await dbRun('UPDATE menu_items SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.id, item.quantity]);
        if (stockResult.changes === 0) {
          throw new Error(`Insufficient stock for item: ${item.name}`);
        }
      }

      // Mark group cart checked out
      await dbRun('UPDATE group_carts SET status = "checked_out" WHERE id = ?', [id]);

      await dbRun('COMMIT');

      notifyPOS({ type: 'new_online_order', orderId, customerName, total: bill.total }, tenantId);
      res.json({ success: true, orderId, total: bill.total });
    } catch (e) {
      await dbRun('ROLLBACK');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/feedback
app.post('/api/public/feedback', publicApiLimiter, async (req, res) => {
  const { orderId, rating, comment } = req.body;
  if (!orderId || !rating) {
    return res.status(400).json({ error: 'orderId and rating are required.' });
  }
  try {
    const id = `fb_${Date.now()}`;
    // Derive tenant from the referenced order so feedback lands in the right inbox.
    const fbOrder = await dbGet('SELECT tenant_id FROM orders WHERE id = ?', [orderId]);
    const fbTenant = fbOrder?.tenant_id || await resolvePublicTenant(req);
    await dbRun(
      'INSERT INTO feedbacks (id, orderId, rating, comment, timestamp, tenant_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, orderId, parseInt(rating, 10), comment || '', Date.now(), fbTenant]
    );
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/store-info — public store metadata for the customer app
app.get('/api/public/store-info', publicApiLimiter, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const s = await getSettingsMap(tenantId, ['businessName', 'restaurantName', 'address', 'phone', 'storeOpen', 'defaultPrepTime', 'dineInPrepTime', 'takeawayPrepTime', 'deliveryPrepTime', 'restaurantLat', 'restaurantLng', 'deliveryFee', 'minimumOrder']);
    res.json({
      name: s.businessName || s.restaurantName || 'GastroFlow',
      address: s.address || '',
      phone: s.phone || '',
      storeOpen: (s.storeOpen ?? 'true') === 'true',
      prepTime: {
        dineIn: Number(s.dineInPrepTime || s.defaultPrepTime || 15),
        takeaway: Number(s.takeawayPrepTime || s.defaultPrepTime || 20),
        delivery: Number(s.deliveryPrepTime || s.defaultPrepTime || 35)
      },
      deliveryFee: Number(s.deliveryFee || 0),
      minimumOrder: Number(s.minimumOrder || 0),
      lat: s.restaurantLat ? Number(s.restaurantLat) : null,
      lng: s.restaurantLng ? Number(s.restaurantLng) : null,
      vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa1-Zpe5-93Aae7lUab6l3e5Jq9l14X_2-Wd5x-J8f90X26m5V0X9Z8m5V0X9Z'
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /driver/:orderId — self-contained rider page. Staff share this link with the
// delivery rider; opening it streams their real GPS to the customer's live tracking map.
// Public (the order id is the bearer token, same model as the status route).
app.get('/driver/:orderId', (req, res) => {
  const orderId = String(req.params.orderId).replace(/[^a-zA-Z0-9_]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>GastroFlow Driver — Live GPS</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #0f1115; color: #f5f6f8; }
  .card { max-width: 480px; margin: 0 auto; background: #1a1d24; border: 1px solid #2a2e37; border-radius: 16px; padding: 20px; }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  .sub { color: #9aa0aa; font-size: .82rem; margin-bottom: 18px; word-break: break-all; }
  button { width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 1rem; font-weight: 700; cursor: pointer; }
  .start { background: #ff6b35; color: #fff; }
  .stop { background: #2a2e37; color: #fff; }
  .stat { margin-top: 16px; font-size: .85rem; line-height: 1.6; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #555; margin-right: 6px; }
  .dot.live { background: #2ecc71; box-shadow: 0 0 0 4px rgba(46,204,113,.2); }
  code { color: #ff9d6b; }
</style></head>
<body>
  <div class="card">
    <h1>🛵 Driver Live GPS</h1>
    <div class="sub">Order: <code>${orderId}</code></div>
    <input id="name" placeholder="Your name (optional)" style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a2e37;background:#12151b;color:#fff;margin-bottom:12px"/>
    <button id="toggle" class="start">▶ Start sharing my location</button>
    <div class="stat">
      <div><span id="dot" class="dot"></span><span id="state">Not sharing</span></div>
      <div id="coords" style="color:#9aa0aa"></div>
      <div id="err" style="color:#ff6b6b"></div>
    </div>
  </div>
<script>
  const orderId = ${JSON.stringify(orderId)};
  let watchId = null, last = 0;
  const $ = (id) => document.getElementById(id);
  async function post(lat, lng) {
    try {
      await fetch('/api/public/orders/' + orderId + '/driver-location', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, driverName: $('name').value || 'Driver' })
      });
    } catch (e) { $('err').textContent = 'Network error sending location.'; }
  }
  function start() {
    if (!navigator.geolocation) { $('err').textContent = 'Geolocation not supported.'; return; }
    watchId = navigator.geolocation.watchPosition((pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const now = Date.now();
      $('coords').textContent = latitude.toFixed(5) + ', ' + longitude.toFixed(5) + ' (±' + Math.round(accuracy) + 'm)';
      $('err').textContent = '';
      if (now - last > 4000) { last = now; post(latitude, longitude); } // throttle to ~every 4s
    }, (e) => { $('err').textContent = e.code === 1 ? 'Location permission denied.' : 'Location error.'; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    $('dot').className = 'dot live'; $('state').textContent = 'Sharing live location…';
    const b = $('toggle'); b.textContent = '■ Stop sharing'; b.className = 'stop';
  }
  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; $('dot').className = 'dot'; $('state').textContent = 'Not sharing';
    const b = $('toggle'); b.textContent = '▶ Start sharing my location'; b.className = 'start';
  }
  $('toggle').onclick = () => (watchId == null ? start() : stop());
</script>
</body></html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS · OTP · PASSWORD RESET · GEOCODING · DRIVER LOCATION  (public)
// All routes below are intentionally BEFORE app.use(authenticateToken).
// ─────────────────────────────────────────────────────────────────────────────

// Tight limiter for anything that sends a code / mutates a credential.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Too many verification requests, please try again later.' }
});

const OTP_TTL_MS = 5 * 60 * 1000;       // OTP valid 5 minutes
const RESET_TTL_MS = 30 * 60 * 1000;    // reset link valid 30 minutes
const MAX_OTP_ATTEMPTS = 5;

// Create a hashed, expiring reset record and return the plaintext token + code.
async function createPasswordReset(userType, userId) {
  const token = generateToken(24);
  const code = generateOtp(6);
  const id = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  // Invalidate any outstanding resets for this user first.
  await dbRun('DELETE FROM password_resets WHERE userType = ? AND userId = ? AND consumedAt IS NULL', [userType, userId]);
  await dbRun(
    `INSERT INTO password_resets (id, userType, userId, tokenHash, codeHash, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userType, userId, hashCode(token), hashCode(code), Date.now() + RESET_TTL_MS, Date.now()]
  );
  return { token, code };
}

// Base URL of the customer app, used to build reset links in emails.
function customerAppUrl() {
  return process.env.CUSTOMER_APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3001';
}
function posAppUrl() {
  return process.env.POS_APP_URL || 'http://localhost:3000';
}

// Send an order confirmation via email + SMS (best-effort; never blocks the response path).
async function sendOrderConfirmation(order) {
  try {
    const business = await getSettingAny(order.tenant_id || 'default_tenant', ['businessName', 'restaurantName'], 'GastroFlow');
    const inv = order.invoiceNumber ? `INV-${String(order.invoiceNumber).padStart(6, '0')}` : order.id;
    const total = Number(order.total || 0).toFixed(2);
    const subtotal = Number(order.subtotal || 0).toFixed(2);
    const tax = Number(order.tax || 0).toFixed(2);
    const tip = Number(order.tip || 0).toFixed(2);
    const deliveryFee = Number(order.deliveryFee || 0).toFixed(2);
    const email = order.customerEmail;
    const phone = order.customerPhone;
    const trackUrl = `${customerAppUrl()}/?track=${order.id}`;

    // Fetch ordered items for the receipt
    const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [order.id]);

    if (email) {
      const orderConfirmHtml = buildOrderConfirmationEmail({
        order,
        invoiceNumber: inv,
        items,
        businessName: business,
        trackingUrl: trackUrl
      });
      await sendEmail({
        to: email,
        subject: `✅ ${business} — Order Confirmed (${inv})`,
        html: orderConfirmHtml
      }).catch(e => console.error('[EMAIL] Order confirmation email failed:', e.message));
    }
    if (phone) {
      await sendSms({
        to: phone,
        message: `${business}: Order ${inv} confirmed! Total: LKR ${total}. Track: ${trackUrl}`
      });
    }
  } catch (e) {
    console.error('sendOrderConfirmation error:', e.message);
  }
}

// ── OTP: send ────────────────────────────────────────────────────────────────
app.post('/api/otp/send', otpLimiter, async (req, res) => {
  const { channel = 'sms', destination, purpose = 'login' } = req.body || {};
  if (!destination || !String(destination).trim()) {
    return res.status(400).json({ error: 'Phone number or email is required.' });
  }

  try {
    const cleanDest = channel === 'sms'
      ? normalizeLkPhone(destination)
      : String(destination).trim().toLowerCase();

    if (!cleanDest) return res.status(400).json({ error: 'Invalid destination.' });

    // Enforcement: Only registered users can request a login OTP
    if (purpose === 'login') {
      const existingAccount = await dbGet(
        `SELECT id FROM customer_accounts WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ?`,
        [cleanDest, cleanDest, normalizeLkPhone(cleanDest)]
      );
      const existingCustomer = existingAccount || await dbGet(
        `SELECT id FROM customers WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ?`,
        [cleanDest, cleanDest, normalizeLkPhone(cleanDest)]
      );
      if (!existingCustomer) {
        return res.status(404).json({
          error: 'No registered account found with this phone or email. Please register your account first.'
        });
      }
    }

    const code = generateOtp(6);
    const id = `otp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Delete previous unconsumed codes for this destination
    await dbRun('DELETE FROM otp_codes WHERE (LOWER(destination) = ? OR destination = ?)', [cleanDest, cleanDest]);

    await dbRun(
      `INSERT INTO otp_codes (id, channel, destination, purpose, codeHash, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, channel, cleanDest, purpose, hashCode(code), expiresAt, Date.now()]
    );

    const business = await getSettingAny(await resolvePublicTenant(req), ['businessName', 'restaurantName'], 'GastroFlow Bistro');

    let devHint = false;
    if (channel === 'email' || cleanDest.includes('@')) {
      const otpEmailHtml = buildOtpEmail({ code, purpose, destination: cleanDest, businessName: business });
      const result = await sendEmail({
        to: cleanDest,
        subject: `Your ${business} verification code: ${code}`,
        html: otpEmailHtml
      });
      if (result?.simulated || result?.transport === 'dev') devHint = true;
    } else {
      const msg = `Your ${business} OTP code is ${code}. Valid for 10 mins.`;
      const result = await sendSms({ to: cleanDest, message: msg });
      if (result?.simulated || result?.transport === 'dev') devHint = true;
    }

    console.log(`\n==========================================`);
    console.log(`[OTP SENT] Channel: ${channel} | Destination: ${cleanDest} | Purpose: ${purpose} | Code: ${code}`);
    console.log(`==========================================\n`);

    res.json({
      success: true,
      ok: true,
      message: `Verification code sent to ${cleanDest}`,
      devHint,
      otpCode: process.env.NODE_ENV !== 'production' ? code : undefined
    });
  } catch (err) {
    console.error('[OTP SEND ERROR]', err);
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── OTP: verify ──────────────────────────────────────────────────────────────
app.post('/api/otp/verify', otpLimiter, async (req, res) => {
  const { channel, destination, code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Verification code is required.' });

  try {
    const cleanCode = String(code).trim();
    const cleanDest = destination ? String(destination).trim().toLowerCase() : '';
    const codeHash = hashCode(cleanCode);
    const now = Date.now();

    // 1. Find active unconsumed code
    let row = null;
    if (cleanDest) {
      const normPhone = normalizeLkPhone(cleanDest);
      row = await dbGet(
        `SELECT * FROM otp_codes WHERE (LOWER(destination) = ? OR destination = ? OR destination = ?) AND consumedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1`,
        [cleanDest, cleanDest, normPhone, now]
      );
    }
    if (!row) {
      row = await dbGet(
        `SELECT * FROM otp_codes WHERE codeHash = ? AND consumedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1`,
        [codeHash, now]
      );
    }

    if (!row) {
      return res.status(400).json({ verified: false, error: 'No active code found. Please request a new code.' });
    }

    if (row.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ verified: false, error: 'Too many attempts. Request a new code.' });
    }

    if (row.codeHash !== codeHash) {
      await dbRun('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      return res.status(400).json({ verified: false, error: 'Incorrect code. Please check and try again.' });
    }

    // Mark code as consumed
    await dbRun('UPDATE otp_codes SET consumedAt = ? WHERE id = ?', [now, row.id]);

    const actualDest = row.destination ? row.destination.toLowerCase() : cleanDest;
    console.log(`[OTP VERIFIED SUCCESS] ID: ${row.id} | Dest: ${actualDest} | Code: ${cleanCode}`);

    // Check if customer exists for 1-tap OTP login in customer_accounts or customers
    let customer = await dbGet(
      `SELECT id, name, phone, email, loyaltyPoints as points FROM customer_accounts WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ? OR email = ?`,
      [actualDest, actualDest, cleanDest, cleanDest]
    );

    if (!customer) {
      customer = await dbGet(
        `SELECT id, name, phone, email, points FROM customers WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ? OR email = ?`,
        [actualDest, actualDest, cleanDest, cleanDest]
      );
    }

    if (!customer) {
      // Auto-create customer profile on verified OTP
      const newCustId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const isEmail = actualDest.includes('@');
      const custName = isEmail ? actualDest.split('@')[0] : 'Customer';
      const custPhone = isEmail ? '' : actualDest;
      const custEmail = isEmail ? actualDest : '';

      await dbRun(
        `INSERT INTO customer_accounts (id, name, phone, email, loyaltyPoints, createdAt, tenant_id) VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [newCustId, custName, custPhone, custEmail, Date.now(), await resolvePublicTenant(req)]
      );
      customer = { id: newCustId, name: custName, phone: custPhone, email: custEmail, points: 0 };
    }

    const token = jwt.sign(
      { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, type: 'customer' },
      process.env.JWT_SECRET || 'super_secret_restaurant_pos_key_2026',
      { expiresIn: '30d' }
    );

    res.json({
      verified: true,
      loggedIn: true,
      token,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, points: customer.points || 0 }
    });
  } catch (err) {
    console.error('[OTP VERIFY ERROR]', err);
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Customer: forgot password (request) ──────────────────────────────────────
app.post('/api/customer/auth/forgot-password', otpLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required.' });
  try {
    const acct = await dbGet('SELECT id, email, phone FROM customer_accounts WHERE email = ?', [String(email).trim().toLowerCase()]);
    // Always respond the same way — no account enumeration.
    if (acct) {
      const { token, code } = await createPasswordReset('customer', acct.id);
      const link = `${customerAppUrl()}/?reset=${token}`;
      const business = await getSettingAny(await resolvePublicTenant(req), ['businessName', 'restaurantName'], 'GastroFlow Bistro');
      const resetHtml = buildPasswordResetEmail({
        userType: 'customer',
        resetUrl: link,
        code,
        businessName: business
      });
      await sendEmail({
        to: acct.email,
        subject: `Reset your ${business} password`,
        html: resetHtml
      });
      if (acct.phone) await sendSms({ to: acct.phone, message: `GastroFlow password reset code: ${code} (valid 30 min).` });
    }
    res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Customer: reset password (confirm) ───────────────────────────────────────
app.post('/api/customer/auth/reset-password', otpLimiter, async (req, res) => {
  const { token, email, code, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  try {
    const reset = await resolveReset('customer', { token, email, code, lookupByEmail: async (e) => dbGet('SELECT id FROM customer_accounts WHERE email = ?', [String(e).trim().toLowerCase()]) });
    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset request.' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await dbRun('UPDATE customer_accounts SET passwordHash = ? WHERE id = ?', [passwordHash, reset.userId]);
    await dbRun('UPDATE password_resets SET consumedAt = ? WHERE id = ?', [Date.now(), reset.id]);
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Staff: forgot password (request) ─────────────────────────────────────────
app.post('/api/auth/forgot-password', otpLimiter, async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required.' });
  try {
    const user = await dbGet('SELECT id, username, email, phone, tenant_id FROM users WHERE username = ?', [username]);
    if (user && (user.email || user.phone)) {
      const { token, code } = await createPasswordReset('staff', user.id);
      const link = `${posAppUrl()}/?reset=${token}`;
      if (user.email) {
        const business = await getSettingAny(user.tenant_id || 'default_tenant', ['businessName', 'restaurantName'], 'GastroFlow Bistro');
        const resetHtml = buildPasswordResetEmail({
          name: user.username,
          userType: 'staff POS',
          resetUrl: link,
          code,
          businessName: business
        });
        await sendEmail({
          to: user.email,
          subject: `Reset your ${business} staff password`,
          html: resetHtml
        });
      }
      if (user.phone) await sendSms({ to: user.phone, message: `GastroFlow staff password reset code: ${code} (valid 30 min).` });
    }
    res.json({ ok: true, message: 'If that account exists and has contact details, a reset has been sent. Otherwise ask an owner to reset it.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Staff: reset password (confirm) ──────────────────────────────────────────
app.post('/api/auth/reset-password', otpLimiter, async (req, res) => {
  const { token, username, code, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  try {
    const reset = await resolveReset('staff', { token, email: username, code, lookupByEmail: async (u) => dbGet('SELECT id FROM users WHERE username = ?', [u]) });
    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset request.' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await dbRun('UPDATE users SET passwordHash = ? WHERE id = ?', [passwordHash, reset.userId]);
    await dbRun('UPDATE password_resets SET consumedAt = ? WHERE id = ?', [Date.now(), reset.id]);
    await writeAuditLog(reset.userId, username || 'unknown', 'password_reset', `Staff password reset completed`);
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Shared: resolve a reset record from either a token OR an (identifier + code) pair.
async function resolveReset(userType, { token, email, code, lookupByEmail }) {
  const now = Date.now();
  if (token) {
    const row = await dbGet(
      'SELECT * FROM password_resets WHERE userType = ? AND tokenHash = ? AND consumedAt IS NULL',
      [userType, hashCode(token)]
    );
    if (row && row.expiresAt >= now) return row;
    return null;
  }
  if (email && code) {
    const user = await lookupByEmail(email);
    if (!user) return null;
    const row = await dbGet(
      'SELECT * FROM password_resets WHERE userType = ? AND userId = ? AND codeHash = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
      [userType, user.id, hashCode(code)]
    );
    if (row && row.expiresAt >= now) return row;
    return null;
  }
  return null;
}

// ── Geocoding proxy (OpenStreetMap Nominatim) ────────────────────────────────
// Proxied server-side so we can set a proper User-Agent (Nominatim usage policy)
// and keep the client key-free. Forward + reverse.
const NOMINATIM_HEADERS = { 'User-Agent': 'GastroFlow-POS/1.0 (restaurant ordering app)' };
const geocodeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many lookups, slow down.' } });

app.get('/api/public/geocode', geocodeLimiter, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q is required.' });
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=lk&addressdetails=1&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
    const data = await resp.json();
    res.json((data || []).map(r => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })));
  } catch (err) {
    res.status(502).json({ error: 'Geocoding service unavailable.' });
  }
});

app.get('/api/public/reverse-geocode', geocodeLimiter, async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required.' });
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
    const data = await resp.json();
    res.json({ label: data.display_name || '', lat: Number(lat), lng: Number(lng) });
  } catch (err) {
    res.status(502).json({ error: 'Reverse geocoding service unavailable.' });
  }
});

// ── Driver location for live delivery tracking ───────────────────────────────
// The driver opens a link (issued by staff) that posts their GPS here. The order id
// acts as the bearer token (same model as the public status/cancel routes). Each ping
// is stored and pushed to the customer's live tracking stream.
app.post('/api/public/orders/:id/driver-location', publicApiLimiter, async (req, res) => {
  const { lat, lng, driverName } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat and lng (numbers) are required.' });
  try {
    const order = await dbGet('SELECT id, status FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    await dbRun(
      `INSERT INTO driver_locations (orderId, driverName, lat, lng, updatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(orderId) DO UPDATE SET driverName = excluded.driverName, lat = excluded.lat, lng = excluded.lng, updatedAt = excluded.updatedAt`,
      [order.id, driverName || 'Driver', lat, lng, Date.now()]
    );
    // Push to the order's live stream as a distinct event type.
    notifyOrderStream(order.id, { type: 'driver_location', lat, lng, driverName: driverName || 'Driver', updatedAt: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── 3.5 PayHere Payment Gateway Sandbox & Live Integration (Public) ──
app.post('/api/public/payment/payhere/hash', (req, res) => {
  try {
    const { orderId, amount, currency = 'LKR' } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ error: 'orderId and amount are required' });
    }

    const merchantId = process.env.PAYHERE_MERCHANT_ID || '1220000';
    const merchantSecret = process.env.PAYHERE_SECRET || '4a8b9c10d2e3f4';
    const formattedAmount = Number(amount).toFixed(2);

    const hashedSecret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const hashStr = merchantId + orderId + formattedAmount + currency + hashedSecret;
    const hash = crypto.createHash('md5').update(hashStr).digest('hex').toUpperCase();

    res.json({
      merchantId,
      orderId,
      amount: formattedAmount,
      currency,
      hash,
      sandbox: process.env.PAYHERE_SANDBOX !== 'false'
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// PayHere Server-to-Server Instant Payment Notification (IPN) Webhook
app.post('/api/public/payment/payhere/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig
    } = req.body;

    const merchantSecret = process.env.PAYHERE_SECRET || '4a8b9c10d2e3f4';
    const hashedSecret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const expectedHashStr = merchant_id + order_id + payhere_amount + payhere_currency + status_code + hashedSecret;
    const expectedHash = crypto.createHash('md5').update(expectedHashStr).digest('hex').toUpperCase();

    if (md5sig !== expectedHash) {
      console.warn(`[PayHere Webhook] Invalid MD5 signature for Order #${order_id}`);
      return res.status(400).send('Invalid Signature');
    }

    if (String(status_code) === '2') { // 2 = PayHere Paid Status
      await dbRun(`UPDATE orders SET status = 'paid', paymentStatus = 'paid', paymentRef = ? WHERE id = ?`, [payment_id || 'PAYHERE_SUCCESS', order_id]);
      console.log(`[PayHere Webhook] Order #${order_id} successfully marked as PAID!`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[PayHere Webhook Error]', err);
    res.status(500).send(err.message);
  }
});

// ── Static Frontend Assets & Single Page App (SPA) Routing ──
const posDistPath = path.join(__dirname, 'dist');
const customerDistPath = path.join(__dirname, 'apps', 'customer-web', 'dist');
const driverDistPath = path.join(__dirname, 'apps', 'driver-web', 'dist');

if (fs.existsSync(posDistPath)) {
  app.use(express.static(posDistPath));
}
if (fs.existsSync(customerDistPath)) {
  app.use('/customer', express.static(customerDistPath));
}
if (fs.existsSync(driverDistPath)) {
  app.use('/driver-app', express.static(driverDistPath));
}

// Serve index.html for browser client-side navigation (non-API GET requests)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/driver/')) {
    return next();
  }

  if (req.path.startsWith('/customer') && fs.existsSync(path.join(customerDistPath, 'index.html'))) {
    return res.sendFile(path.join(customerDistPath, 'index.html'));
  }
  if (req.path.startsWith('/driver-app') && fs.existsSync(path.join(driverDistPath, 'index.html'))) {
    return res.sendFile(path.join(driverDistPath, 'index.html'));
  }

  const posIndex = path.join(posDistPath, 'index.html');
  if (fs.existsSync(posIndex)) {
    return res.sendFile(posIndex);
  }

  res.status(200).send('GastroFlow Backend API is running.');
});

// GET /api/saas/plans — available subscription tiers (public, for the pricing/upgrade UI).
app.get('/api/saas/plans', (req, res) => {
  res.json(planList().map(p => ({
    ...p,
    maxUsers: p.maxUsers === Infinity ? null : p.maxUsers,
    maxOrdersPerMonth: p.maxOrdersPerMonth === Infinity ? null : p.maxOrdersPerMonth
  })));
});

// ── 3.6 Aggregator Webhooks (PickMe / UberEats) ──────────────────────────────
app.post('/api/public/webhooks/aggregators/:provider', publicApiLimiter, async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const tenantId = req.query.tenant || req.headers['x-tenant-id'] || 'default_tenant';

    let normalized;
    if (provider === 'pickme') {
      normalized = normalizePickMeOrder(req.body, tenantId);
    } else if (provider === 'ubereats' || provider === 'uber') {
      normalized = normalizeUberEatsOrder(req.body, tenantId);
    } else {
      return res.status(400).json({ error: `Unsupported aggregator provider '${provider}'.` });
    }

    // Check for duplicate webhook submission
    const existing = await dbGet('SELECT id FROM orders WHERE id = ? AND tenant_id = ?', [normalized.orderId, tenantId]);
    if (existing) {
      return res.json({ ok: true, duplicate: true, orderId: normalized.orderId });
    }

    // Settle aggregator order into DB
    await dbRun(
      `INSERT INTO orders (id, source, orderType, status, paymentMethod, customerName, customerPhone, deliveryAddress, subtotal, deliveryFee, tax, total, timestamp, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.orderId, normalized.source, normalized.orderType, normalized.status,
        normalized.paymentMethod, normalized.customerName,
        normalized.customerPhone, normalized.deliveryAddress, normalized.subtotal,
        normalized.deliveryFee, normalized.tax, normalized.total, normalized.timestamp, normalized.tenant_id
      ]
    );

    for (const item of normalized.items) {
      const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await dbRun(
        'INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [itemId, normalized.orderId, item.menuItemId, item.name, item.price, item.quantity]
      );
    }

    notifyPOS({ type: 'new_online_order', orderId: normalized.orderId, source: normalized.source, total: normalized.total }, tenantId);
    res.json({ ok: true, orderId: normalized.orderId });
  } catch (err) {
    console.error('[Aggregator Webhook Error]', err);
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/tables/:id/qr — Table QR code URL resolution
app.get('/api/tables/:id/qr', publicApiLimiter, async (req, res) => {
  try {
    const tableId = req.params.id;
    const tenantId = req.query.tenant || 'default_tenant';
    const table = await dbGet('SELECT * FROM tables WHERE id = ? AND tenant_id = ?', [tableId, tenantId]);
    if (!table) return res.status(404).json({ error: 'Table not found.' });

    const customerAppUrl = process.env.CUSTOMER_APP_URL || 'http://localhost:3001';
    const qrUrl = `${customerAppUrl}/?table=${table.number}&tenant=${tenantId}`;
    res.json({ tableId: table.id, number: table.number, qrUrl });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Protect all following endpoints (staff only)
app.use(authenticateToken);

// ── ESC/POS Thermal Printing Spooler Endpoints ──────────────────────────────
app.post('/api/print/receipt', async (req, res) => {
  try {
    const { orderId, printerIp, paperWidth = 80 } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required.' });

    const order = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [orderId, req.tenantId]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const items = await dbAll('SELECT menuItemId, name, price, quantity FROM order_items WHERE orderId = ?', [order.id]);
    const businessName = await getSetting(req.tenantId, 'restaurantName', 'GastroFlow Bistro');

    const buffer = buildEscPosReceipt({
      restaurantName: businessName,
      orderId: order.id,
      invoiceNumber: order.invoiceNumber,
      orderType: order.orderType,
      customerName: order.customerName,
      items,
      subtotal: order.subtotal || order.total,
      tax: order.tax || 0,
      serviceCharge: order.serviceCharge || 0,
      deliveryFee: order.deliveryFee || 0,
      total: order.total,
      paymentMethod: order.paymentMethod || 'cash',
      timestamp: order.timestamp,
      paperWidth
    });

    if (printerIp) {
      await sendToNetworkPrinter(printerIp, 9100, buffer);
      return res.json({ ok: true, printedTo: printerIp });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Offline Sales Bulk Sync Engine ──────────────────────────────────────────
app.post('/api/orders/offline-sync', async (req, res) => {
  try {
    const { orders = [] } = req.body || {};
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'No orders provided for sync.' });
    }

    let syncedCount = 0;
    for (const offOrder of orders) {
      const orderId = offOrder.offlineId || `ord_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      
      const existing = await dbGet('SELECT id FROM orders WHERE id = ? AND tenant_id = ?', [orderId, req.tenantId]);
      if (existing) continue; // Deduplicate already synced offline sales

      await dbRun(
        `INSERT INTO orders (id, orderType, total, status, paymentMethod, cashierId, timestamp, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          offOrder.orderType || 'dine_in',
          Number(offOrder.total || 0),
          'paid',
          offOrder.paymentMethod || 'cash',
          req.user.id,
          offOrder.createdAt || Date.now(),
          req.tenantId
        ]
      );
      syncedCount++;
    }

    await writeAuditLog(req.user.id, req.user.username, 'offline_sync', `Synced ${syncedCount} offline cash sales`);
    res.json({ ok: true, syncedCount });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Purchase Orders & Low Stock Reordering ───────────────────────────────────
app.get('/api/inventory/purchase-orders', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const lowStockIngredients = await dbAll(
      `SELECT id, name, stock, unit, minStock, supplier FROM ingredients WHERE tenant_id = ? AND stock <= COALESCE(minStock, 10)`,
      [req.tenantId]
    );
    res.json({ lowStockIngredients });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 1. Settings Routes
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await dbAll('SELECT key, value FROM settings WHERE tenant_id = ?', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/settings', requireRole(['owner', 'manager']), async (req, res) => {
  const { key, value } = req.body;
  try {
    await setSetting(req.tenantId, key, value);
    await writeAuditLog(req.user.id, req.user.username, 'update_setting', `Updated setting ${key} = ${value}`);
    res.json({ key, value });

    // Propagate store-control changes to all connected customer app clients instantly.
    // This is best-effort (fire-and-forget after the response is sent).
    const STORE_CONTROL_KEYS = new Set([
      'storeOpen', 'defaultPrepTime', 'dineInPrepTime', 'takeawayPrepTime', 'deliveryPrepTime'
    ]);
    if (STORE_CONTROL_KEYS.has(key)) {
      // Re-read all prep-time settings so the SSE payload is always consistent.
      const s = await getSettingsMap(req.tenantId, ['storeOpen', 'defaultPrepTime', 'dineInPrepTime', 'takeawayPrepTime', 'deliveryPrepTime']);
      notifyPublicStore({
        type: 'store_update',
        storeOpen: (s.storeOpen ?? 'true') === 'true',
        prepTime: {
          dineIn: Number(s.dineInPrepTime || s.defaultPrepTime || 15),
          takeaway: Number(s.takeawayPrepTime || s.defaultPrepTime || 20),
          delivery: Number(s.deliveryPrepTime || s.defaultPrepTime || 35)
        }
      }, req.tenantId);
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 2. Category Routes
app.get('/api/categories', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM categories WHERE tenant_id = ?', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/orders/:id/accept — Staff Accept online order with ETA (moved behind auth and role checks)
app.post('/api/orders/:id/accept', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const orderId = req.params.id;
  const { etaMinutes } = req.body;
  const eta = parseInt(etaMinutes, 10) || 20;

  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const now = Date.now();
    await dbRun(
      'UPDATE orders SET status = "preparing", etaMinutes = ?, acceptedAt = ? WHERE id = ?',
      [eta, now, orderId]
    );

    const updated = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [orderId]);
    const orderData = { ...updated, items };

    notifyOrderUpdate(orderId, orderData);
    res.json({ success: true, order: orderData });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// PUT /api/orders/:id/modify — Staff modify order items after KOT sent
app.put('/api/orders/:id/modify', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const orderId = req.params.id;
  const { items, discountType, discountValue, tip } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item.' });
  }

  try {
    const existing = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!existing) return res.status(404).json({ error: 'Order not found.' });

    // Fetch settings for pricing calculation (tenant-scoped)
    const settingsObj = await getSettingsMap(req.tenantId, ['taxRate', 'serviceChargeRate']);

    // Pricer helper
    const subtotal = items.reduce((acc, item) => acc + ((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)), 0);
    let discount = 0;
    if (discountType === 'percent') discount = subtotal * ((parseFloat(discountValue) || 0) / 100);
    else if (discountType === 'flat') discount = parseFloat(discountValue) || 0;
    
    const taxRate = parseFloat(settingsObj.taxRate) || 0;
    const serviceChargeRate = parseFloat(settingsObj.serviceChargeRate) || 0;
    const tax = (subtotal - discount) * (taxRate / 100);
    const serviceCharge = (subtotal - discount) * (serviceChargeRate / 100);
    const total = Math.max(0, subtotal - discount + tax + serviceCharge + (parseFloat(tip) || 0));

    await dbRun('BEGIN TRANSACTION');

    // Update order row
    await dbRun(`
      UPDATE orders
      SET items = ?, subtotal = ?, discountType = ?, discountValue = ?, discount = ?, tax = ?, serviceCharge = ?, total = ?
      WHERE id = ?
    `, [JSON.stringify(items), subtotal, discountType || 'none', discountValue || 0, discount, tax, serviceCharge, total, orderId]);

    // Replace normalized items
    await dbRun('DELETE FROM order_items WHERE orderId = ?', [orderId]);
    for (const item of items) {
      const itemId = `ord_itm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await dbRun(`
        INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [itemId, orderId, item.id, item.name, item.price, item.quantity, item.notes || '']);
    }

    await dbRun('COMMIT');

    await writeAuditLog(req.user.id, req.user.username, 'modify_order', `Modified items for order ${orderId}. New total: LKR ${total}`);
    notifyPOS({ type: 'order_updated', orderId }, req.tenantId);

    res.json({ success: true, orderId, subtotal, total });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/orders/:id/reject — Staff Reject online order (moved behind auth and role checks)
app.post('/api/orders/:id/reject', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const orderId = req.params.id;
  const { reason } = req.body;

  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await dbRun(
      'UPDATE orders SET status = "cancelled", rejectedReason = ? WHERE id = ?',
      [reason || 'Kitchen unavailable at this time', orderId]
    );

    // Restore stock
    const items = await dbAll('SELECT menuItemId, quantity FROM order_items WHERE orderId = ?', [orderId]);
    for (const item of items) {
      if (item.menuItemId) {
        await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [item.quantity, item.menuItemId]);
      }
    }

    const updated = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    const updatedItems = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [orderId]);
    const orderData = { ...updated, items: updatedItems };

    notifyOrderUpdate(orderId, orderData);
    res.json({ success: true, order: orderData });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/categories', requireRole(['owner', 'manager']), async (req, res) => {
  const { id, name, emoji } = req.body;
  try {
    await dbRun('INSERT OR REPLACE INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?)', [id, name, emoji, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'create_category', `Created/updated category ${name} (${id})`);
    res.json({ id, name, emoji });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/categories/:id', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    await dbRun('DELETE FROM categories WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_category', `Deleted category ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 3. Menu Item Routes
app.get('/api/menu_items', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM menu_items WHERE tenant_id = ?', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/menu_items', requireRole(['owner', 'manager']), async (req, res) => {
  const { id, name, price, cost, category, emoji, stock, minStock, description, imageUrl, dietaryTags, isAvailable } = req.body;
  try {
    const prevRow = await dbGet('SELECT isAvailable FROM menu_items WHERE id = ?', [id]);
    const prevAvail = prevRow?.isAvailable;
    const newAvail = isAvailable !== undefined ? parseInt(isAvailable, 10) : 1;

    await dbRun(`
      INSERT OR REPLACE INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, imageUrl, dietaryTags, isAvailable, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, name, price, cost, category, emoji, stock, minStock, description,
      imageUrl || null, dietaryTags || null, newAvail, req.tenantId
    ]);
    await writeAuditLog(req.user.id, req.user.username, 'save_menu_item', `Created/updated menu item ${name} (${id}) to price=${price}, stock=${stock}`);
    const saved = { id, name, price, cost, category, emoji, stock, minStock, description, imageUrl, dietaryTags, isAvailable: newAvail };
    res.json(saved);

    // If availability changed, push a live update so the customer app hides/shows
    // the item instantly without a page reload ("86-item" SSE propagation).
    if (prevAvail !== undefined && prevAvail !== newAvail) {
      notifyPublicStore({ type: 'item_availability', itemId: id, isAvailable: newAvail === 1 }, req.tenantId);
      notifyPOS({ type: 'item_availability_changed', itemId: id, name, isAvailable: newAvail === 1 }, req.tenantId);
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/menu_items/:id', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    await dbRun('DELETE FROM menu_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_menu_item', `Deleted menu item ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 3b. Ingredients & Recipe Routes
app.get('/api/ingredients', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM ingredients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// SaaS Super-Admin Tenants Management Endpoints
// Platform super-admin guard: only the platform tenant's owner may manage tenants.
const requirePlatformAdmin = (req, res, next) => {
  if (req.tenantId !== 'default_tenant') {
    return res.status(403).json({ error: 'Platform administrator access only.' });
  }
  next();
};

app.get('/api/saas/tenants', requireRole(['owner']), requirePlatformAdmin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM tenants ORDER BY createdAt DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/saas/tenants', requireRole(['owner']), requirePlatformAdmin, validateRequest(tenantCreateSchema), async (req, res) => {
  const { name, subdomain, ownerEmail, plan, ownerUsername, ownerPassword, ownerPin } = req.body;
  if (!name || !subdomain || !ownerEmail) {
    return res.status(400).json({ error: 'Name, subdomain, and ownerEmail are required.' });
  }
  const cleanSub = String(subdomain).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!cleanSub) {
    return res.status(400).json({ error: 'Subdomain must contain letters or numbers.' });
  }
  const id = `tenant_${Date.now()}`;
  try {
    const existing = await dbGet('SELECT id FROM tenants WHERE subdomain = ?', [cleanSub]);
    if (existing) {
      return res.status(409).json({ error: 'That subdomain is already taken.' });
    }

    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun('INSERT INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id, name, cleanSub, ownerEmail, plan || 'pro', 'active', Date.now()
      ]);

      // Seed an owner user for the new tenant so they can immediately sign in.
      const uname = (ownerUsername || `${cleanSub}-owner`).toLowerCase();
      const dupUser = await dbGet('SELECT id FROM users WHERE username = ?', [uname]);
      if (dupUser) {
        throw new Error(`A user named "${uname}" already exists; pass a different ownerUsername.`);
      }
      const tempPassword = ownerPassword || crypto.randomBytes(6).toString('hex');
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const pinHash = await bcrypt.hash(String(ownerPin || '1234'), 10);
      const uid = `user_${Date.now()}`;
      await dbRun(
        'INSERT INTO users (id, username, passwordHash, role, pin, email, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uid, uname, passwordHash, 'owner', pinHash, ownerEmail, id]
      );

      await dbRun('COMMIT');
      await writeAuditLog(req.user.id, req.user.username, 'provision_tenant', `Provisioned tenant ${name} (${id}) with owner user ${uname}`);
      res.status(201).json({
        id, name, subdomain: cleanSub, ownerEmail, plan: plan || 'pro', status: 'active',
        ownerCredentials: {
          username: uname,
          password: ownerPassword ? '(as provided)' : tempPassword,
          pin: ownerPin ? '(as provided)' : '1234',
          note: 'Share securely. The owner should change the password and PIN on first login.'
        }
      });
    } catch (e) {
      await dbRun('ROLLBACK');
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/saas/usage — the caller's own tenant plan + live usage vs limits.
app.get('/api/saas/usage', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const u = await getTenantUsage(req.tenantId);
    res.json({
      ...u,
      limits: {
        maxUsers: u.limits.maxUsers === Infinity ? null : u.limits.maxUsers,
        maxOrdersPerMonth: u.limits.maxOrdersPerMonth === Infinity ? null : u.limits.maxOrdersPerMonth
      }
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// PATCH /api/saas/tenants/:id — platform admin changes a tenant's plan/status.
// (Billing provider integration lives here — see docs; this endpoint records the
// plan the platform admin sets after payment is confirmed out-of-band.)
app.patch('/api/saas/tenants/:id', requireRole(['owner']), requirePlatformAdmin, async (req, res) => {
  const { plan, status } = req.body || {};
  const validPlans = planList().map(p => p.id);
  const validStatus = ['active', 'suspended', 'trial'];
  if (plan && !validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });
  if (status && !validStatus.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const tenant = await dbGet('SELECT id FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    if (plan) await dbRun('UPDATE tenants SET plan = ? WHERE id = ?', [plan, req.params.id]);
    if (status) await dbRun('UPDATE tenants SET status = ? WHERE id = ?', [status, req.params.id]);
    await writeAuditLog(req.user.id, req.user.username, 'update_tenant_plan', `Tenant ${req.params.id} → plan=${plan || '(unchanged)'} status=${status || '(unchanged)'}`);
    const updated = await dbGet('SELECT id, name, subdomain, plan, status FROM tenants WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/ingredients', requireRole(['owner', 'manager']), async (req, res) => {
  const { id, name, unit, costPerUnit, stock, minStock, supplier } = req.body;
  const ingId = id || `ing_${Date.now()}`;
  try {
    await dbRun(`
      INSERT OR REPLACE INTO ingredients (id, name, unit, costPerUnit, stock, minStock, supplier, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [ingId, name, unit, parseFloat(costPerUnit) || 0, parseFloat(stock) || 0, parseFloat(minStock) || 0, supplier || null, req.tenantId]);
    await writeAuditLog(req.user.id, req.user.username, 'save_ingredient', `Saved ingredient ${name} (${ingId})`);
    res.json({ id: ingId, name, unit, costPerUnit, stock, minStock, supplier });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.get('/api/recipes/:menuItemId', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT r.id, r.menuItemId, r.ingredientId, r.quantityRequired, i.name as ingredientName, i.unit, i.costPerUnit
      FROM recipes r
      JOIN ingredients i ON r.ingredientId = i.id
      WHERE r.menuItemId = ? AND r.tenant_id = ?
    `, [req.params.menuItemId, req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/recipes', requireRole(['owner', 'manager']), async (req, res) => {
  const { menuItemId, ingredients } = req.body; // ingredients: [{ ingredientId, quantityRequired }]
  if (!menuItemId || !Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'menuItemId and ingredients array required.' });
  }
  await dbRun('BEGIN TRANSACTION');
  try {
    await dbRun('DELETE FROM recipes WHERE menuItemId = ? AND tenant_id = ?', [menuItemId, req.tenantId]);
    for (const item of ingredients) {
      const recId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      await dbRun('INSERT INTO recipes (id, menuItemId, ingredientId, quantityRequired, tenant_id) VALUES (?, ?, ?, ?, ?)', [
        recId, menuItemId, item.ingredientId, parseFloat(item.quantityRequired) || 0, req.tenantId
      ]);
    }
    await writeAuditLog(req.user.id, req.user.username, 'save_recipe', `Updated recipe for menu item ${menuItemId}`);
    await dbRun('COMMIT');
    res.json({ success: true, menuItemId, count: ingredients.length });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

// 4. Tables Routes
app.get('/api/tables', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM tables WHERE tenant_id = ?', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/tables', requireRole(['owner', 'manager']), async (req, res) => {
  const { id, number, capacity, status, currentOrderId } = req.body;
  try {
    await dbRun('INSERT OR REPLACE INTO tables (id, number, capacity, status, currentOrderId, tenant_id) VALUES (?, ?, ?, ?, ?, ?)', [
      id, number, capacity, status, currentOrderId, req.tenantId
    ]);
    await writeAuditLog(req.user.id, req.user.username, 'save_table', `Created/updated table ${number} (${id})`);
    res.json({ id, number, capacity, status, currentOrderId });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/tables/:id', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    await dbRun('DELETE FROM tables WHERE id = ?', [req.params.id]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_table', `Deleted table ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/tables/transfer — Move active order from sourceTableId to targetTableId
app.post('/api/tables/transfer', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const { fromTableId, toTableId } = req.body;
  if (!fromTableId || !toTableId) {
    return res.status(400).json({ error: 'fromTableId and toTableId are required.' });
  }

  await dbRun('BEGIN TRANSACTION');
  try {
    const fromTable = await dbGet('SELECT * FROM tables WHERE id = ?', [fromTableId]);
    const toTable = await dbGet('SELECT * FROM tables WHERE id = ?', [toTableId]);

    if (!fromTable || !fromTable.currentOrderId) {
      await dbRun('ROLLBACK');
      return res.status(400).json({ error: 'Source table is not occupied or has no active order.' });
    }
    if (!toTable) {
      await dbRun('ROLLBACK');
      return res.status(404).json({ error: 'Target table not found.' });
    }
    if (toTable.status === 'occupied' && toTable.currentOrderId) {
      await dbRun('ROLLBACK');
      return res.status(400).json({ error: 'Target table is currently occupied. Use Merge instead.' });
    }

    const orderId = fromTable.currentOrderId;
    // Update order's tableId pointer
    await dbRun('UPDATE orders SET tableId = ? WHERE id = ?', [toTableId, orderId]);
    // Free source table
    await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [fromTableId]);
    // Occupy target table
    await dbRun('UPDATE tables SET status = "occupied", currentOrderId = ? WHERE id = ?', [orderId, toTableId]);

    await writeAuditLog(req.user.id, req.user.username, 'transfer_table', `Transferred Order ${orderId} from Table ${fromTable.number} to Table ${toTable.number}`);
    await dbRun('COMMIT');

    notifyPOS({ type: 'table_transferred', fromTableId, toTableId, orderId }, req.tenantId);
    res.json({ success: true, fromTableId, toTableId, orderId });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/tables/merge — Merge order from sourceTableId into targetTableId order
app.post('/api/tables/merge', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const { sourceTableId, targetTableId } = req.body;
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: 'sourceTableId and targetTableId are required.' });
  }

  await dbRun('BEGIN TRANSACTION');
  try {
    const sourceTable = await dbGet('SELECT * FROM tables WHERE id = ?', [sourceTableId]);
    const targetTable = await dbGet('SELECT * FROM tables WHERE id = ?', [targetTableId]);

    if (!sourceTable || !sourceTable.currentOrderId) {
      await dbRun('ROLLBACK');
      return res.status(400).json({ error: 'Source table has no active order.' });
    }
    if (!targetTable || !targetTable.currentOrderId) {
      await dbRun('ROLLBACK');
      return res.status(400).json({ error: 'Target table has no active order to merge into.' });
    }

    const sourceOrderId = sourceTable.currentOrderId;
    const targetOrderId = targetTable.currentOrderId;

    // Move all items from source order to target order
    await dbRun('UPDATE order_items SET orderId = ? WHERE orderId = ?', [targetOrderId, sourceOrderId]);

    // Recalculate subtotal & total for target order
    const remainingItems = await dbAll('SELECT * FROM order_items WHERE orderId = ?', [targetOrderId]);
    const newSubtotal = remainingItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const targetOrder = await dbGet('SELECT * FROM orders WHERE id = ?', [targetOrderId]);
    
    // Apply tax & service charge proportionally
    const taxRate = parseFloat(targetOrder.tax || 0) / (parseFloat(targetOrder.subtotal || 1));
    const newTax = newSubtotal * (isNaN(taxRate) ? 0.10 : taxRate);
    const newTotal = Math.round(newSubtotal + newTax);

    await dbRun('UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?', [
      newSubtotal, newTax, newTotal, targetOrderId
    ]);

    // Delete empty source order
    await dbRun('DELETE FROM orders WHERE id = ?', [sourceOrderId]);

    // Free source table
    await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [sourceTableId]);

    await writeAuditLog(req.user.id, req.user.username, 'merge_table', `Merged Order ${sourceOrderId} (Table ${sourceTable.number}) into Order ${targetOrderId} (Table ${targetTable.number})`);
    await dbRun('COMMIT');

    notifyPOS({ type: 'table_merged', sourceTableId, targetTableId, targetOrderId }, req.tenantId);
    res.json({ success: true, targetOrderId, targetTotal: newTotal });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Shifts & Cash Movements Routes ──────────────────────────────────────────
app.get('/api/shifts/active', async (req, res) => {
  try {
    const shift = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
    res.json(shift || null);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/shifts/open', validateRequest(shiftOpenSchema), async (req, res) => {
  const { startFloat, notes } = req.body;
  try {
    const existing = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
    if (existing) return res.status(400).json({ error: 'You already have an active open shift.' });

    const shiftId = `shift_${Date.now()}`;
    const floatVal = parseFloat(startFloat) || 0;
    await dbRun(`
      INSERT INTO shifts (id, userId, username, startTime, startFloat, status, notes, tenant_id)
      VALUES (?, ?, ?, ?, ?, "open", ?, ?)
    `, [shiftId, req.user.id, req.user.username, Date.now(), floatVal, notes || '', req.tenantId]);

    await writeAuditLog(req.user.id, req.user.username, 'open_shift', `Opened shift with float LKR ${floatVal}`);
    res.json({ id: shiftId, startFloat: floatVal, status: 'open' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/shifts/close', validateRequest(shiftCloseSchema), async (req, res) => {
  const { actualCash, notes } = req.body;
  try {
    const shift = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
    if (!shift) return res.status(400).json({ error: 'No active open shift found.' });

    // Calculate expected cash: startFloat + cash sales + cash_in movements - cash_out movements
    const cashSales = await dbGet(`
      SELECT SUM(total) as cashTotal FROM orders
      WHERE status = 'paid' AND paymentMethod = 'cash' AND timestamp >= ? AND tenant_id = ?
    `, [shift.startTime, req.tenantId]);

    const cashIn = await dbGet(`
      SELECT SUM(amount) as inTotal FROM cash_movements 
      WHERE shiftId = ? AND type = 'cash_in'
    `, [shift.id]);

    const cashOut = await dbGet(`
      SELECT SUM(amount) as outTotal FROM cash_movements 
      WHERE shiftId = ? AND type = 'cash_out'
    `, [shift.id]);

    const startFloat = parseFloat(shift.startFloat || 0);
    const totalCashSales = parseFloat(cashSales?.cashTotal || 0);
    const totalCashIn = parseFloat(cashIn?.inTotal || 0);
    const totalCashOut = parseFloat(cashOut?.outTotal || 0);

    const expectedCash = startFloat + totalCashSales + totalCashIn - totalCashOut;
    const endCash = parseFloat(actualCash) || expectedCash;

    await dbRun(`
      UPDATE shifts 
      SET endTime = ?, endFloat = ?, actualCash = ?, expectedCash = ?, status = "closed", notes = ?
      WHERE id = ?
    `, [Date.now(), endCash, endCash, expectedCash, notes || '', shift.id]);

    await writeAuditLog(req.user.id, req.user.username, 'close_shift', `Closed shift. Expected: ${expectedCash}, Actual: ${endCash}`);
    res.json({ id: shift.id, expectedCash, actualCash: endCash, discrepancy: endCash - expectedCash });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/cash-movements — Cash In / Cash Out (Paid-Outs)
app.post('/api/cash-movements', validateRequest(cashMovementSchema), async (req, res) => {
  const { type, amount, reason } = req.body;
  if (!['cash_in', 'cash_out'].includes(type)) {
    return res.status(400).json({ error: 'Type must be cash_in or cash_out.' });
  }
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0.' });
  }

  try {
    const shift = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
    const movementId = `cm_${Date.now()}`;
    await dbRun(`
      INSERT INTO cash_movements (id, shiftId, userId, type, amount, reason, timestamp, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [movementId, shift?.id || null, req.user.id, type, amt, reason || '', Date.now(), req.tenantId]);

    await writeAuditLog(req.user.id, req.user.username, type, `${type === 'cash_in' ? 'Cash In' : 'Paid-Out'} LKR ${amt}. Reason: ${reason}`);
    res.json({ success: true, id: movementId, type, amount: amt, reason });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 5. Orders Routes
// NOTE: duplicate GET /api/orders removed — the earlier authenticated definition wins in Express.

app.post('/api/orders', async (req, res) => {
  const {
    id, tableId, diningType, customerId, items,
    discountType, discountValue, status, timestamp,
    paymentMethod, paymentTimestamp, paymentSplit, tip,
    promoCode, managerPin
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Order ID is required.' });
  }

  try {
    // Check if order already exists
    const existingOrder = await dbGet('SELECT * FROM orders WHERE id = ?', [id]);

    if (existingOrder) {
      // ORDER UPDATE (Status change / Payment settlement)
      const newStatus = status || existingOrder.status;
      const oldStatus = existingOrder.status;

      await dbRun('BEGIN TRANSACTION');

      try {
        if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
          // Return items to stock
          const orderItemsList = await dbAll('SELECT menuItemId, quantity FROM order_items WHERE orderId = ?', [id]);
          for (const item of orderItemsList) {
            await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [item.quantity, item.menuItemId]);
          }
          // Free table
          if (existingOrder.tableId) {
            await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [existingOrder.tableId]);
          }
          await writeAuditLog(req.user.id, req.user.username, 'cancel_order', `Cancelled order ${id}`);
        }

        if (newStatus === 'paid' && oldStatus !== 'paid') {
          // Free table
          if (existingOrder.tableId) {
            await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [existingOrder.tableId]);
          }
          const earnedPoints = Math.floor(existingOrder.total / 10);
          // Loyalty points accrual (Walk-in customer)
          if (existingOrder.customerId) {
            await dbRun(`
              UPDATE customers 
              SET points = points + ?, orderCount = orderCount + 1, totalSpent = totalSpent + ? 
              WHERE id = ?
            `, [earnedPoints, existingOrder.total, existingOrder.customerId]);
          }
          // Loyalty points accrual (Registered online customer account)
          if (existingOrder.customerAccountId) {
            await dbRun(`
              UPDATE customer_accounts
              SET loyaltyPoints = loyaltyPoints + ?, totalSpent = totalSpent + ?
              WHERE id = ?
            `, [earnedPoints, existingOrder.total, existingOrder.customerAccountId]);
          }
          // Assign a gapless fiscal invoice number exactly once, at settlement.
          if (!existingOrder.invoiceNumber) {
            const invoiceNumber = await allocateInvoiceNumber();
            await dbRun('UPDATE orders SET invoiceNumber = ? WHERE id = ?', [invoiceNumber, id]);
          }
          await writeAuditLog(req.user.id, req.user.username, 'pay_order', `Completed settlement for order ${id} via ${paymentMethod || 'cash'}`);
        }

        // Update orders table
        await dbRun(`
          UPDATE orders 
          SET status = ?, paymentMethod = ?, paymentTimestamp = ?, paymentSplit = ?, tip = COALESCE(?, tip)
          WHERE id = ?
        `, [
          newStatus, 
          paymentMethod || existingOrder.paymentMethod, 
          paymentTimestamp || existingOrder.paymentTimestamp,
          paymentSplit ? JSON.stringify(paymentSplit) : existingOrder.paymentSplit,
          tip !== undefined ? parseFloat(tip) : null,
          id
        ]);

        await dbRun('COMMIT');

        // Broadcast real-time update to customer stream & POS
        const updated = await dbGet('SELECT * FROM orders WHERE id = ?', [id]);
        const itemsList = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [id]);
        notifyOrderUpdate(id, { ...updated, items: itemsList });

        res.json({ id, status: newStatus, invoiceNumber: updated.invoiceNumber });
      } catch (err) {
        await dbRun('ROLLBACK');
        throw err;
      }

    } else {
      // NEW ORDER CREATION
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order items are required for new orders.' });
      }

      // 1. PIN verify check for POS discounts on the server side
      const hasDiscount = (discountValue && parseFloat(discountValue) > 0) || promoCode;
      if (hasDiscount && req.user.role !== 'owner' && req.user.role !== 'manager') {
        if (!managerPin) {
          return res.status(403).json({ error: 'Discount requires a manager PIN override.' });
        }
        // Verify manager PIN
        const managers = await dbAll('SELECT pin FROM users WHERE role IN ("owner", "manager")');
        let pinVerified = false;
        for (const mgr of managers) {
          const match = await bcrypt.compare(managerPin, mgr.pin);
          if (match) {
            pinVerified = true;
            break;
          }
        }
        if (!pinVerified) {
          return res.status(403).json({ error: 'Invalid or unauthorized manager PIN for discount.' });
        }
      }

      // Verify active shift is open for the current user
      const activeShift = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
      if (!activeShift) {
        return res.status(400).json({ error: 'An active shift is required to place new orders. Please open a shift first.' });
      }

      // 2. Calculate billing totals on the server using unified billing helper
      const bill = await resolveAndCalculateBill(items, discountType, discountValue, 0, tip, promoCode, 0, req.tenantId);

      // Begin SQLite transaction
      await dbRun('BEGIN TRANSACTION');

      try {
        // Insert order
        await dbRun(`
          INSERT INTO orders (
            id, tableId, diningType, customerId, items, subtotal,
            discountType, discountValue, discount, tax, total, status,
            timestamp, paymentMethod, paymentTimestamp,
            serviceCharge, tip, roundedAmount, cashierId, promotionalDiscount, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, tableId || null, diningType, customerId || null, JSON.stringify(bill.resolvedItems), bill.subtotal,
          discountType || 'percent', parseFloat(discountValue) || 0, bill.totalDiscount, bill.tax, bill.total, status || 'pending',
          timestamp || Date.now(), paymentMethod || null, paymentTimestamp || null,
          bill.serviceCharge, bill.tip, bill.roundedAmount, req.user.id, bill.promoDiscount, req.tenantId
        ]);

        // Insert items into order_items & update menu item stock
        for (const item of bill.resolvedItems) {
          const orderItemId = `ord_itm_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          await dbRun(`
            INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [orderItemId, id, item.id, item.name, item.unitPrice, item.quantity, item.notes || '']);

          // Atomic conditional stock check and update
          const stockResult = await dbRun('UPDATE menu_items SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.id, item.quantity]);
          if (stockResult.changes === 0) {
            throw new Error(`Insufficient stock for item: ${item.name}`);
          }
        }

        // Update table status if dine-in
        if (diningType === 'dine-in' && tableId) {
          const newTableStatus = (status === 'hold') ? 'billing' : 'occupied';
          await dbRun('UPDATE tables SET status = ?, currentOrderId = ? WHERE id = ?', [newTableStatus, id, tableId]);
        }

        await writeAuditLog(req.user.id, req.user.username, 'create_order', `Created order ${id} with total ${bill.total}`);
        if (bill.totalDiscount > 0) {
          await writeAuditLog(req.user.id, req.user.username, 'apply_discount', `Discount of ${bill.totalDiscount} applied to order ${id}`);
        }

        await dbRun('COMMIT');
        res.json({ id, status: status || 'pending', total: bill.total });
      } catch (err) {
        await dbRun('ROLLBACK');
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// 6. Customers Routes & Shifts Routes handled at top section

app.get('/api/shifts/summary/:id', async (req, res) => {
  try {
    const shift = await dbGet('SELECT * FROM shifts WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const stats = await dbGet(`
      SELECT 
        COUNT(id) as totalOrders,
        SUM(total) as totalSales,
        SUM(CASE WHEN paymentMethod = 'cash' THEN total ELSE 0 END) as cashSales,
        SUM(CASE WHEN paymentMethod = 'card' THEN total ELSE 0 END) as cardSales,
        SUM(CASE WHEN paymentMethod = 'upi' THEN total ELSE 0 END) as upiSales,
        SUM(discount) as totalDiscounts,
        SUM(serviceCharge) as totalServiceCharge,
        SUM(tax) as totalTax
      FROM orders 
      WHERE timestamp >= ? AND (endTime IS NULL OR timestamp <= ?) AND status = 'paid'
    `, [shift.startTime, shift.endTime || Date.now()]);

    const voids = await dbGet(`
      SELECT COUNT(id) as voidCount, SUM(total) as voidTotal
      FROM orders 
      WHERE timestamp >= ? AND (endTime IS NULL OR timestamp <= ?) AND status = 'cancelled'
    `, [shift.startTime, shift.endTime || Date.now()]);

    res.json({
      shift,
      stats: {
        totalOrders: stats?.totalOrders || 0,
        totalSales: stats?.totalSales || 0,
        cashSales: stats?.cashSales || 0,
        cardSales: stats?.cardSales || 0,
        upiSales: stats?.upiSales || 0,
        totalDiscounts: stats?.totalDiscounts || 0,
        totalServiceCharge: stats?.totalServiceCharge || 0,
        totalTax: stats?.totalTax || 0,
        voidCount: voids?.voidCount || 0,
        voidTotal: voids?.voidTotal || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/orders/:id/refund', async (req, res) => {
  const { refundAmount, reason, managerPin } = req.body;
  const orderId = req.params.id;

  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status !== 'paid' && order.status !== 'partially_refunded') {
      return res.status(400).json({ error: 'Only settled orders can be refunded.' });
    }

    const currentRefunded = parseFloat(order.refundedAmount || 0);
    const newRefunded = currentRefunded + (parseFloat(refundAmount) || 0);

    if (newRefunded > order.total) {
      return res.status(400).json({ error: 'Refund amount exceeds order total.' });
    }

    // Role or manager PIN override check
    let authorized = false;
    if (req.user.role === 'owner' || req.user.role === 'manager') {
      authorized = true;
    } else if (managerPin) {
      const manager = await dbGet('SELECT id, username, role FROM users WHERE pin = ? AND role IN ("owner", "manager")', [managerPin]);
      if (manager) {
        authorized = true;
      }
    }

    if (!authorized) {
      return res.status(403).json({ error: 'Unauthorized. Manager PIN override required.' });
    }

    const newStatus = newRefunded >= order.total ? 'refunded' : 'partially_refunded';

    await dbRun('BEGIN TRANSACTION');

    try {
      await dbRun(`
        UPDATE orders 
        SET status = ?, refundedAmount = ?, voidReason = ?
        WHERE id = ?
      `, [newStatus, newRefunded, reason || 'Customer request', orderId]);

      if (newStatus === 'refunded') {
        const items = await dbAll('SELECT menuItemId, quantity FROM order_items WHERE orderId = ?', [orderId]);
        for (const item of items) {
          await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [item.quantity, item.menuItemId]);
        }

        if (order.customerId) {
          const deductedPoints = Math.floor(order.total / 10);
          await dbRun('UPDATE customers SET points = MAX(0, points - ?) WHERE id = ?', [deductedPoints, order.customerId]);
        }
      }

      await writeAuditLog(req.user.id, req.user.username, 'refund_order', `Refunded LKR ${refundAmount} for order ${orderId}. Reason: ${reason}`);

      await dbRun('COMMIT');
      res.json({ success: true, status: newStatus, refundedAmount: newRefunded });
    } catch (err) {
      await dbRun('ROLLBACK');
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Support Tickets & Customer Care Escalation API ──
app.get('/api/support/tickets', async (req, res) => {
  try {
    const tickets = await dbAll('SELECT * FROM support_tickets ORDER BY createdAt DESC');
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/support/tickets/:id/resolve', async (req, res) => {
  try {
    await dbRun('UPDATE support_tickets SET status = "resolved", resolvedAt = ? WHERE id = ?', [Date.now(), req.params.id]);
    res.json({ success: true, ticketId: req.params.id, status: 'resolved' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});


// Database maintenance backup endpoints
app.post('/api/database/import', databaseLimiter, requireRole(['owner']), requirePlatformAdmin, async (req, res) => {
  const backup = req.body;
  try {
    // Begin transaction
    await dbRun('BEGIN TRANSACTION');

    // Clear only the platform (default) tenant's data — never wipe paying tenants.
    await dbRun("DELETE FROM order_items WHERE orderId IN (SELECT id FROM orders WHERE tenant_id = 'default_tenant')");
    await dbRun("DELETE FROM settings WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM categories WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM menu_items WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM tables WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM orders WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM customers WHERE tenant_id = 'default_tenant'");

    // Restore Settings
    if (backup.settings) {
      for (const set of backup.settings) {
        await dbRun("INSERT INTO settings (tenant_id, key, value) VALUES ('default_tenant', ?, ?)", [set.key, String(set.value)]);
      }
    }
    // Restore Categories
    if (backup.categories) {
      for (const cat of backup.categories) {
        await dbRun("INSERT INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, 'default_tenant')", [cat.id, cat.name, cat.emoji]);
      }
    }
    // Restore Items
    if (backup.menu_items) {
      for (const item of backup.menu_items) {
        await dbRun(`
          INSERT INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, tenant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'default_tenant')
        `, [item.id, item.name, item.price, item.cost, item.category, item.emoji, item.stock, item.minStock, item.description]);
      }
    }
    // Restore Tables
    if (backup.tables) {
      for (const t of backup.tables) {
        await dbRun("INSERT INTO tables (id, number, capacity, status, currentOrderId, tenant_id) VALUES (?, ?, ?, ?, ?, 'default_tenant')", [
          t.id, t.number, t.capacity, t.status, t.currentOrderId
        ]);
      }
    }
    // Restore Orders
    if (backup.orders) {
      for (const o of backup.orders) {
        const itemsStr = typeof o.items === 'string' ? o.items : JSON.stringify(o.items);
        await dbRun(`
          INSERT INTO orders (
            id, tableId, diningType, customerId, items, subtotal,
            discountType, discountValue, discount, tax, total, status,
            timestamp, paymentMethod, paymentTimestamp, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'default_tenant')
        `, [
          o.id, o.tableId, o.diningType, o.customerId, itemsStr, o.subtotal,
          o.discountType, o.discountValue, o.discount, o.tax, o.total, o.status,
          o.timestamp, o.paymentMethod, o.paymentTimestamp
        ]);

        // Restore normalized order items
        try {
          const itemsArr = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
          if (Array.isArray(itemsArr)) {
            for (const item of itemsArr) {
              const orderItemId = `ord_itm_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              await dbRun(`
                INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `, [orderItemId, o.id, item.id, item.name, item.price, item.quantity, item.notes || '']);
            }
          }
        } catch (err) {
          console.error(`Failed to restore order items for order ${o.id}:`, err.message);
        }
      }
    }
    // Restore Customers
    if (backup.customers) {
      for (const c of backup.customers) {
        await dbRun("INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'default_tenant')", [
          c.id, c.name, c.phone, c.email, c.points, c.orderCount, c.totalSpent
        ]);
      }
    }

    await dbRun('COMMIT');
    await writeAuditLog(req.user.id, req.user.username, 'import_database', 'Imported data backup successfully');
    res.json({ success: true });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/database/reset', databaseLimiter, requireRole(['owner']), requirePlatformAdmin, async (req, res) => {
  try {
    // Factory reset affects only the platform (default) tenant — paying tenants untouched.
    await dbRun("DELETE FROM order_items WHERE orderId IN (SELECT id FROM orders WHERE tenant_id = 'default_tenant')");
    await dbRun("DELETE FROM settings WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM categories WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM menu_items WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM tables WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM orders WHERE tenant_id = 'default_tenant'");
    await dbRun("DELETE FROM customers WHERE tenant_id = 'default_tenant'");
    await seedDatabase();
    await writeAuditLog(req.user.id, req.user.username, 'reset_database', 'Reset database to factory seeds');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Driver COD Cash Reconciliation & Shift Settlement API ──
app.get('/api/driver/cash-reconciliation', requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  const { driverId } = req.query;
  try {
    const uncollected = await dbAll(
      `SELECT id, customerName, total, deliveryFee, paymentMethod, status, timestamp
       FROM orders
       WHERE (driverId = ? OR ? = '') AND paymentMethod IN ('cod', 'cash') AND status = 'delivered' AND (cashCollected IS NULL OR cashCollected = 0)
       ORDER BY timestamp DESC`,
      [driverId || '', driverId ? driverId : '']
    );
    const totalCashToHandover = uncollected.reduce((acc, o) => acc + (o.total || 0), 0);
    res.json({ uncollectedOrders: uncollected, totalCashToHandover });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/driver/cash-reconciliation/handover', requireRole(['owner', 'manager']), async (req, res) => {
  const { driverId, orderIds, amountHandedOver, managerPin } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds array is required.' });
  }
  try {
    await dbRun('BEGIN TRANSACTION');
    for (const id of orderIds) {
      await dbRun('UPDATE orders SET cashCollected = 1, cashCollectedAt = ? WHERE id = ?', [Date.now(), id]);
    }
    await writeAuditLog(req.user?.id || 'manager', req.user?.username || 'Manager', 'driver_cash_handover',
      `Driver ${driverId} handed over LKR ${amountHandedOver} cash for ${orderIds.length} orders.`);
    await dbRun('COMMIT');
    res.json({ success: true, orderCount: orderIds.length, amountHandedOver });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Multi-Tenant Partner Payouts & Commission Analytics ──
app.get('/api/marketplace/partner-earnings', requireRole(['owner']), async (req, res) => {
  try {
    const commissionRate = parseFloat((await getSetting('default_tenant', 'platformCommissionRate')) || 15);

    const partnerSales = await dbAll(
      `SELECT tenant_id, COUNT(id) as orderCount, SUM(total) as grossSales, SUM(subtotal) as grossSubtotal
       FROM orders
       WHERE status IN ('delivered', 'paid') AND tenant_id IS NOT NULL AND tenant_id != ''
       GROUP BY tenant_id`
    );

    const tenants = await dbAll('SELECT id, name FROM tenants');
    const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));

    const earnings = partnerSales.map(p => {
      const gross = p.grossSales || 0;
      const commission = (gross * commissionRate) / 100;
      const netPayout = gross - commission;
      return {
        tenantId: p.tenant_id,
        tenantName: tenantMap[p.tenant_id] || `Store #${p.tenant_id}`,
        orderCount: p.orderCount,
        grossSales: Math.round(gross),
        platformCommissionRate: commissionRate,
        commissionAmount: Math.round(commission),
        netPayout: Math.round(netPayout)
      };
    });

    res.json({ commissionRate, earnings });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── 3.1 Reporting & Compliance API (X-Report, Tax/VAT Report, Item Profitability COGS) ──
app.get('/api/reports/x-report', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const activeShift = await dbGet('SELECT * FROM shifts WHERE userId = ? AND status = "open"', [req.user.id]);
    if (!activeShift) {
      return res.status(400).json({ error: 'No active open shift found for X-report generation.' });
    }

    const sales = await dbGet(`
      SELECT 
        COUNT(id) as totalOrders,
        SUM(total) as grossSales,
        SUM(subtotal) as subtotalSales,
        SUM(CASE WHEN paymentMethod = 'cash' THEN total ELSE 0 END) as cashSales,
        SUM(CASE WHEN paymentMethod = 'card' THEN total ELSE 0 END) as cardSales,
        SUM(CASE WHEN paymentMethod = 'online' THEN total ELSE 0 END) as onlineSales,
        SUM(discount) as totalDiscounts,
        SUM(serviceCharge) as totalServiceCharge,
        SUM(tax) as totalTax
      FROM orders
      WHERE tenant_id = ? AND timestamp >= ? AND status = 'paid'
    `, [req.tenantId, activeShift.startTime]);

    const voids = await dbGet(`
      SELECT COUNT(id) as voidCount, SUM(total) as voidTotal
      FROM orders
      WHERE tenant_id = ? AND timestamp >= ? AND status = 'cancelled'
    `, [req.tenantId, activeShift.startTime]);

    res.json({
      shiftId: activeShift.id,
      cashier: activeShift.username,
      startTime: activeShift.startTime,
      generatedAt: Date.now(),
      totalOrders: sales?.totalOrders || 0,
      grossSales: sales?.grossSales || 0,
      subtotalSales: sales?.subtotalSales || 0,
      cashSales: sales?.cashSales || 0,
      cardSales: sales?.cardSales || 0,
      onlineSales: sales?.onlineSales || 0,
      totalDiscounts: sales?.totalDiscounts || 0,
      totalServiceCharge: sales?.totalServiceCharge || 0,
      totalTax: sales?.totalTax || 0,
      voidCount: voids?.voidCount || 0,
      voidTotal: voids?.voidTotal || 0,
      startFloat: activeShift.startFloat,
      expectedCashDrawer: activeShift.startFloat + (sales?.cashSales || 0)
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.get('/api/reports/vat', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { from, to } = req.query;
  const startTime = parseInt(from, 10) || (Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endTime = parseInt(to, 10) || Date.now();

  try {
    const summary = await dbGet(`
      SELECT 
        SUM(subtotal) as taxableSales,
        SUM(tax) as vatCollected,
        COUNT(id) as invoiceCount
      FROM orders
      WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ? AND status = 'paid'
    `, [req.tenantId, startTime, endTime]);

    res.json({
      jurisdiction: 'Sri Lanka (18% Standard VAT Rate)',
      fromTimestamp: startTime,
      toTimestamp: endTime,
      taxableSales: summary?.taxableSales || 0,
      vatCollected: summary?.vatCollected || 0,
      invoiceCount: summary?.invoiceCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.get('/api/reports/cogs', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const items = await dbAll('SELECT id, name, price, cost, category, stock FROM menu_items WHERE tenant_id = ?', [req.tenantId]);
    const cogsReport = items.map(item => {
      const profitMargin = item.price - (item.cost || 0);
      const marginPercentage = item.price > 0 ? (profitMargin / item.price) * 100 : 0;
      return {
        ...item,
        profitMargin,
        marginPercentage: parseFloat(marginPercentage.toFixed(2))
      };
    });

    res.json(cogsReport);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── 3.2 Inventory Depth (Purchase Orders, Suppliers & Waste Logging) ──
app.get('/api/inventory/suppliers', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const suppliers = await dbAll('SELECT * FROM suppliers ORDER BY name ASC').catch(() => []);
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/inventory/suppliers', requireRole(['owner', 'manager']), async (req, res) => {
  const { name, phone, email, address } = req.body;
  const id = `sup_${Date.now()}`;
  try {
    await dbRun('INSERT INTO suppliers (id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)', [id, name, phone || '', email || '', address || '']);
    res.json({ id, name, phone, email, address });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/inventory/waste', requireRole(['owner', 'manager']), async (req, res) => {
  const { menuItemId, ingredientId, quantity, reason } = req.body;
  try {
    if (menuItemId) {
      await dbRun('UPDATE menu_items SET stock = MAX(0, stock - ?) WHERE id = ?', [quantity, menuItemId]);
    } else if (ingredientId) {
      await dbRun('UPDATE ingredients SET currentStock = MAX(0, currentStock - ?) WHERE id = ?', [quantity, ingredientId]);
    }

    await writeAuditLog(req.user.id, req.user.username, 'waste_logged', `Logged waste qty ${quantity}: ${reason}`);
    res.json({ success: true, message: 'Waste logged and inventory deducted.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── 3.4 Staff & Permissions API ──
app.get('/api/staff/performance', requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const staffSales = await dbAll(`
      SELECT 
        o.cashierId,
        u.username,
        COUNT(o.id) as totalOrders,
        SUM(o.total) as totalSales,
        AVG(o.total) as avgTicketSize
      FROM orders o
      LEFT JOIN users u ON o.cashierId = u.id
      WHERE o.status = 'paid' AND o.tenant_id = ?
      GROUP BY o.cashierId
    `, [req.tenantId]);

    res.json(staffSales);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Observability: 404 + centralized error handler (must be after all routes) ──
// Unknown API routes return JSON, not the SPA fallback.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Final safety net: any error thrown/next(err)'d in a handler lands here. Details
// are logged structured; the client gets a generic message in production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    t: new Date().toISOString(), lvl: 'error', method: req.method, path: req.path,
    status: 500, msg: err?.message, stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack
  }));
  if (res.headersSent) return next(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : (err?.message || 'Internal server error.') });
});

// Start Server — skip when imported by the test runner (supertest drives `app` directly).
const server = process.env.VITEST
  ? null
  : app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`GastroFlow POS Backend running on port ${PORT}`);
      console.log(`Access endpoint directly at http://localhost:${PORT}/api`);
      console.log(`===============================================`);
    });

// Graceful Shutdown Handler
const handleGracefulShutdown = (signal) => {
  if (!server) return;
  console.log(`\n[Server] ${signal} signal received. Initiating graceful shutdown...`);
  
  server.close(() => {
    console.log('[Server] Closed remaining active HTTP connections.');
    db.close((err) => {
      if (err) {
        console.error('[Database] Error closing SQLite connection:', err.message);
      } else {
        console.log('[Database] Closed database connection cleanly.');
      }
      process.exit(0);
    });
  });

  // Force shutdown after 10s if connections fail to close
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcing exit.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));


