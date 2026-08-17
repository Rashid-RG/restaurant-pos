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
import { query, execute, isPostgres } from './lib/db_adapter.js';
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

// ── Security: Fail-fast for missing or insecure secrets ─────────────────────
// BUG-002 fix: every known insecure default is listed here so they are
// rejected in production AND recognised in the INSECURE check below.
const INSECURE_JWT_DEFAULTS = [
  'super_secret_restaurant_pos_key_2026',
  'gastroflow_prod_secret_998877_key_2026',
  'super_secret_jwt_key_replace_in_production_2026',
  'gastroflow_dev_only_secret_change_me'
];
const INSECURE_PAYHERE_DEFAULTS = ['mock_merchant_secret', '4a8b9c10d2e3f4'];
if (process.env.NODE_ENV === 'production') {
  console.log('[Production] Booting GastroFlow Backend in production mode...');
  if (!process.env.JWT_SECRET || INSECURE_JWT_DEFAULTS.includes(process.env.JWT_SECRET.trim())) {
    throw new Error('JWT_SECRET is missing or uses a known-insecure default. Refusing to start production server.');
  } else {
    console.log('[Production Success] JWT_SECRET loaded successfully from Environment Variables.');
  }
  if (!process.env.PAYHERE_MERCHANT_SECRET || INSECURE_PAYHERE_DEFAULTS.includes(process.env.PAYHERE_MERCHANT_SECRET.trim())) {
    throw new Error('PAYHERE_MERCHANT_SECRET is missing or insecure. Refusing to start production server.');
  }
  // BUG-013: Enforce strong admin password in production
  const adminPwd = process.env.ADMIN_PASSWORD || '';
  const WEAK_ADMIN_PASSWORDS = ['admin123', 'admin', '123456', 'password', 'admin@123', ''];
  if (WEAK_ADMIN_PASSWORDS.includes(adminPwd.trim())) {
    throw new Error('ADMIN_PASSWORD is missing or too weak. Refusing to start production server.');
  }
}

// JWT secret — dev fallback uses a clearly non-production value; production is hard-gated above.
// NEVER use these fallback values in production — the auto-generator above will override them.
const JWT_SECRET = process.env.JWT_SECRET || 'gastroflow_dev_only_secret_DO_NOT_USE_IN_PRODUCTION';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust reverse proxy on Render / Cloudflare for rate-limiting
export { app };
const PORT = process.env.PORT || 5000;

// Error-response helper: never leak internal/DB error detail to clients in production.
// Full detail is still logged server-side; the client gets a generic message in prod
// and the real message only in development for debugging.
const errMsg = (err) => {
  try { console.error('[API error]', err && err.stack ? err.stack : err); } catch (_) {}
  if (!err) return 'An unexpected error occurred. Please try again.';
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  // Keep clean operational messages (e.g. invalid phone, address, stock, delivery distance)
  const isRawDbCrash = /SQLITE_ERROR|syntax error|relation ".*" does not exist|column ".*" does not exist|connect ECONNREFUSED/i.test(msg);
  if (process.env.NODE_ENV === 'production' && isRawDbCrash) {
    return 'An unexpected database error occurred. Please try again.';
  }
  return msg;
};

// BUG-010 fix: Enable a practical Content-Security-Policy.
// Inline scripts are used by the Vite-built SPA bundles, so we allow 'unsafe-inline'
// for scripts/styles in dev. In production, use nonces or move to external bundles.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.payhere.lk'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://checkout.payhere.lk', 'https://generativelanguage.googleapis.com', 'https://app.notify.lk'],
      frameSrc: ["'self'", 'https://checkout.payhere.lk'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false // Allow embedded maps and payment iframes
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

// Strong Password Generator Helper for SaaS Tenant Provisioning & Staff Accounts
function generateStrongPassword(length = 10) {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const syms = '!@#$%&*';

  let pwd = [
    uppers[crypto.randomInt(uppers.length)],
    lowers[crypto.randomInt(lowers.length)],
    nums[crypto.randomInt(nums.length)],
    syms[crypto.randomInt(syms.length)]
  ];

  const allChars = uppers + lowers + nums + syms;
  for (let i = 4; i < length; i++) {
    pwd.push(allChars[crypto.randomInt(allChars.length)]);
  }

  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join('');
}

function generateSecurePin(length = 6) {
  let pin = '';
  for (let i = 0; i < length; i++) pin += crypto.randomInt(10).toString();
  return pin;
}

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
        ms: Date.now() - start,
        tenant: req.tenantId || req.driver?.tenant_id || undefined
      };
      console.log(JSON.stringify(entry));
    });
    next();
  });
}

const SYSTEM_BUILD_TIMESTAMP = Date.now();
const SYSTEM_VERSION = '1.3.0';

// GET /api/system/version — Public endpoint for PWA/client instant update detection
// BUG-012 fix: do not expose environment name to unauthenticated callers
app.get('/api/system/version', (req, res) => {
  const payload = { version: SYSTEM_VERSION, buildTimestamp: SYSTEM_BUILD_TIMESTAMP };
  // Only reveal runtime environment to authenticated staff (non-public info)
  if (req.headers.authorization) payload.environment = process.env.NODE_ENV || 'development';
  res.json(payload);
});


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

// Helper functions for promise-based database calls (SQLite & Postgres / Neon DB)
export const dbRun = async (sql, params = []) => {
  if (isPostgres) {
    if (/^\s*PRAGMA/i.test(sql)) return;
    let pgSql = sql;
    if (/CREATE TABLE/i.test(pgSql)) {
      pgSql = pgSql.replace(/\bINTEGER\b/gi, 'BIGINT');
    }
    if (/INSERT OR IGNORE INTO/i.test(pgSql)) {
      pgSql = pgSql.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
      if (!/ON CONFLICT/i.test(pgSql)) {
        pgSql += ' ON CONFLICT DO NOTHING';
      }
    } else if (/INSERT OR REPLACE INTO/i.test(pgSql)) {
      pgSql = pgSql.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
    }
    pgSql = pgSql.replace(/\bMAX\s*\(\s*([^,\)]+)\s*,/gi, 'GREATEST($1,');
    return execute(pgSql, params);
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const normalizeRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const newRow = { ...row };
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase();
    if (lk === 'passwordhash' && newRow.passwordHash === undefined) newRow.passwordHash = row[k];
    if (lk === 'totalspent' && newRow.totalSpent === undefined) newRow.totalSpent = row[k];
    if (lk === 'ordercount' && newRow.orderCount === undefined) newRow.orderCount = row[k];
    if (lk === 'phoneverified' && newRow.phoneVerified === undefined) newRow.phoneVerified = row[k];
    if (lk === 'createdat' && newRow.createdAt === undefined) newRow.createdAt = row[k];
    if (lk === 'loyaltypoints' && newRow.loyaltyPoints === undefined) newRow.loyaltyPoints = row[k];
    if (lk === 'customername' && newRow.customerName === undefined) newRow.customerName = row[k];
    if (lk === 'customerphone' && newRow.customerPhone === undefined) newRow.customerPhone = row[k];
    if (lk === 'customeremail' && newRow.customerEmail === undefined) newRow.customerEmail = row[k];
  }
  return newRow;
};

export const dbAll = async (sql, params = []) => {
  if (isPostgres) {
    const res = await query(sql, params);
    const rows = res.rows || [];
    return rows.map(normalizeRow);
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const dbGet = async (sql, params = []) => {
  if (isPostgres) {
    const res = await query(sql, params);
    const row = res.rows && res.rows.length > 0 ? res.rows[0] : null;
    return row ? normalizeRow(row) : null;
  }
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

// BUG-023 fix: require valid JWT (staff or customer) to subscribe to SSE events.
// Without auth, anonymous clients could monitor all real-time order activity.
app.get('/api/events', (req, res) => {
  // Validate token from Authorization header or ?token= query param (EventSource doesn't support custom headers)
  const rawToken = (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.query.token;
  if (!rawToken) {
    return res.status(401).json({ error: 'Authentication required for event stream.' });
  }
  try {
    jwt.verify(rawToken, process.env.JWT_SECRET || JWT_SECRET);
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token for event stream.' });
  }

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
    // 0. Pre-flight Postgres Column Migrations (runs FIRST before any INSERT)
    if (isPostgres) {
      const timestampCols = [
        ['tenants', 'createdAt'],
        ['tenants', 'createdat'],
        ['otps', 'expiresAt'],
        ['otps', 'expiresat'],
        ['otp_codes', 'expiresAt'],
        ['otp_codes', 'expiresat'],
        ['otp_codes', 'createdAt'],
        ['otp_codes', 'createdat'],
        ['password_resets', 'expiresAt'],
        ['password_resets', 'expiresat'],
        ['password_resets', 'createdAt'],
        ['password_resets', 'createdat'],
        ['password_resets', 'consumedAt'],
        ['password_resets', 'consumedat'],
        ['timeclock_entries', 'clockIn'],
        ['timeclock_entries', 'clockin'],
        ['timeclock_entries', 'clockOut'],
        ['timeclock_entries', 'clockout'],
        ['support_tickets', 'createdAt'],
        ['support_tickets', 'createdat'],
        ['support_tickets', 'resolvedAt'],
        ['support_tickets', 'resolvedat'],
        ['support_ticket_messages', 'createdAt'],
        ['support_ticket_messages', 'createdat'],
        ['customer_accounts', 'createdAt'],
        ['customer_accounts', 'createdat'],
        ['customer_addresses', 'createdAt'],
        ['customer_addresses', 'createdat'],
        ['customer_cards', 'createdAt'],
        ['customer_cards', 'createdat'],
        ['orders', 'createdAt'],
        ['orders', 'createdat'],
        ['orders', 'scheduledTime'],
        ['orders', 'scheduledtime'],
        ['orders', 'timestamp'],
        ['orders', 'paymentTimestamp'],
        ['orders', 'paymenttimestamp'],
        ['orders', 'acceptedAt'],
        ['orders', 'acceptedat'],
        ['shifts', 'startTime'],
        ['shifts', 'starttime'],
        ['shifts', 'endTime'],
        ['shifts', 'endtime'],
        ['audit_logs', 'timestamp'],
        ['cash_movements', 'timestamp'],
        ['driver_customer_chats', 'createdAt'],
        ['driver_customer_chats', 'createdat']
      ];
      for (const [t, c] of timestampCols) {
        try {
          const colCheck = await dbGet(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND LOWER(column_name) = LOWER(?)`,
            [t, c]
          );
          if (colCheck && colCheck.data_type && colCheck.data_type.toLowerCase() !== 'bigint') {
            const actualCol = colCheck.column_name;
            await dbRun(`ALTER TABLE ${t} ALTER COLUMN "${actualCol}" TYPE BIGINT USING "${actualCol}"::BIGINT`);
            console.log(`[Pre-Flight Migration] Altered ${t}.${actualCol} from ${colCheck.data_type} to BIGINT in Postgres.`);
          }
        } catch (_) {}
      }
    }

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
        timestamp BIGINT,
        paymentMethod TEXT,
        paymentTimestamp BIGINT
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
        expiresAt BIGINT NOT NULL,
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
        timestamp BIGINT,
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
        startTime BIGINT,
        endTime BIGINT,
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
        timestamp BIGINT NOT NULL
      )
    `);

    // 10c. Multi-Branch Stock Transfers Table (Central Kitchen -> Branch Outlets)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id TEXT PRIMARY KEY,
        sourceOutlet TEXT NOT NULL,
        destinationOutlet TEXT NOT NULL,
        ingredientId TEXT NOT NULL,
        ingredientName TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'kg',
        status TEXT DEFAULT 'pending',
        requestedBy TEXT,
        approvedBy TEXT,
        timestamp INTEGER NOT NULL,
        tenant_id TEXT DEFAULT 'default_tenant'
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

    // 22. Customer Accounts Table (Online food app registered users)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS customer_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        loyaltyPoints INTEGER DEFAULT 0,
        totalSpent REAL DEFAULT 0,
        phoneVerified INTEGER DEFAULT 0,
        createdAt BIGINT,
        tenant_id TEXT DEFAULT 'default_tenant'
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
        createdAt BIGINT
      )
    `);
    try {
      await dbRun(
        `INSERT INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        ['default_tenant', 'GastroFlow Bistro Main', 'main', 'admin@gastroflow.lk', 'pro', 'active', Date.now()]
      );
    } catch (_) {}

    // 24. Support Tickets Table (Customer care escalation)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        orderId TEXT,
        customerName TEXT,
        customerPhone TEXT,
        customerEmail TEXT,
        issueCategory TEXT DEFAULT 'general',
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',         -- 'open' | 'in_progress' | 'resolved'
        createdAt BIGINT NOT NULL,
        resolvedAt BIGINT
      )
    `);

    // 25. Support Ticket Messages Table (Chat thread history)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS support_ticket_messages (
        id TEXT PRIMARY KEY,
        ticketId TEXT NOT NULL,
        senderType TEXT NOT NULL,           -- 'customer' | 'staff' | 'ai'
        senderName TEXT,
        message TEXT NOT NULL,
        createdAt BIGINT NOT NULL,
        FOREIGN KEY(ticketId) REFERENCES support_tickets(id) ON DELETE CASCADE
      )
    `);

    // 26. Driver-Customer In-App Chat Table (Uber Eats-grade live delivery chat)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS driver_customer_chats (
        id TEXT PRIMARY KEY,
        orderId TEXT NOT NULL,
        senderType TEXT NOT NULL,           -- 'customer' | 'driver'
        senderName TEXT,
        message TEXT NOT NULL,
        createdAt BIGINT NOT NULL,
        FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);

    // 27. Tenants Table (Multi-tenant store registry)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subdomain TEXT UNIQUE NOT NULL,
        ownerEmail TEXT,
        plan TEXT DEFAULT 'pro',
        status TEXT DEFAULT 'active',
        staffUsername TEXT,
        temporaryPassword TEXT,
        createdAt INTEGER
      )
    `);

    await dbRun(
      "INSERT OR IGNORE INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt) VALUES ('default_tenant', 'GastroFlow Main Store', 'main', 'owner@gastroflow.lk', 'enterprise', 'active', 1700000000000)"
    ).catch(() => {});

    // Purge removed legacy store twinbbq from tenants and users tables
    await dbRun("DELETE FROM tenants WHERE LOWER(id) LIKE '%twinbbq%' OR LOWER(subdomain) LIKE '%twinbbq%' OR LOWER(name) LIKE '%twinbbq%'").catch(() => {});
    await dbRun("DELETE FROM users WHERE LOWER(tenant_id) LIKE '%twinbbq%' OR LOWER(username) LIKE '%twinbbq%'").catch(() => {});


    // Failsafe helper to add a missing column on both SQLite & Postgres

    const safeAddColumn = async (table, column, typeDef) => {
      try {
        let hasCol = false;
        if (isPostgres) {
          const row = await dbGet(
            `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND LOWER(column_name) = LOWER(?)`,
            [table, column]
          );
          hasCol = Boolean(row);
        } else {
          const cols = await dbAll(`PRAGMA table_info(${table})`);
          hasCol = Array.isArray(cols) && cols.some(c => c.name.toLowerCase() === column.toLowerCase());
        }
        if (!hasCol) {
          await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
          console.log(`[Schema Migration] Added column ${column} to ${table}`);
        }
      } catch (err) {
        console.error(`[Schema Migration Warning] Failed to add ${column} to ${table}:`, err.message);
      }
    };

    if (isPostgres) {
      const timestampCols = [
        ['otps', 'expiresAt'],
        ['otps', 'expiresat'],
        ['otp_codes', 'expiresAt'],
        ['otp_codes', 'expiresat'],
        ['otp_codes', 'createdAt'],
        ['otp_codes', 'createdat'],
        ['password_resets', 'expiresAt'],
        ['password_resets', 'expiresat'],
        ['password_resets', 'createdAt'],
        ['password_resets', 'createdat'],
        ['password_resets', 'consumedAt'],
        ['password_resets', 'consumedat'],
        ['tenants', 'createdAt'],
        ['tenants', 'createdat'],
        ['timeclock_entries', 'clockIn'],
        ['timeclock_entries', 'clockin'],
        ['timeclock_entries', 'clockOut'],
        ['timeclock_entries', 'clockout'],
        ['support_tickets', 'createdAt'],
        ['support_tickets', 'createdat'],
        ['support_tickets', 'resolvedAt'],
        ['support_tickets', 'resolvedat'],
        ['support_ticket_messages', 'createdAt'],
        ['support_ticket_messages', 'createdat'],
        ['customer_accounts', 'createdAt'],
        ['customer_accounts', 'createdat'],
        ['customer_addresses', 'createdAt'],
        ['customer_addresses', 'createdat'],
        ['customer_cards', 'createdAt'],
        ['customer_cards', 'createdat'],
        ['orders', 'createdAt'],
        ['orders', 'createdat'],
        ['shifts', 'startTime'],
        ['shifts', 'starttime'],
        ['shifts', 'endTime'],
        ['shifts', 'endtime']
      ];
      for (const [t, c] of timestampCols) {
        try {
          const colCheck = await dbGet(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND LOWER(column_name) = LOWER(?)`,
            [t, c]
          );
          if (colCheck && colCheck.data_type && colCheck.data_type.toLowerCase() === 'integer') {
            const actualCol = colCheck.column_name;
            await dbRun(`ALTER TABLE ${t} ALTER COLUMN "${actualCol}" TYPE BIGINT USING "${actualCol}"::BIGINT`);
            console.log(`[Schema Migration] Converted ${t}.${actualCol} to BIGINT in Postgres.`);
          }
        } catch (err) {
          console.error(`[Schema Migration Warning] BIGINT conversion for ${t}.${c}:`, err.message);
        }
      }
    }

    // Add tenant_id column to tenant-scoped tables for multi-tenant isolation.
    const tenantTables = [
      'users', 'orders', 'menu_items', 'tables', 'ingredients', 'customers',
      'categories', 'modifiers', 'recipes', 'shifts', 'cash_movements',
      'feedbacks', 'promotions', 'customer_accounts', 'drivers'
    ];
    for (const tTable of tenantTables) {
      await safeAddColumn(tTable, 'tenant_id', "TEXT DEFAULT 'default_tenant'");
    }

    // Migrate legacy single-tenant `settings` table (PK = key) to the per-tenant composite-PK schema.
    try {
      let hasTenantCol = false;
      if (isPostgres) {
        const check = await dbGet(`SELECT column_name FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'tenant_id'`);
        hasTenantCol = Boolean(check);
      } else {
        const settingsCols = await dbAll(`PRAGMA table_info(settings)`);
        hasTenantCol = Array.isArray(settingsCols) && settingsCols.some(c => c.name === 'tenant_id');
      }
      if (!hasTenantCol) {
        await dbRun(`CREATE TABLE IF NOT EXISTS settings_new (
          tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (tenant_id, key)
        )`);
        await dbRun(`INSERT INTO settings_new (tenant_id, key, value) SELECT 'default_tenant', key, value FROM settings ON CONFLICT DO NOTHING`);
        await dbRun(`DROP TABLE settings`);
        await dbRun(`ALTER TABLE settings_new RENAME TO settings`);
        console.log("Migrated 'settings' table to per-tenant composite PK.");
      }
    } catch (err) {
      console.error('Settings tenant migration failed:', err.message);
    }

    // Give staff users an email + phone so password reset can reach them.
    for (const col of [{ name: 'email', type: 'TEXT' }, { name: 'phone', type: 'TEXT' }]) {
      await safeAddColumn('users', col.name, col.type);
    }

    // Driver auth columns: password hash + email so drivers can log in (Phase 2).
    for (const col of [{ name: 'passwordHash', type: 'TEXT' }, { name: 'email', type: 'TEXT' }]) {
      await safeAddColumn('drivers', col.name, col.type);
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
      await safeAddColumn('orders', col.name, col.type);
    }

    // Dynamic schema migrations for advanced menu_items table columns
    const menuColumnsToMigrate = [
      { name: 'imageUrl', type: 'TEXT' },
      { name: 'dietaryTags', type: 'TEXT' },
      { name: 'isAvailable', type: 'INTEGER DEFAULT 1' },
      { name: 'allergens', type: 'TEXT' },
      { name: 'spiceLevel', type: 'INTEGER DEFAULT 0' },
      { name: 'isHalal', type: 'INTEGER DEFAULT 0' },
      { name: 'preparationTime', type: 'INTEGER DEFAULT 0' },
      { name: 'portionSize', type: 'TEXT' }
    ];

    for (const col of menuColumnsToMigrate) {
      await safeAddColumn('menu_items', col.name, col.type);
    }

    // Enforce tenant_id across all domain tables for complete multi-tenancy isolation (Phase 1)
    const tablesNeedingTenantId = [
      'settings', 'categories', 'modifiers', 'recipes', 'shifts', 'cash_movements',
      'feedbacks', 'promotions', 'customer_accounts', 'drivers', 'ingredients'
    ];
    for (const tbl of tablesNeedingTenantId) {
      await safeAddColumn(tbl, 'tenant_id', "TEXT DEFAULT 'default_tenant'");
    }

    // Geocode columns for saved addresses + phone-verified flag for customers
    for (const col of [{ name: 'lat', type: 'REAL' }, { name: 'lng', type: 'REAL' }]) {
      await safeAddColumn('customer_addresses', col.name, col.type);
    }
    await safeAddColumn('customer_accounts', 'phoneVerified', 'INTEGER DEFAULT 0');

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
async function seedDatabase(tenantId) {
  const tid = tenantId || 'default_tenant';
  try {
    // Check if categories have already been initialized / seeded for THIS tenant
    const catSeededSetting = await dbGet("SELECT value FROM settings WHERE tenant_id = ? AND key = 'categories_initial_seeded'", [tid]).catch(() => null);
    const categoriesCount = await dbGet('SELECT COUNT(*) as count FROM categories WHERE tenant_id = ?', [tid]);
    if (!catSeededSetting && (!categoriesCount || categoriesCount.count === 0)) {
      console.log(`Seeding default Sri Lanka categories for tenant: ${tid}`);
      await dbRun("INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, 'categories_initial_seeded', '1')", [tid]).catch(() => {});
      const defaultCategories = [
        { id: `${tid}_rice_curry`, name: 'Rice & Curry', emoji: '🍚' },
        { id: `${tid}_bbq_grill`, name: 'BBQ & Grill', emoji: '🍖' },
        { id: `${tid}_kottu_roti`, name: 'Kottu & Roti', emoji: '🍜' },
        { id: `${tid}_short_eats`, name: 'Short Eats', emoji: '🥘' },
        { id: `${tid}_hoppers`, name: 'Hoppers & String Hoppers', emoji: '🍳' },
        { id: `${tid}_seafood`, name: 'Seafood', emoji: '🐟' },
        { id: `${tid}_biriyani`, name: 'Biriyani & Rice Dishes', emoji: '🍱' },
        { id: `${tid}_pizza_burger`, name: 'Pizza & Burgers', emoji: '🍕' },
        { id: `${tid}_beverages`, name: 'Beverages & Juice', emoji: '🥤' },
        { id: `${tid}_desserts`, name: 'Desserts & Sweets', emoji: '🍮' },
        { id: `${tid}_ice_cream`, name: 'Ice Cream & Shakes', emoji: '🍦' },
        { id: `${tid}_hot_drinks`, name: 'Hot Drinks', emoji: '☕' },
      ];
      for (const cat of defaultCategories) {
        await dbRun(
          'INSERT INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
          [cat.id, cat.name, cat.emoji, tid]
        ).catch(() => dbRun(
          'INSERT OR IGNORE INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?)',
          [cat.id, cat.name, cat.emoji, tid]
        ));
      }
    }

    // Check menu_items for THIS specific tenant (only seed if not already initialized)
    const menuSeededSetting = await dbGet("SELECT value FROM settings WHERE tenant_id = ? AND key = 'menu_initial_seeded'", [tid]).catch(() => null);
    const itemsCount = await dbGet('SELECT COUNT(*) as count FROM menu_items WHERE tenant_id = ?', [tid]);
    if (!menuSeededSetting && (!itemsCount || itemsCount.count === 0)) {
      console.log(`Seeding default Sri Lanka menu items for tenant: ${tid}...`);
      await dbRun("INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, 'menu_initial_seeded', '1')", [tid]).catch(() => {});
      const defaultItems = [
        { id: `${tid}_item_chicken_rice`, name: 'Chicken Rice & Curry', price: 950, cost: 400, category: `${tid}_rice_curry`, emoji: '🍗', stock: 50, minStock: 10, description: 'Traditional Sri Lankan rice served with chicken curry, dhal, and 3 vegetable curries.', isHalal: 1, preparationTime: 15 },
        { id: `${tid}_item_beef_kottu`, name: 'Beef Kottu Roti', price: 1100, cost: 500, category: `${tid}_kottu_roti`, emoji: '🥘', stock: 40, minStock: 10, description: 'Chopped flatbread wok-fried with seasoned beef, eggs, onions, and spicy gravy.', isHalal: 1, preparationTime: 15 },
        { id: `${tid}_item_cheese_kottu`, name: 'Cheese Chicken Kottu', price: 1300, cost: 600, category: `${tid}_kottu_roti`, emoji: '🧀', isHalal: 1, preparationTime: 18 },
        { id: `${tid}_item_bbq_quarter`, name: 'Quarter BBQ Chicken', price: 650, cost: 300, category: `${tid}_bbq_grill`, emoji: '🔥', stock: 30, minStock: 5, description: 'Charcoal-grilled quarter chicken marinated in smoky Sri Lankan spices.', isHalal: 1, preparationTime: 20 },
        { id: `${tid}_item_bbq_full`, name: 'Full BBQ Chicken with 4 Paratha', price: 1850, cost: 900, category: `${tid}_bbq_grill`, emoji: '🍗', isHalal: 1, preparationTime: 25 },
        { id: `${tid}_item_seafood_rice`, name: 'Seafood Fried Rice', price: 1600, cost: 750, category: `${tid}_seafood`, emoji: '🦐', stock: 25, minStock: 5, description: 'Wok-fried basmati rice with prawns, calamari, egg, and spring onions.', isHalal: 0, preparationTime: 20 },
        { id: `${tid}_item_egg_roti`, name: 'Egg Roti with Gravy', price: 250, cost: 80, category: `${tid}_short_eats`, emoji: '🍳', stock: 60, minStock: 15, description: 'Freshly baked griddle roti folded with egg and served with curry dipping sauce.', isHalal: 1, preparationTime: 10 },
        { id: `${tid}_item_mango_juice`, name: 'Fresh Mango Juice', price: 350, cost: 120, category: `${tid}_beverages`, emoji: '🥤', stock: 50, minStock: 10, description: 'Chilled 100% natural tropical mango juice.', isHalal: 1, preparationTime: 5 },
        { id: `${tid}_item_woodapple`, name: 'Woodapple Juice', price: 300, cost: 100, category: `${tid}_beverages`, emoji: '🍹', stock: 45, minStock: 10, description: 'Authentic Sri Lankan woodapple blend with coconut milk and brown sugar.', isHalal: 1, preparationTime: 5 }
      ];
      for (const item of defaultItems) {
        await dbRun(`
          INSERT INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, isHalal, preparationTime, tenant_id, isAvailable)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO NOTHING
        `, [item.id, item.name, item.price, item.cost, item.category, item.emoji, item.stock, item.minStock, item.description, item.isHalal, item.preparationTime, tid]).catch(() => {
          return dbRun(`
            INSERT OR IGNORE INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, isHalal, preparationTime, tenant_id, isAvailable)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `, [item.id, item.name, item.price, item.cost, item.category, item.emoji, item.stock, item.minStock, item.description, item.isHalal, item.preparationTime, tid]);
        });
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
        { key: 'phone', value: '+94 76 013 0922' },
        { key: 'whatsapp', value: '+94760130922' },
        { key: 'supportEmail', value: 'gastroflowadmin@gmail.com' }
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

    // Development-only sample accounts. Production operators must provision a
    // strong owner through environment/bootstrap tooling, never a hard-coded seed.
    const masterAdminUser = process.env.ADMIN_USERNAME || 'admin';
    const masterAdminPass = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123');
    const masterAdminHash = await bcrypt.hash(masterAdminPass, 10);
    const staffPasswordHash = await bcrypt.hash('123456', 10);

    const adminUser = await dbGet('SELECT * FROM users WHERE username = ? OR id = ?', [masterAdminUser, 'user_admin']);
    if (!adminUser && process.env.NODE_ENV !== 'production') {
      console.log('Seeding default admin and staff users...');
      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin, tenant_id)
        VALUES (?, ?, ?, 'owner', '1234', 'default_tenant')
      `, ['user_admin', masterAdminUser, masterAdminHash]);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin, tenant_id)
        VALUES (?, ?, ?, 'manager', '2222', 'default_tenant')
      `, ['user_manager', 'manager_john', staffPasswordHash]);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin, tenant_id)
        VALUES (?, ?, ?, 'cashier', '3333', 'default_tenant')
      `, ['user_cashier', 'cashier_sarah', staffPasswordHash]);

      await dbRun(`
        INSERT INTO users (id, username, passwordHash, role, pin, tenant_id)
        VALUES (?, ?, ?, 'kitchen', '4444', 'default_tenant')
      `, ['user_kitchen', 'chef_mario', staffPasswordHash]);
    } else if (adminUser && process.env.NODE_ENV !== 'production') {
      // Keep the local development account reproducible. Production passwords are
      // changed only through the authenticated account-management workflow.
      await dbRun(
        'UPDATE users SET username = ?, passwordHash = ?, role = ?, tenant_id = ? WHERE id = ? OR LOWER(username) = LOWER(?)',
        [masterAdminUser, masterAdminHash, 'owner', 'default_tenant', adminUser.id, masterAdminUser]
      );
      console.log(`[Boot] Master Admin account "${masterAdminUser}" synced successfully.`);
    }

    // Development demo drivers must never be created in a production tenant.
    const driversCount = await dbGet('SELECT COUNT(*) as count FROM drivers');
    if (driversCount.count === 0 && process.env.NODE_ENV !== 'production') {
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
          { id: 'mod1', menuItemId: `${tid}_item_chicken_rice`, groupName: 'Portion', name: 'Regular', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod2', menuItemId: `${tid}_item_chicken_rice`, groupName: 'Add-ons', name: 'Extra Curry', priceDelta: 150, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod3', menuItemId: `${tid}_item_bbq_full`, groupName: 'Add-ons', name: 'Extra Paratha', priceDelta: 100, isMultiSelect: 1, isRequired: 0 },
          { id: 'mod4', menuItemId: `${tid}_item_mango_juice`, groupName: 'Ice Level', name: 'Normal Ice', priceDelta: 0, isMultiSelect: 0, isRequired: 1 },
          { id: 'mod5', menuItemId: `${tid}_item_mango_juice`, groupName: 'Ice Level', name: 'No Ice', priceDelta: 0, isMultiSelect: 0, isRequired: 1 }
        ];
        for (const mod of defaultModifiers) {
          await dbRun(
           'INSERT INTO modifiers (id, menuItemId, groupName, name, priceDelta, isMultiSelect, isRequired, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [mod.id, mod.menuItemId, mod.groupName, mod.name, mod.priceDelta, mod.isMultiSelect, mod.isRequired, tid]
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
          { id: 'rec1', menuItemId: `${tid}_item_chicken_rice`, ingredientId: 'ing1', quantityRequired: 1 },
          { id: 'rec2', menuItemId: `${tid}_item_chicken_rice`, ingredientId: 'ing2', quantityRequired: 150 },
          { id: 'rec3', menuItemId: `${tid}_item_chicken_rice`, ingredientId: 'ing3', quantityRequired: 80 },
          { id: 'rec4', menuItemId: `${tid}_item_chicken_rice`, ingredientId: 'ing4', quantityRequired: 50 }
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
        { key: 'phone', value: '+94 76 013 0922' },
        { key: 'whatsapp', value: '+94760130922' },
        { key: 'supportEmail', value: 'gastroflowadmin@gmail.com' },
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

      // Purge old hardcoded test items from database so store owners have a clean slate
      try {
        await dbRun("DELETE FROM menu_items WHERE id LIKE 'tenant_kb2c_itm_%'");
      } catch (_) {}
    } catch (e) {
      console.error('Error seeding advanced metadata:', e.message);
    }

    console.log('Database seeding verified successfully.');
  } catch (error) {
    console.error('Seeding database error:', error);
  }
}

// ── Seed KB2C BBQ Restaurant Store ──
async function seedKb2cStore() {
  try {
    const tid = 'tenant_kb2c';
    console.log('[Boot] Verifying KB2C BBQ Restaurant tenant account...');

    await dbRun(
      `INSERT OR IGNORE INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt)
       VALUES (?, 'KB2C BBQ Restaurant', 'kb2c', 'kb2c@restaurant.lk', 'pro', 'active', ?)`,
      [tid, Date.now()]
    );

    if (process.env.NODE_ENV === 'production') return;
    const hash = await bcrypt.hash(process.env.KB2C_DEMO_PASSWORD || generateStrongPassword(16), 10);
    await dbRun(
      `INSERT OR IGNORE INTO users (id, username, passwordHash, role, pin, tenant_id, email, phone)
        VALUES (?, 'kb2c_admin', ?, 'owner', ?, ?, 'kb2c@restaurant.lk', '0752237947')`,
       [`usr_kb2c_owner`, hash, await bcrypt.hash(generateSecurePin(), 10), tid]
    );

    const kb2cSettings = [
      { key: 'businessName', value: 'KB2C BBQ Restaurant' },
      { key: 'restaurantName', value: 'KB2C BBQ Restaurant' },
      { key: 'currencySymbol', value: 'Rs.' },
      { key: 'taxRate', value: '0' },
      { key: 'serviceChargeRate', value: '0' },
      { key: 'address', value: 'Sri Lanka' },
      { key: 'phone', value: '0752237947' },
      { key: 'whatsapp', value: '+94752237947' },
      { key: 'storeOpen', value: 'true' }
    ];

    for (const s of kb2cSettings) {
      const check = await dbGet('SELECT * FROM settings WHERE tenant_id = ? AND key = ?', [tid, s.key]);
      if (!check) {
        await dbRun('INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tid, s.key, s.value]);
      }
    }

    // 1. Purge deleted tenant twinbbq records from Neon DB
    try {
      await dbRun("DELETE FROM menu_items WHERE LOWER(tenant_id) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM categories WHERE LOWER(tenant_id) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM orders WHERE LOWER(tenant_id) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM customers WHERE LOWER(tenant_id) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM customer_accounts WHERE LOWER(tenant_id) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM tenants WHERE LOWER(id) LIKE '%twinbbq%' OR LOWER(name) LIKE '%twinbbq%' OR LOWER(subdomain) LIKE '%twinbbq%'");
      await dbRun("DELETE FROM users WHERE LOWER(tenant_id) LIKE '%twinbbq%' OR LOWER(username) LIKE '%twinbbq%'");
    } catch (_) {}

    // 2. Automatically unify all legacy kb2c records under tenant_kb2c
    try {
      await dbRun("UPDATE orders SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE order_items SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE customers SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE customer_accounts SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE menu_items SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE categories SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
      await dbRun("UPDATE tables SET tenant_id = 'tenant_kb2c' WHERE tenant_id = 'kb2c'");
    } catch (_) {}
  } catch (e) {
    console.error('KB2C store seeding failed:', e.message);
  }
}


// REST API ROUTES

// ── Rate Limiters (BUG-008 fix: reduced auth limiter, added OTP limiter) ──────
// Auth limiter: 5 attempts per 15 min per IP — prevents brute force on login/PIN
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again in 15 minutes.' }
});

// OTP limiter: 3 OTP sends per 10 min per IP — prevents OTP flooding & SMS cost abuse
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait 10 minutes before requesting another code.' }
});

const databaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many database operations, please try again later.' }
});

// Public API rate limiter (customer-facing)
const publicApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});

// Middleware: Authenticate JWT Token (Staff)
// BUG-002 fix: use JWT_SECRET from env only, fall back to clearly non-production dev constant
// Also enforces tenant suspension — if the store is suspended, all staff
// requests are blocked except for platform owners who manage tenants.
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token is invalid or has expired.' });
    }
    req.user = user;
    let tid = user.tenant_id || 'default_tenant';
    // Never allow X-Tenant-Id header to override an authenticated user's own tenant
    if (tid === 'kb2c') tid = 'tenant_kb2c';
    req.tenantId = tid;

    // ── Tenant Existence & Suspension Check ─────────────────────────────
    // Block access if the tenant was deleted or suspended. Platform owners
    // bypass so they can manage (re-activate / delete) stores via the SaaS panel.
    try {
      const tenantRow = await dbGet('SELECT status FROM tenants WHERE id = ?', [tid]);
      if (!tenantRow && user.role !== 'owner') {
        return res.status(403).json({
          error: 'This restaurant store no longer exists. It may have been deleted by the platform administrator.',
          code: 'TENANT_DELETED'
        });
      }
      if (tenantRow && tenantRow.status === 'suspended' && user.role !== 'owner') {
        return res.status(403).json({
          error: 'This restaurant store has been suspended. Please contact the platform administrator.',
          code: 'TENANT_SUSPENDED'
        });
      }
    } catch (_) { /* fail-open: if lookup errors, allow through for backwards compat */ }

    next();
  });
};

// Middleware: Authenticate Customer JWT Token
// BUG-002 fix: removed hardcoded fallback secret
const authenticateCustomer = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Customer authentication required.' });
  }

  const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET;
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
// BUG-002 fix: removed hardcoded JWT secret fallback
const authenticateDriver = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Accept token from Authorization header only (not query/body — avoids token leakage in logs)
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Driver authentication required.' });
  jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET, (err, decoded) => {
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
// X-Tenant-Id / X-Tenant-Subdomain headers.
async function resolvePublicTenant(req) {
  const explicitId = req.query.tenantId || req.headers['x-tenant-id'];
  if (explicitId) {
    const raw = String(explicitId).trim();
    if (raw === 'default' || raw === 'default_tenant') return 'default_tenant';
    try {
      const row = await dbGet("SELECT id FROM tenants WHERE id = ? OR subdomain = ?", [raw, raw]);
      if (row) return row.id;
    } catch (_) {}
    return raw;
  }
  const sub = req.query.tenant || req.headers['x-tenant-subdomain'];
  if (sub) {
    const raw = String(sub).trim();
    if (raw === 'default' || raw === 'default_tenant') return 'default_tenant';
    try {
      const row = await dbGet("SELECT id FROM tenants WHERE subdomain = ? OR id = ?", [raw, raw]);
      if (row) return row.id;
    } catch (_) {}
    return raw;
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
  const tid = tenantId || 'default_tenant';
  const existing = await dbGet('SELECT key FROM settings WHERE tenant_id = ? AND key = ?', [tid, key]);
  if (existing) {
    await dbRun('UPDATE settings SET value = ? WHERE tenant_id = ? AND key = ?', [String(value ?? ''), tid, key]);
  } else {
    await dbRun('INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tid, key, String(value ?? '')]);
  }
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
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const cleanUser = String(username).trim();
    const user = await dbGet('SELECT * FROM users WHERE username = ? OR LOWER(username) = LOWER(?)', [cleanUser, cleanUser]);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const userTenantId = user.tenant_id || 'default_tenant';
    if (user.role !== 'owner') {
      const tenantRow = await dbGet('SELECT status FROM tenants WHERE id = ?', [userTenantId]);
      if (!tenantRow) {
        return res.status(403).json({
          error: 'This restaurant store no longer exists or has been deleted by the platform administrator.',
          code: 'TENANT_DELETED'
        });
      }
      if (tenantRow.status === 'suspended') {
        return res.status(403).json({
          error: 'This restaurant store has been suspended. Please contact the platform administrator.',
          code: 'TENANT_SUSPENDED'
        });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id || 'default_tenant' },
      process.env.JWT_SECRET || JWT_SECRET,
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
// BUG-021 fix: scoped to req.tenantId so cross-tenant PINs are rejected
app.post('/api/auth/verify-pin', authenticateToken, pinLimiter, async (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string' || pin.length > 16) {
    return res.status(400).json({ error: 'PIN is required.' });
  }

  try {
    const tenantId = req.tenantId || 'default_tenant';
    const managers = await dbAll(
      'SELECT id, username, role, pin FROM users WHERE role IN ("owner", "manager") AND tenant_id = ?',
      [tenantId]
    );
    let authorizedManager = null;

    for (const mgr of managers) {
      if (!mgr.pin) continue;
      // Support bcrypt-hashed PINs (migrated) and plain-text fallback (legacy, pre-migration)
      const isHashed = mgr.pin.startsWith('$2a$') || mgr.pin.startsWith('$2b$');
      const match = isHashed
        ? await bcrypt.compare(pin, mgr.pin)
        : mgr.pin === pin; // legacy plain-text (will be hashed on next boot migration)
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
// SETTINGS & CASHIER SHIFT ENDPOINTS (POS Frontend API)
// ======================================================

// GET /api/settings
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    const rows = await dbAll('SELECT key, value FROM settings WHERE tenant_id = ?', [tenantId]);
    const settingsMap = {};
    for (const r of rows) {
      settingsMap[r.key] = r.value;
    }

    // Auto-fallback to tenant name if restaurantName / businessName is not yet set
    if (!settingsMap.restaurantName && !settingsMap.businessName) {
      const tenantRow = await dbGet('SELECT name FROM tenants WHERE id = ?', [tenantId]);
      if (tenantRow && tenantRow.name) {
        settingsMap.restaurantName = tenantRow.name;
        settingsMap.businessName = tenantRow.name;
      }
    }

    res.json(settingsMap);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/settings
app.post('/api/settings', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) {
    return res.status(400).json({ error: 'Key is required.' });
  }
  try {
    const tenantId = req.tenantId || 'default_tenant';
    await setSetting(tenantId, key, value);

    // Propagate store changes to open POS and Customer clients
    const STORE_CONTROL_KEYS = new Set([
      'storeOpen', 'defaultPrepTime', 'dineInPrepTime', 'takeawayPrepTime', 'deliveryPrepTime',
      'businessName', 'restaurantName', 'logoUrl', 'logo', 'phone', 'address', 'currencySymbol', 'taxRate', 'serviceChargeRate'
    ]);
    if (STORE_CONTROL_KEYS.has(key)) {
      notifyPublicStore({ type: 'settings_updated', key, value }, tenantId);
      notifyPOS({ type: 'settings_updated', key, value }, tenantId);
    }

    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/shifts/active
app.get('/api/shifts/active', authenticateToken, async (req, res) => {
  try {
    const shift = await dbGet(
      "SELECT * FROM shifts WHERE userId = ? AND status = 'open' ORDER BY startTime DESC LIMIT 1",
      [req.user.id]
    );
    res.json(shift || null);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/shifts/open
app.post('/api/shifts/open', authenticateToken, validateRequest(shiftOpenSchema), async (req, res) => {
  const { startFloat, notes } = req.body || {};
  const floatVal = parseFloat(startFloat) || 0;
  try {
    const active = await dbGet(
      "SELECT id FROM shifts WHERE userId = ? AND status = 'open'",
      [req.user.id]
    );
    if (active) {
      return res.status(400).json({ error: 'You already have an open shift.' });
    }
    const shiftId = `sh_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const startTime = Date.now();
    await dbRun(
      `INSERT INTO shifts (id, userId, username, startTime, startFloat, status, notes)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [shiftId, req.user.id, req.user.username, startTime, floatVal, notes || '']
    );
    await writeAuditLog(req.user.id, req.user.username, 'open_shift', `Opened cashier shift with float LKR ${floatVal}`);
    const newShift = await dbGet('SELECT * FROM shifts WHERE id = ?', [shiftId]);
    res.json(newShift);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/shifts/close
app.post('/api/shifts/close', authenticateToken, validateRequest(shiftCloseSchema), async (req, res) => {
  const { actualCash, notes } = req.body || {};
  const actualVal = parseFloat(actualCash) || 0;
  try {
    const active = await dbGet(
      "SELECT * FROM shifts WHERE userId = ? AND status = 'open' ORDER BY startTime DESC LIMIT 1",
      [req.user.id]
    );
    if (!active) {
      return res.status(400).json({ error: 'No active open shift found.' });
    }
    const endTime = Date.now();
    const ordersCount = await dbGet(
      "SELECT SUM(total) as cashTotal FROM orders WHERE timestamp >= ? AND paymentMethod = 'cash' AND status = 'paid'",
      [active.startTime]
    );
    const cashSales = ordersCount?.cashTotal || 0;
    const expectedCash = (active.startFloat || 0) + cashSales;

    await dbRun(
      `UPDATE shifts SET endTime = ?, endFloat = ?, actualCash = ?, expectedCash = ?, status = 'closed', notes = ? WHERE id = ?`,
      [endTime, actualVal, actualVal, expectedCash, notes || '', active.id]
    );
    await writeAuditLog(req.user.id, req.user.username, 'close_shift', `Closed cashier shift. Actual: LKR ${actualVal}, Expected: LKR ${expectedCash}`);
    const closedShift = await dbGet('SELECT * FROM shifts WHERE id = ?', [active.id]);
    res.json(closedShift);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/menu/clear-store-menu — Wipes all menu items and categories for active tenant

// Bulk Clear-All Menu Items Endpoint
app.post(['/api/menu_items/clear-all', '/api/menu/clear-all'], authenticateToken, requireRole(['owner', 'manager', 'admin']), async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    await dbRun('DELETE FROM menu_items WHERE tenant_id = ? OR (tenant_id IS NULL AND ? = "default_tenant")', [tenantId, tenantId]);
    await dbRun("INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, 'menu_initial_seeded', '1')", [tenantId]).catch(() => {});
    try {
      notifyPublicStore({ type: 'menu_cleared' }, tenantId);
      notifyPOS({ type: 'menu_cleared' }, tenantId);
    } catch (_) {}
    res.json({ success: true, message: 'All menu items cleared successfully from database.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Bulk Clear-All Categories Endpoint
app.post(['/api/categories/clear-all'], authenticateToken, requireRole(['owner', 'manager', 'admin']), async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    await dbRun('DELETE FROM categories WHERE tenant_id = ? OR (tenant_id IS NULL AND ? = "default_tenant")', [tenantId, tenantId]);
    await dbRun("INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, 'categories_initial_seeded', '1')", [tenantId]).catch(() => {});
    try {
      notifyPublicStore({ type: 'categories_cleared' }, tenantId);
      notifyPOS({ type: 'categories_cleared' }, tenantId);
    } catch (_) {}
    res.json({ success: true, message: 'All categories cleared successfully from database.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Generic Table CRUD Endpoints (Categories, Menu Items, Tables, Customers)
const CRUD_TABLES = ['categories', 'menu_items', 'tables', 'customers'];

for (const tableName of CRUD_TABLES) {
  app.get(`/api/${tableName}`, authenticateToken, async (req, res) => {
    try {
      const tenantId = req.tenantId || 'default_tenant';
      const rows = await dbAll(
        `SELECT * FROM ${tableName} WHERE tenant_id = ?`,
        [tenantId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: errMsg(err) });
    }
  });

  app.post(`/api/${tableName}`, authenticateToken, async (req, res) => {
    const item = { ...req.body };
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Invalid record payload.' });
    }
    // BUG-017 fix: always use the server's authenticated tenant — never accept tenant_id from client body
    item.tenant_id = req.tenantId || 'default_tenant';
    const id = item.id || `${tableName.slice(0, 3)}_${Date.now()}`;
    const keys = Object.keys(item).filter(k => k !== 'id');
    const cols = ['id', ...keys];
    const placeholders = cols.map(() => '?').join(', ');
    const vals = [id, ...keys.map(k => typeof item[k] === 'object' ? JSON.stringify(item[k]) : item[k])];

    try {
      const existing = await dbGet(`SELECT id FROM ${tableName} WHERE id = ?`, [id]);
      if (existing) {
        const updateCols = keys.map(k => `${k} = ?`).join(', ');
        const updateVals = [...keys.map(k => typeof item[k] === 'object' ? JSON.stringify(item[k]) : item[k]), id];
        await dbRun(`UPDATE ${tableName} SET ${updateCols} WHERE id = ?`, updateVals);
      } else {
        await dbRun(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      }
      const saved = await dbGet(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: errMsg(err) });
    }
  });

  app.delete(`/api/${tableName}/:id`, authenticateToken, requireRole(['owner', 'manager', 'admin']), async (req, res) => {
    const { id } = req.params;
    try {
      const tenantId = req.tenantId || 'default_tenant';
      await dbRun(`DELETE FROM ${tableName} WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`, [id, tenantId]);
      if (tableName === 'menu_items') {
        try {
          notifyPublicStore({ type: 'item_deleted', itemId: id }, tenantId);
          notifyPOS({ type: 'item_deleted', itemId: id }, tenantId);
        } catch (_) {}
      } else if (tableName === 'categories') {
        try {
          notifyPublicStore({ type: 'category_deleted', categoryId: id }, tenantId);
          notifyPOS({ type: 'category_deleted', categoryId: id }, tenantId);
        } catch (_) {}
      }
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: errMsg(err) });
    }
  });
}

// ======================================================
// CUSTOMER AUTH ENDPOINTS (no staff token required)
// ======================================================

function isValidSriLankanPhone(phone) {
  if (!phone) return false;
  const cleanPhone = phone.replace(/[\s-]/g, '');
  return /^(?:\+94|0)7\d{8}$/.test(cleanPhone);
}

function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  return trimmed.length >= 3;
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

export function normalizeOtpDestination(dest) {
  if (!dest) return '';
  const str = String(dest).trim();
  if (str.includes('@')) {
    return str.toLowerCase();
  }
  return normalizeLkPhone(str);
}

// BUG-011 fix: OTP codes stored HASHED in the memory map (same as DB path).
// Comparing hash(input) vs stored hash prevents plaintext exposure in process dumps / logs.
function verifyOTP(destination, code) {
  if (!destination || !code) return false;
  const cleanDest = normalizeOtpDestination(destination);
  const codeHash = hashCode(String(code).trim());

  let entries = otpStore.get(cleanDest);
  if (!entries) return false;
  if (!Array.isArray(entries)) entries = [entries]; // backward compatibility check

  const validIndex = entries.findIndex(e => e.expiresAt >= Date.now() && e.codeHash === codeHash);
  if (validIndex !== -1) {
    entries.splice(validIndex, 1); // Consume single-use code
    otpStore.set(cleanDest, entries);
    return true;
  }
  return false;
}

async function verifyOTPAsync(destination, code) {
  if (!destination || !code) return false;
  if (verifyOTP(destination, code)) return true;

  try {
    const cleanDest = normalizeOtpDestination(destination);
    const cleanPhoneAlt = cleanDest.startsWith('+94') ? '0' + cleanDest.slice(3) : cleanDest;
    const codeHash = hashCode(String(code).trim());

    const dbOtp = await dbGet(
      `SELECT * FROM otp_codes WHERE (LOWER(destination) = ? OR destination = ? OR destination = ?) AND codeHash = ? AND expiresAt >= ?`,
      [cleanDest, cleanDest, cleanPhoneAlt, codeHash, Date.now()]
    );
    if (dbOtp) {
      await dbRun('DELETE FROM otp_codes WHERE id = ?', [dbOtp.id]);
      return true;
    }
  } catch (e) {}

  return false;
}

// POST /api/otp/send — Unified OTP generation (Email or SMS)
// BUG-008 fix: use the stricter otpLimiter (3 sends / 10 min) instead of the general publicApiLimiter
app.post(['/api/otp/send', '/api/auth/send-otp'], otpLimiter, async (req, res) => {
  try {
    const { channel, destination, phone, email, purpose = 'phone_verify' } = req.body || {};
    const target = destination || email || phone;
    if (!target || !String(target).trim()) {
      return res.status(400).json({ error: 'Email address or phone number is required.' });
    }

    const isEmail = (channel === 'email') || String(target).includes('@');
    const cleanDest = normalizeOtpDestination(target);

    if (!isEmail && !isValidSriLankanPhone(target)) {
      return res.status(400).json({ error: 'A valid Sri Lankan phone number is required (e.g. 0771234567).' });
    }

    // Enforcement: Only registered users can request a login OTP
    if (purpose === 'login') {
      const existingAccount = await dbGet(
        `SELECT id FROM customer_accounts WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ?`,
        [cleanDest, cleanDest, cleanDest]
      );
      const existingCustomer = existingAccount || await dbGet(
        `SELECT id FROM customers WHERE LOWER(phone) = ? OR LOWER(email) = ? OR phone = ?`,
        [cleanDest, cleanDest, cleanDest]
      );
      if (!existingCustomer) {
        return res.status(404).json({
          error: 'No registered account found with this phone or email. Please register your account first.'
        });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Clean up expired codes only (keep active valid codes so re-sends don't invalidate codes in transit)
    await dbRun('DELETE FROM otp_codes WHERE expiresAt < ?', [Date.now()]);

    const id = `otp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await dbRun(
      `INSERT INTO otp_codes (id, channel, destination, purpose, codeHash, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, isEmail ? 'email' : 'sms', cleanDest, purpose, hashCode(code), expiresAt, Date.now()]
    );

    // BUG-011 fix: store HASH of OTP code in memory (not plaintext)
    let currentEntries = otpStore.get(cleanDest) || [];
    if (!Array.isArray(currentEntries)) currentEntries = [currentEntries];
    currentEntries = currentEntries.filter(e => e.expiresAt > Date.now());
    currentEntries.push({ codeHash: hashCode(code), expiresAt, channel: isEmail ? 'email' : 'sms', purpose });
    otpStore.set(cleanDest, currentEntries);

    const tenantId = await resolvePublicTenant(req);
    const storeName = await getSettingAny(tenantId, ['restaurantName', 'businessName'], 'GastroFlow Bistro');

    let isSimulated = false;

    if (isEmail) {
      const html = buildOtpEmail({ code, purpose, destination: cleanDest, businessName: storeName });

      let emailSent = false;
      let emailError = null;

      try {
        const sendPromise = sendEmail({
          to: cleanDest,
          subject: `Your ${storeName} verification code: ${code}`,
          html,
          text: `Your ${storeName} verification code is ${code}. Valid for 10 minutes.`
        });
        const timeoutPromise = new Promise(r => setTimeout(() => r({ timeout: true, error: 'Email timeout (15s)' }), 15000));
        const sendRes = await Promise.race([sendPromise, timeoutPromise]);

        if (sendRes && sendRes.success) {
          emailSent = true;
          console.log(`[OTP EMAIL SUCCESS] Delivered to ${cleanDest} | Code: ${code}`);
        } else {
          emailError = sendRes?.error || (sendRes?.timeout ? 'Connection timeout' : 'SMTP send failed');
          console.warn(`[OTP EMAIL WARNING] Failed sending to ${cleanDest}:`, emailError);
        }
      } catch (e) {
        emailError = e.message;
        console.error('[OTP EMAIL EXCEPTION]', e.message);
      }

      return res.json({
        success: true,
        channel: 'email',
        destination: cleanDest,
        emailSent,
        emailError,
        message: emailSent
          ? `Verification code sent to ${cleanDest}. Please check your email inbox.`
          : `Email dispatch issue (${emailError || 'check SMTP credentials'}). OTP code active on server.`
      });
    } else {
      const msg = `Your ${storeName} verification code is ${code}. Valid for 10 minutes.`;

      // Fire-and-forget background SMS dispatch
      sendSms({ to: cleanDest, message: msg }).then(smsRes => {
        if (!smsRes || smsRes.simulated || !smsRes.success) {
          console.warn(`[SMS SEND BACKGROUND WARNING] Diagnostic result:`, smsRes);
        } else {
          console.log(`[OTP SMS SUCCESS] Delivered to ${cleanDest}`);
        }
      }).catch(e => {
        console.error('[SMS OTP BACKGROUND EXCEPTION]', e.message);
      });

      return res.json({
        success: true,
        channel: 'sms',
        destination: cleanDest,
        message: `Verification code sent via SMS to ${cleanDest}. Please check your phone.`
      });
    }
  } catch (err) {
    console.error('[OTP SEND ERROR]', err);
    res.status(500).json({ error: 'Failed to send verification code: ' + err.message });
  }
});

// POST /api/otp/verify — Verify OTP code and login existing customer or return verification status
app.post('/api/otp/verify', publicApiLimiter, async (req, res) => {
  try {
    const { destination, code, phone, email } = req.body;
    const target = destination || email || phone;
    if (!target || !code) {
      return res.status(400).json({ error: 'Destination and code are required.' });
    }

    const isEmail = target.includes('@');
    const cleanDest = isEmail ? target.toLowerCase().trim() : target.replace(/[\s-]/g, '');

    const isValid = await verifyOTPAsync(cleanDest, code);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    // Check if account already exists
    const customer = await dbGet(
      'SELECT * FROM customer_accounts WHERE email = ? OR phone = ?',
      [cleanDest, cleanDest]
    );

    if (customer) {
      const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET;
      const token = jwt.sign(
        { id: customer.id, phone: customer.phone, email: customer.email, name: customer.name, type: 'customer' },
        secret,
        { expiresIn: '7d' }
      );
      return res.json({
        verified: true,
        loggedIn: true,
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          loyaltyPoints: customer.loyaltyPoints || 0,
          totalSpent: customer.totalSpent || 0
        }
      });
    }

    return res.json({ verified: true, loggedIn: false, destination: cleanDest });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
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

  // Verify OTP (allow either phone or email verification)
  const isOtpValid = (await verifyOTPAsync(cleanPhone, otpCode)) || (cleanEmail && (await verifyOTPAsync(cleanEmail, otpCode)));
  if (!isOtpValid) {
    return res.status(400).json({ error: 'Invalid or expired verification code.' });
  }

  try {
    const normPhone = normalizeLkPhone(cleanPhone);

    // 1. Check duplicate phone
    const existingPhone = await dbGet(
      'SELECT id FROM customer_accounts WHERE phone = ? OR phone = ? OR phone = ?',
      [cleanPhone, normPhone, phone]
    );
    if (existingPhone) {
      return res.status(400).json({ error: 'An account with this phone number already exists. Please log in.' });
    }

    // 2. Check duplicate email (if provided)
    if (cleanEmail) {
      const existingEmail = await dbGet(
        'SELECT id FROM customer_accounts WHERE LOWER(email) = LOWER(?)',
        [cleanEmail]
      );
      if (existingEmail) {
        return res.status(400).json({ error: 'An account with this email address already exists. Please log in.' });
      }
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const id = `ca_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const tenantId = await resolvePublicTenant(req);
    await dbRun(
      `INSERT INTO customer_accounts (id, name, email, phone, passwordHash, loyaltyPoints, totalSpent, createdAt, tenant_id)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, name.trim(), cleanEmail, normPhone || cleanPhone, passwordHash, Date.now(), tenantId]
    );

    // Auto-sync customer to POS CRM customers database (Postgres & SQLite compatible)
    try {
      const existingCust = await dbGet('SELECT id FROM customers WHERE id = ?', [id]);
      if (!existingCust) {
        await dbRun(
          `INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id)
           VALUES (?, ?, ?, ?, 0, 0, 0.0, ?)`,
          [id, name.trim(), normPhone || cleanPhone, cleanEmail || '', tenantId]
        );
      }
    } catch (err) {
      console.error('[CRM Sync Customer Error]', err.message);
    }
    broadcastEvent('customer_registered', { id, name: name.trim(), phone: normPhone || cleanPhone, email: cleanEmail }, tenantId);

    const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET;
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
    const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET;
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

// ── Uber Eats Smart Dynamic ETA Engine Helper ──
export async function calculateOrderETA(orderId, tenantId = 'default_tenant') {
  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return { estimatedMinutes: 25, estimatedDeliveryTime: Date.now() + 25 * 60 * 1000 };

    const items = await dbAll(
      `SELECT m.prepTimeMinutes, oi.quantity 
       FROM order_items oi 
       JOIN menu_items m ON oi.menuItemId = m.id 
       WHERE oi.orderId = ?`,
      [orderId]
    );

    let maxItemPrep = 15;
    if (items && items.length > 0) {
      maxItemPrep = Math.max(...items.map(i => i.prepTimeMinutes || 15));
    }

    const activeOrders = await dbGet(
      `SELECT COUNT(*) as count FROM orders WHERE tenant_id = ? AND status IN ('pending', 'preparing')`,
      [tenantId]
    );
    const kitchenLoadBuffer = Math.min(Math.floor((activeOrders?.count || 0) / 3) * 3, 15);

    const isPeak = await isPeakHour(tenantId);
    const config = await getSettingsMap(tenantId, ['isRainyWeather', 'deliveryBaseFee']);
    const peakBuffer = isPeak ? 8 : 0;
    const rainBuffer = config.isRainyWeather === 'true' ? 12 : 0;
    const distanceBuffer = order.diningType === 'delivery' ? 12 : 0;

    const totalMinutes = maxItemPrep + kitchenLoadBuffer + peakBuffer + rainBuffer + distanceBuffer;
    const estimatedDeliveryTime = (order.timestamp || Date.now()) + totalMinutes * 60 * 1000;

    return {
      estimatedMinutes: totalMinutes,
      maxItemPrep,
      kitchenLoadBuffer,
      peakBuffer,
      rainBuffer,
      distanceBuffer,
      estimatedDeliveryTime
    };
  } catch (err) {
    return { estimatedMinutes: 25, estimatedDeliveryTime: Date.now() + 25 * 60 * 1000 };
  }
}

// GET /api/public/orders/:id/eta — Dynamic ETA computation
app.get('/api/public/orders/:id/eta', publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = await resolvePublicTenant(req);
    const etaData = await calculateOrderETA(id, tenantId);
    res.json(etaData);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/orders/:id/dispatch-status — Customer-facing real-time driver dispatch info
// BUG-006 fix: requires caller to provide the phone number on the order (ownership proof).
// Raw GPS coordinates are not returned — only a distance figure, to prevent real-time location tracking.
app.get('/api/public/orders/:id/dispatch-status', publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    // Ownership proof: customer must supply the phone they used when ordering
    const callerPhone = req.query.phone || req.query.customerPhone;
    if (!callerPhone) {
      return res.status(400).json({ error: 'Phone number is required to view order status.' });
    }
    const tenantId = await resolvePublicTenant(req);

    const order = await dbGet(
      'SELECT id, status, driverId, dispatchMode, deliveryLat, deliveryLng, etaMinutes, acceptedAt, customerPhone FROM orders WHERE id = ?',
      [id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    // Verify the caller's phone matches the order (normalise both sides)
    const normalisePhone = (p) => (p || '').replace(/[\s-]/g, '').replace(/^\+94/, '0');
    if (normalisePhone(callerPhone) !== normalisePhone(order.customerPhone)) {
      return res.status(403).json({ error: 'Phone number does not match the order record.' });
    }

    let driverInfo = null;
    let distanceToStoreKm = null;

    if (order.driverId) {
      // Get driver last-known GPS ping
      const ping = await dbGet(
        'SELECT lat, lng, updatedAt FROM driver_locations WHERE driverName = ? ORDER BY updatedAt DESC LIMIT 1',
        [order.driverId]
      );

      // Get store coordinates to calculate driver's distance to store
      const settings = await getSettingsMap(tenantId, ['storeLat', 'storeLng', 'storeName']);
      const storeLat = parseFloat(settings.storeLat || 6.9271);
      const storeLng = parseFloat(settings.storeLng || 79.8612);

      if (ping) {
        distanceToStoreKm = Math.round(haversineDistanceKm(ping.lat, ping.lng, storeLat, storeLng) * 10) / 10;
        const pingAge = Date.now() - Number(ping.updatedAt || 0);
        // BUG-006 fix: do NOT return raw GPS coordinates — only derived distance
        driverInfo = {
          name: order.driverId,
          distanceToStoreKm,
          lastSeenMs: pingAge,
          isRecent: pingAge < 10 * 60 * 1000 // within last 10 min
        };
      } else {
        driverInfo = { name: order.driverId, lastSeenMs: null, isRecent: false };
      }
    }

    // Produce human-readable label
    const s = (order.status || '').toLowerCase();
    let dispatchLabel, dispatchIcon;
    if (!order.driverId) {
      dispatchLabel = 'Finding a driver for you…';
      dispatchIcon  = '🔄';
    } else if (s === 'out_for_delivery') {
      dispatchLabel = `${order.driverId} is on the way! ${distanceToStoreKm !== null ? `(${distanceToStoreKm} km from store)` : ''}`;
      dispatchIcon  = '🛵';
    } else if (s === 'ready') {
      dispatchLabel = `${order.driverId} assigned — picking up your order`;
      dispatchIcon  = '✅';
    } else if (s === 'preparing' || s === 'pending') {
      dispatchLabel = `${order.driverId} confirmed — kitchen is preparing your order`;
      dispatchIcon  = '👨‍🍳';
    } else if (s === 'completed' || s === 'delivered' || s === 'paid') {
      dispatchLabel = 'Order delivered! Enjoy your meal 🎉';
      dispatchIcon  = '🎉';
    } else {
      dispatchLabel = `Driver: ${order.driverId}`;
      dispatchIcon  = '📦';
    }

    const storePhone = (await getSetting(tenantId, 'phone')) || '0752237947';
    const storeName = (await getSettingAny(tenantId, ['restaurantName', 'businessName'])) || 'GastroFlow Bistro';

    res.json({
      orderId: order.id,
      orderStatus: order.status,
      dispatchMode: order.dispatchMode || 'manual',
      driverId: order.driverId || null,
      driver: driverInfo,
      dispatchLabel,
      dispatchIcon,
      etaMinutes: order.etaMinutes || null,
      acceptedAt: order.acceptedAt || null,
      storePhone,
      storeName
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});



app.get('/api/public/cart-upsell', publicApiLimiter, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const cartIdsStr = req.query.itemIds || '';
    const cartItemIds = cartIdsStr.split(',').filter(Boolean);

    const allItems = await dbAll(
      `SELECT id, name, price, category, emoji, description, dietaryTags 
       FROM menu_items 
       WHERE tenant_id = ? AND (stock IS NULL OR stock > 0)`,
      [tenantId]
    );

    if (allItems.length === 0) return res.json([]);

    const cartCategories = new Set();
    cartItemIds.forEach(id => {
      const item = allItems.find(i => i.id === id);
      if (item) cartCategories.add(item.category?.toLowerCase());
    });

    let upsellItems = [];

    if (!cartCategories.has('drinks') && !cartCategories.has('beverages')) {
      const drinks = allItems.filter(i => /drink|beverage|juice|soda|tea|coffee|shake|mojito/i.test((i.category || '') + (i.name || '')));
      upsellItems.push(...drinks);
    }

    if (!cartCategories.has('desserts')) {
      const desserts = allItems.filter(i => /dessert|cake|ice cream|pudding|sweet|waffle/i.test((i.category || '') + (i.name || '')));
      upsellItems.push(...desserts);
    }

    const sides = allItems.filter(i => /starter|appetizer|side|french fries|garlic bread|soup|salad/i.test((i.category || '') + (i.name || '')));
    upsellItems.push(...sides);

    const finalUpsells = upsellItems
      .filter(item => !cartItemIds.includes(item.id))
      .slice(0, 4);

    if (finalUpsells.length === 0) {
      const fallback = allItems.filter(i => !cartItemIds.includes(i.id)).slice(0, 4);
      return res.json(fallback);
    }

    res.json(finalUpsells);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/driver/active-batch — Fetch stacked multi-order delivery batch for driver
// BUG-004 fix: require driver JWT auth — drivers get their OWN orders from the token identity
app.get('/api/driver/active-batch', authenticateDriver, async (req, res) => {
  try {
    const driverId = req.driver.driverId;
    const driver = await dbGet(
      'SELECT id, name, phone, status FROM drivers WHERE id = ?',
      [driverId]
    );

    if (!driver) return res.json({ driver: null, orders: [] });

    const activeOrders = await dbAll(
      `SELECT o.*, dl.lat as driverLat, dl.lng as driverLng 
       FROM orders o 
       LEFT JOIN driver_locations dl ON o.id = dl.orderId 
       WHERE o.driverId = ? AND o.status IN ('out_for_delivery', 'confirmed', 'preparing', 'ready')
       ORDER BY o.timestamp ASC`,
      [driver.id]
    );

    res.json({
      driver: { id: driver.id, name: driver.name, phone: driver.phone, status: driver.status },
      orders: activeOrders,
      batchCount: activeOrders.length
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/driver/assign-batch — Batch assign multiple orders to a rider
// BUG-003 fix: require staff authentication with manager/owner role
// Previously this was a fully unauthenticated endpoint allowing anyone to reassign orders
app.post('/api/public/driver/assign-batch', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const { driverId, orderIds } = req.body;
    if (!driverId || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'Driver ID and list of order IDs are required.' });
    }
    if (orderIds.length > 20) {
      return res.status(400).json({ error: 'Cannot batch-assign more than 20 orders at once.' });
    }

    const tenantId = req.tenantId || 'default_tenant';
    const driver = await dbGet('SELECT * FROM drivers WHERE (id = ? OR phone = ?) AND tenant_id = ?', [driverId, driverId, tenantId]);
    if (!driver) return res.status(404).json({ error: 'Driver not found.' });

    for (const orderId of orderIds) {
      // Only assign orders belonging to this tenant
      await dbRun(
        "UPDATE orders SET driverId = ?, status = 'out_for_delivery' WHERE id = ? AND tenant_id = ?",
        [driver.id, orderId, tenantId]
      );
      broadcastEvent('order_updated', { orderId, status: 'out_for_delivery', driverName: driver.name, driverPhone: driver.phone });
    }

    res.json({ success: true, message: `Batch of ${orderIds.length} orders assigned to driver ${driver.name}!`, orderIds });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/orders/:id/driver-chat — Fetch live chat messages between customer & assigned rider
// BUG-005 fix: require caller to be the assigned driver (by driver JWT) or the order's customer (by customer JWT)
app.get('/api/orders/:id/driver-chat', publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    // Identify caller: customer JWT, driver JWT, or staff JWT
    const rawToken = req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (!rawToken) return res.status(401).json({ error: 'Authentication required to access order chat.' });
    let decoded;
    try { decoded = jwt.verify(rawToken, process.env.JWT_SECRET || JWT_SECRET); } catch {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    // Staff (owner/manager/cashier/kitchen) can see all chats
    const isStaff = decoded.role && ['owner', 'manager', 'cashier', 'kitchen'].includes(decoded.role);
    const isDriver = decoded.role === 'driver';
    const isCustomer = decoded.type === 'customer';
    if (!isStaff && !isDriver && !isCustomer) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (isDriver || isCustomer) {
      // Verify caller is tied to this order
      const order = await dbGet('SELECT id, customerAccountId, driverId FROM orders WHERE id = ?', [id]);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (isDriver && order.driverId !== decoded.driverId) {
        return res.status(403).json({ error: 'You are not the assigned driver for this order.' });
      }
      if (isCustomer && order.customerAccountId !== decoded.id) {
        return res.status(403).json({ error: 'You are not the customer for this order.' });
      }
    }
    const messages = await dbAll('SELECT * FROM driver_customer_chats WHERE orderId = ? ORDER BY createdAt ASC', [id]);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/orders/:id/driver-chat — Send in-app live chat message between customer & rider
// BUG-005 fix: authenticate caller and derive senderType from token — never trust client-supplied senderType
app.post('/api/orders/:id/driver-chat', publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    if (String(message).length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters).' });
    }
    const rawToken = req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (!rawToken) return res.status(401).json({ error: 'Authentication required to send chat messages.' });
    let decoded;
    try { decoded = jwt.verify(rawToken, process.env.JWT_SECRET || JWT_SECRET); } catch {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    // Verify caller is the order's driver or customer
    const order = await dbGet('SELECT id, customerAccountId, driverId FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const isDriver = decoded.role === 'driver';
    const isCustomer = decoded.type === 'customer';
    const isStaff = decoded.role && ['owner', 'manager'].includes(decoded.role);
    if (!isStaff) {
      if (isDriver && order.driverId !== decoded.driverId) {
        return res.status(403).json({ error: 'You are not the assigned driver for this order.' });
      }
      if (isCustomer && order.customerAccountId !== decoded.id) {
        return res.status(403).json({ error: 'You are not the customer for this order.' });
      }
    }
    // Derive senderType and senderName from verified token — never from client body
    const senderType = isDriver ? 'driver' : isStaff ? 'staff' : 'customer';
    const senderName = decoded.name || decoded.username || senderType;

    const msgId = `dchat_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    await dbRun(
      'INSERT INTO driver_customer_chats (id, orderId, senderType, senderName, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [msgId, id, senderType, senderName, message.trim(), Date.now()]
    );

    broadcastEvent('driver_chat_message', {
      orderId: id,
      messageId: msgId,
      senderType,
      senderName,
      message: message.trim(),
      timestamp: Date.now()
    });

    res.status(201).json({ success: true, messageId: msgId });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

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

    // ── Google Gemini 1.5 Flash API LLM Engine ──
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      try {
        const sysContext = `You are GastroAI, the official 24/7 Intelligent Customer Assistant & Dining Concierge for "${storeName}".
Your goal is to help customers politely, cleanly, and professionally with ALL questions:
1. Food recommendations, prices, dietary options (veg, vegan, halal, gluten-free), combos, beverages.
2. Order status, live delivery tracking, prep times, cancellation rules.
3. Customer Care, Support & Career Inquiries: When the user asks about contacting support, customer care, careers, jobs (e.g. "conductcareer", "contact care", "agent", "call manager"), understand their intent immediately and present clean escalation options.
4. Location, opening hours, payment methods, feedback.

Available menu items: ${JSON.stringify(menuItems.slice(0, 20).map(i => ({ id: i.id, name: i.name, price: i.price, category: i.category, tags: i.dietaryTags })))}
Customer Cart: ${JSON.stringify(cartItems || [])}
Customer Query: "${message}"

Respond cleanly and professionally in Markdown (EN, Sinhala, or Tamil as requested).
Return valid JSON:
{
  "reply": "clean professional markdown message...",
  "recommendedItemIds": ["array of item ids if recommending food"],
  "suggestions": ["suggested chip 1", "suggested chip 2", "suggested chip 3"],
  "action": null or {"type": "add_to_cart", "itemId": "item_id", "quantity": 1} or {"type": "connect_support"}
}`;

        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sysContext }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });

        if (gRes.ok) {
          const gData = await gRes.json();
          const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            const recs = (parsed.recommendedItemIds || []).map(id => menuItems.find(i => i.id === id)).filter(Boolean);
            return res.json({
              reply: parsed.reply,
              recommendedItems: recs,
              suggestions: parsed.suggestions || ['💬 Connect with Live Agent', '📞 Call 0760130922', '🌶️ Spicy Dishes'],
              action: parsed.action || null
            });
          }
        }
      } catch (gErr) {
        console.warn('[GastroAI Gemini Fallback to Intent Engine]', gErr.message);
      }
    }

    let reply = '';
    let recommendedItems = [];
    let suggestions = [];
    let action = null;

    // Parse customer JWT token for security verification
    let authedCustomer = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.verify(token, process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET);
        authedCustomer = decoded;
      } catch (_) {}
    }

    const orderIdMatch = msg.match(/ord_[a-zA-Z0-9_]+/i);

    // Detect Support, Career, Contact & Customer Care Intent (including typos like "conductcareer")
    const isSupportOrCareer = /conductcareer|career|job|work|hire|support|contact|care|agent|human|manager|help|complain|issue|problem|cold|late|wrong|bad|delay|refund|mistake|කවුරුත්|අවුල|ගැටලුව|பிரச்சனை/i.test(msg);
    if (isSupportOrCareer) {
      const ticketId = `tkt_${Date.now()}`;
      const waText = encodeURIComponent(`Hi GastroFlow Support, I need assistance (Ticket #${ticketId}): "${message}"`);
      const waLink = `https://wa.me/94760130922?text=${waText}`;

      if (msg.includes('career') || msg.includes('job') || msg.includes('work') || msg.includes('conductcareer') || msg.includes('hire')) {
        reply = `💼 **GastroFlow Careers & Recruitment Desk**\n\n` +
          `Thank you for your interest in joining the **${storeName}** team!\n\n` +
          `We are always looking for passionate chefs, service staff, and delivery partners.\n\n` +
          `📞 **Direct Contact Options**:\n` +
          `• Call HR / Manager: **+94 76 013 0922**\n` +
          `• WhatsApp HR: [Chat on WhatsApp](${waLink})\n` +
          `• Email: **gastroflowadmin@gmail.com**\n\n` +
          `You can also open a support inquiry below so our manager receives your details immediately!`;
        suggestions = ['💬 Connect with Live Agent', '📞 Call 0760130922', '📲 WhatsApp Support', '🍽️ Browse Menu'];
        return res.json({ reply, recommendedItems: [], suggestions, action: { type: 'connect_support' } });
      }

      reply = `🎧 **GastroFlow Customer Support Desk**\n\n` +
        `I am here to assist you right away!\n\n` +
        `Our Store Manager & POS Support Team are available to help you.\n\n` +
        `📞 **Contact Options**:\n` +
        `• Call Support Hotline: **+94 76 013 0922**\n` +
        `• WhatsApp Manager: [Chat on WhatsApp](${waLink})\n` +
        `• Email Support: **gastroflowadmin@gmail.com**\n\n` +
        `Select an option below to connect with live support or track your order:`;
      suggestions = ['💬 Connect with Live Agent', '📞 Call 0760130922', '📲 WhatsApp Support', '🔍 Track Order Status'];
      return res.json({ reply, recommendedItems: [], suggestions, action: { type: 'connect_support' } });
    }

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

      // 🔒 Security Guard: Check order ownership (authenticated customer OR matching phone/email)
      const isOwner = authedCustomer && (
        order.customer_id === authedCustomer.id ||
        order.customerId === authedCustomer.id ||
        (order.customerPhone && authedCustomer.phone && normalizeLkPhone(order.customerPhone) === normalizeLkPhone(authedCustomer.phone)) ||
        (order.customerEmail && authedCustomer.email && order.customerEmail.toLowerCase() === authedCustomer.email.toLowerCase())
      );

      if (!authedCustomer) {
        reply = `🔒 **Security Verification Required**:\n\n` +
          `Please **Sign In to your account** before requesting order cancellation so we can verify your identity.`;
        suggestions = ['🔑 Sign In Now', '📞 Call Restaurant Manager'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      }

      if (!isOwner) {
        reply = `🔒 **Security Alert**: You are not authorized to cancel order #${targetId}.\n\n` +
          `For security and privacy, customers can only cancel orders placed from their own verified account.`;
        suggestions = ['📞 Call Store Manager', '💬 WhatsApp Support'];
        return res.json({ reply, recommendedItems: [], suggestions, action: null });
      }

      if (order.status === 'pending' || order.status === 'hold') {
        await dbRun("UPDATE orders SET status = 'cancelled' WHERE id = ?", [targetId]);
        const items = await dbAll('SELECT itemId, quantity FROM order_items WHERE orderId = ?', [targetId]);
        for (const it of items) {
          await dbRun('UPDATE menu_items SET stock = stock + ? WHERE id = ?', [it.quantity, it.itemId]);
        }
        await writeAuditLog(authedCustomer.id, 'customer', 'cancel_order_bot', `Cancelled order ${targetId} via AI Concierge`);

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
    const tenantId = req.tenantId || 'default_tenant';
    const orders = await dbAll(
      `SELECT * FROM orders WHERE tenant_id = ? ORDER BY timestamp DESC`,
      [tenantId]
    );
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

async function syncAllRealCustomersToCrm(tenantId) {
  try {
    const tid = tenantId || 'tenant_kb2c';

    // 1. Sync from registered customer_accounts
    const accounts = await dbAll(`SELECT id, name, phone, email, loyaltyPoints, totalSpent FROM customer_accounts`);
    if (accounts && accounts.length > 0) {
      for (const acc of accounts) {
        const cleanPhone = acc.phone ? acc.phone.trim() : '';
        const cleanEmail = acc.email ? acc.email.trim().toLowerCase() : '';
        if (!cleanPhone && !cleanEmail && !acc.id) continue;

        const existing = await dbGet(
          `SELECT id FROM customers WHERE id = ? OR (phone = ? AND phone != '') OR (email = ? AND email != '')`,
          [acc.id, cleanPhone, cleanEmail]
        );

        if (existing) {
          await dbRun(
            `UPDATE customers SET tenant_id = COALESCE(tenant_id, ?), name = COALESCE(?, name), phone = CASE WHEN ? != '' THEN ? ELSE phone END, email = CASE WHEN ? != '' THEN ? ELSE email END, points = MAX(COALESCE(points, 0), ?) WHERE id = ?`,
            [tid, acc.name, cleanPhone, cleanPhone, cleanEmail, cleanEmail, acc.loyaltyPoints || 0, existing.id]
          );
        } else {
          await dbRun(
            `INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
            [acc.id || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, acc.name || 'Online Customer', cleanPhone, cleanEmail, acc.loyaltyPoints || 0, acc.totalSpent || 0, tid]
          );
        }
      }
    }

    // 2. Sync from actual orders (real customer orders)
    const orderStats = await dbAll(
      `SELECT 
         customerPhone, 
         MAX(customerName) as customerName, 
         MAX(customerEmail) as customerEmail, 
         COUNT(*) as realOrderCount, 
         SUM(total) as realTotalSpent 
       FROM orders 
       WHERE customerPhone IS NOT NULL AND customerPhone != '' 
       GROUP BY customerPhone`
    );

    if (orderStats && orderStats.length > 0) {
      for (const stat of orderStats) {
        const cleanPhone = stat.customerPhone.trim();
        const cleanName = stat.customerName ? stat.customerName.trim() : 'Customer';
        const cleanEmail = stat.customerEmail ? stat.customerEmail.trim().toLowerCase() : '';

        const existing = await dbGet(
          `SELECT id FROM customers WHERE phone = ?`,
          [cleanPhone]
        );

        if (existing) {
          await dbRun(
            `UPDATE customers SET tenant_id = COALESCE(tenant_id, ?), orderCount = ?, totalSpent = ?, name = COALESCE(?, name), email = CASE WHEN ? != '' THEN ? ELSE email END WHERE id = ?`,
            [tid, stat.realOrderCount, stat.realTotalSpent || 0, cleanName, cleanEmail, cleanEmail, existing.id]
          );
        } else {
          await dbRun(
            `INSERT INTO customers (id, name, phone, email, points, orderCount, totalSpent, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [`cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, cleanName, cleanPhone, cleanEmail, Math.floor((stat.realTotalSpent || 0) / 10), stat.realOrderCount, stat.realTotalSpent || 0, tid]
          );
        }
      }
    }
  } catch (err) {
    console.error('Customer CRM sync error:', err.message);
  }
}

// GET /api/customers — Fetch real customers list for Customers & Loyalty view (joins online customer accounts & order history)
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    await syncAllRealCustomersToCrm(tenantId);

    const customers = await dbAll(
      `SELECT * FROM customers WHERE tenant_id = ? ORDER BY totalSpent DESC, name ASC`,
      [tenantId]
    );
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

app.delete('/api/users/:id', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  try {
    const target = await dbGet('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    if (req.user.role !== 'owner' && target.role === 'owner') {
      return res.status(403).json({ error: 'Only an owner can delete another owner account.' });
    }
    await dbRun('DELETE FROM users WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
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
      process.env.JWT_SECRET || JWT_SECRET,
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

// POST /api/orders/:id/eta — Staff update delivery/prep ETA
app.post('/api/orders/:id/eta', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { etaMinutes } = req.body || {};
  const minutes = parseInt(etaMinutes, 10) || 20;
  try {
    const order = await dbGet('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    await dbRun('UPDATE orders SET etaMinutes = ? WHERE id = ?', [minutes, id]);
    broadcastEvent('order_updated', {
      orderId: id,
      status: order.status,
      etaMinutes: minutes,
      message: `Order #${id} ETA updated to ${minutes} mins`
    });
    await writeAuditLog(req.user.id, req.user.username, 'update_eta', `Updated ETA for order #${id} to ${minutes} mins`);
    res.json({ success: true, orderId: id, etaMinutes: minutes });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/orders/:id/eta — Customer read live ETA
app.get('/api/public/orders/:id/eta', async (req, res) => {
  const { id } = req.params;
  try {
    const order = await dbGet('SELECT id, status, timestamp, etaMinutes, orderType, diningType FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (order.etaMinutes) {
      return res.json({
        estimatedMinutes: order.etaMinutes,
        isManual: true,
        orderType: order.orderType || order.diningType || 'takeaway'
      });
    }
    // Dynamic calculation fallback
    const activeCount = await dbGet("SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')");
    const count = activeCount?.count || 0;
    const basePrep = 15;
    const loadBuffer = Math.min(count * 3, 30);
    const totalEst = basePrep + loadBuffer;
    res.json({
      estimatedMinutes: totalEst,
      maxItemPrep: basePrep,
      kitchenLoadBuffer: loadBuffer,
      orderType: order.orderType || order.diningType || 'takeaway'
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── SUPPORT & COMPLAINT TICKETS ENDPOINTS ──
app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    const tickets = await dbAll('SELECT * FROM support_tickets WHERE tenant_id = ? ORDER BY createdAt DESC', [req.tenantId]);
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
    const dbTenants = await dbAll("SELECT id, name, status FROM tenants WHERE status = 'active'");
    const mainStoreName = await getSettingAny('default_tenant', ['restaurantName', 'businessName'], 'GastroFlow Bistro Main');

    // Real system outlets list initialized from actual database tenant settings & records
    const realStoresMap = new Map();

    // 1. Primary DB tenant
    realStoresMap.set('default_tenant', {
      id: 'default_tenant',
      name: mainStoreName,
      cuisine: 'Sri Lankan & Western Fusion Grill',
      emoji: '🍕',
      rating: 4.9,
      ratingCount: 340,
      deliveryTime: '20-30 min',
      deliveryFee: 150,
      minOrder: 1000,
      cuisineTag: 'pizza',
      location: 'Colombo 03',
      lat: 6.9147,
      lng: 79.8517,
      deliveryRadiusKm: 15,
      isOpen: true,
      bannerGradient: 'linear-gradient(135deg, #ff6b35 0%, #d97706 100%)',
      promoBadge: '20% OFF'
    });

    // 2. Additional real active DB tenants from tenants table
    if (dbTenants && dbTenants.length > 0) {
      for (const t of dbTenants) {
        if (t.id && !realStoresMap.has(t.id)) {
          realStoresMap.set(t.id, {
            id: t.id,
            name: t.name || 'GastroFlow Outlet',
            cuisine: 'Authentic Sri Lankan & Multi-Cuisine',
            emoji: '🏬',
            rating: 4.8,
            ratingCount: 180,
            deliveryTime: '25-35 min',
            deliveryFee: 150,
            minOrder: 1000,
            cuisineTag: 'srilankan',
            location: 'Colombo',
            lat: 6.9080,
            lng: 79.8655,
            deliveryRadiusKm: 15,
            isOpen: true,
            bannerGradient: 'linear-gradient(135deg, #059669 0%, #047857 100%)'
          });
        }
      }
    }

    let finalStores = Array.from(realStoresMap.values());

    // Calculate dynamic distance, fee & recommendation scores if user coordinates provided
    const uLat = parseFloat(req.query.lat);
    const uLng = parseFloat(req.query.lng);

    if (!isNaN(uLat) && !isNaN(uLng)) {
      const R = 6371;
      finalStores = finalStores.map(s => {
        const dLat = (s.lat - uLat) * Math.PI / 180;
        const dLon = (s.lng - uLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(uLat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const dist = Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
        const inRange = dist <= (s.deliveryRadiusKm || 15);
        const fee = inRange ? Math.max(80, Math.round(100 + dist * 25)) : 250;
        const minEta = Math.round(15 + dist * 3);
        const maxEta = Math.round(25 + dist * 4);
        const recScore = Number(((100 - dist * 2) + (s.rating * 10) + (s.promoBadge ? 15 : 0)).toFixed(1));

        return {
          ...s,
          distanceKm: dist,
          isDeliverable: inRange,
          deliveryFee: fee,
          deliveryTime: `${minEta}-${maxEta} min`,
          recommendationScore: recScore
        };
      });

      finalStores.sort((a, b) => b.recommendationScore - a.recommendationScore);
    }

    res.json(finalStores);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/public/restaurants/register — Onboard a new Restaurant / BBQ Shop tenant
app.post('/api/public/restaurants/register', publicApiLimiter, async (req, res) => {
  const { name, ownerEmail, phone, cuisine, address, password } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Restaurant name is required.' });
  if (!ownerEmail || !ownerEmail.includes('@')) return res.status(400).json({ error: 'Valid owner email is required.' });

  const cleanName = name.trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const tenantId = `tenant_${slug}_${Date.now().toString(36)}`;
  const cleanPhone = phone ? phone.trim().replace(/[\s-]/g, '') : '';

  try {
    // 1. Create tenant record
    await dbRun(
      `INSERT INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt)
       VALUES (?, ?, ?, ?, 'pro', 'active', ?)`,
      [tenantId, cleanName, slug, ownerEmail.trim().toLowerCase(), Date.now()]
    );

    // 2. Seed business settings for this tenant
    const defaultSettings = [
      { key: 'businessName', value: cleanName },
      { key: 'currencySymbol', value: 'Rs.' },
      { key: 'taxRate', value: '10' },
      { key: 'serviceChargeRate', value: '10' },
      { key: 'address', value: address || 'Colombo, Sri Lanka' },
      { key: 'phone', value: cleanPhone || '+94 77 123 4567' }
    ];
    for (const set of defaultSettings) {
      await dbRun('INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tenantId, set.key, set.value]);
    }

    // 3. Seed BBQ / Specialty Categories & Menu Items
    const defaultCats = [
      { id: `cat_grills_${Date.now()}`, name: '🔥 BBQ Grills & Smoked Meats', emoji: '🥩' },
      { id: `cat_burgers_${Date.now()}`, name: '🍔 Burgers & Ribs', emoji: '🍔' },
      { id: `cat_sides_${Date.now()}`, name: '🍟 Sides & Salads', emoji: '🍟' },
      { id: `cat_drinks_${Date.now()}`, name: '🍹 Cold Beverages', emoji: '🍹' }
    ];
    for (const cat of defaultCats) {
      await dbRun('INSERT INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?)', [cat.id, cat.name, cat.emoji, tenantId]);
    }

    const defaultItems = [
      { id: `itm_ribs_${Date.now()}`, name: 'Smoked Pork Ribs (Half Rack)', price: 3450, category: defaultCats[0].id, emoji: '🍖', stock: 30, description: 'Slow-smoked over hickory wood with signature BBQ glaze.' },
      { id: `itm_brisket_${Date.now()}`, name: 'Hickory Smoked Beef Brisket', price: 3950, category: defaultCats[0].id, emoji: '🥩', stock: 25, description: '12-hour low and slow smoked beef brisket sliced tender.' },
      { id: `itm_wings_${Date.now()}`, name: 'Honey BBQ Chicken Wings (8pcs)', price: 1850, category: defaultCats[0].id, emoji: '🍗', stock: 50, description: 'Crispy fried wings tossed in sweet & smoky honey BBQ sauce.' },
      { id: `itm_burger_${Date.now()}`, name: 'Double Bacon BBQ Cheeseburger', price: 2250, category: defaultCats[1].id, emoji: '🍔', stock: 40, description: 'Double smash patty with sharp cheddar, crispy bacon, and BBQ sauce.' }
    ];
    for (const item of defaultItems) {
      await dbRun(
        `INSERT INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, tenant_id, isAvailable)
         VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?, ?, 1)`,
        [item.id, item.name, item.price, item.price * 0.4, item.category, item.emoji, item.stock, item.description, tenantId]
      );
    }

    // 4. Create owner staff user account for POS login
    const username = ownerEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const userPass = password || generateStrongPassword(10);
    const passwordHash = await bcrypt.hash(userPass, 10);
    const userId = `usr_${Date.now()}`;
    await dbRun(
      `INSERT INTO users (id, username, passwordHash, role, pin, tenant_id, email, phone)
       VALUES (?, ?, ?, 'owner', '1234', ?, ?, ?)`,
      [userId, username, passwordHash, tenantId, ownerEmail.trim().toLowerCase(), cleanPhone]
    );

    res.status(201).json({
      success: true,
      message: `🎉 ${cleanName} onboarded successfully!`,
      tenant: {
        id: tenantId,
        name: cleanName,
        slug,
        ownerEmail,
        staffUsername: username,
        temporaryPassword: userPass,
        posUrl: `/?tenant=${tenantId}`,
        storefrontUrl: `/?tenant=${tenantId}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/saas/tenants — Provision New SaaS Tenant Subdomain
app.post('/api/saas/tenants', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { name, subdomain, ownerEmail, plan = 'pro' } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Restaurant Tenant Name is required.' });
  if (!subdomain || !subdomain.trim()) return res.status(400).json({ error: 'Subdomain Slug is required.' });
  if (!ownerEmail || !ownerEmail.includes('@')) return res.status(400).json({ error: 'Valid Owner Contact Email is required.' });

  const cleanName = name.trim();
  const slug = subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const tenantId = `tenant_${slug}_${Date.now().toString(36)}`;

  try {
    // Check if subdomain already exists
    const existing = await dbGet('SELECT id FROM tenants WHERE subdomain = ?', [slug]);
    if (existing) return res.status(400).json({ error: `Subdomain "${slug}" is already taken.` });

    // 1. Insert into tenants table
    await dbRun(
      `INSERT INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [tenantId, cleanName, slug, ownerEmail.trim().toLowerCase(), plan, Date.now()]
    );

    // 2. Seed default business settings for this tenant
    const defaultSettings = [
      { key: 'businessName', value: cleanName },
      { key: 'currencySymbol', value: 'Rs.' },
      { key: 'taxRate', value: '10' },
      { key: 'serviceChargeRate', value: '10' },
      { key: 'address', value: 'Colombo, Sri Lanka' }
    ];
    for (const set of defaultSettings) {
      await dbRun('INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)', [tenantId, set.key, set.value]);
    }

    // 3. Seed default Categories & Menu Items
    const defaultCats = [
      { id: `cat_main_${Date.now()}`, name: '🍽️ Signature Specials', emoji: '🍕' },
      { id: `cat_drink_${Date.now()}`, name: '🍹 Refreshing Drinks', emoji: '🍹' }
    ];
    for (const cat of defaultCats) {
      await dbRun('INSERT INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?)', [cat.id, cat.name, cat.emoji, tenantId]);
    }

    const defaultItems = [
      { id: `itm_special_${Date.now()}`, name: `${cleanName} Special Grill`, price: 2450, category: defaultCats[0].id, emoji: '🥩', stock: 50, description: 'Chef special house grill platter.' },
      { id: `itm_beverage_${Date.now()}`, name: 'Fresh Tropical Punch', price: 450, category: defaultCats[1].id, emoji: '🍹', stock: 100, description: 'Chilled fresh fruit blend.' }
    ];
    for (const item of defaultItems) {
      await dbRun(
        `INSERT INTO menu_items (id, name, price, cost, category, emoji, stock, minStock, description, tenant_id, isAvailable)
         VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?, ?, 1)`,
        [item.id, item.name, item.price, item.price * 0.4, item.category, item.emoji, item.stock, item.description, tenantId]
      );
    }

    // 4. Create owner staff user account for POS login
    const username = ownerEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const userPass = generateStrongPassword(10);
    const passwordHash = await bcrypt.hash(userPass, 10);
    const userId = `usr_${Date.now()}`;
    await dbRun(
      `INSERT INTO users (id, username, passwordHash, role, pin, tenant_id, email)
       VALUES (?, ?, ?, 'owner', '1234', ?, ?)`,
      [userId, username, passwordHash, tenantId, ownerEmail.trim().toLowerCase()]
    );

    res.status(201).json({
      success: true,
      message: `🎉 Tenant "${cleanName}" provisioned successfully at ${slug}.gastroflow.lk!`,
      tenant: {
        id: tenantId,
        name: cleanName,
        subdomain: slug,
        ownerEmail,
        plan,
        staffUsername: username,
        temporaryPassword: userPass,
        posUrl: `/?tenant=${tenantId}`,
        customerUrl: `/customer/?tenant=${tenantId}`,
        driverUrl: `/driver-app/?tenant=${tenantId}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/saas/tenants — List all provisioned SaaS tenant shops
app.get('/api/saas/tenants', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const tenants = await dbAll('SELECT id, name, subdomain, ownerEmail, plan, status, createdAt FROM tenants ORDER BY createdAt DESC');
    const result = (tenants || []).map(t => ({
      ...t,
      posUrl: `/?tenant=${t.id}`,
      customerUrl: `/customer/?tenant=${t.id}`,
      driverUrl: `/driver-app/?tenant=${t.id}`
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/saas/tenants/:id — Delete store and wipe all its data
app.delete('/api/saas/tenants/:id', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  if (!id || id === 'default_tenant') {
    return res.status(400).json({ error: 'Cannot delete the main default tenant store.' });
  }

  try {
    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ? OR subdomain = ?', [id, id]);
    if (!tenant) return res.status(404).json({ error: 'Tenant store not found.' });

    const targetId = tenant.id;

    // Real-time SSE alert: instantly notify all open POS/Customer sessions of this tenant
    notifyPOS({ type: 'tenant_deleted', tenantId: targetId, storeName: tenant.name }, targetId);
    notifyPublicStore({ type: 'tenant_deleted', tenantId: targetId, storeName: tenant.name }, targetId);

    // Delete tenant record
    await dbRun('DELETE FROM tenants WHERE id = ?', [targetId]);

    // Wipe all tenant-scoped data
    const tenantTables = [
      'users', 'orders', 'order_items', 'menu_items', 'tables', 'ingredients', 'customers',
      'categories', 'modifiers', 'recipes', 'shifts', 'cash_movements',
      'feedbacks', 'promotions', 'customer_accounts', 'drivers', 'settings'
    ];
    for (const tbl of tenantTables) {
      try {
        await dbRun(`DELETE FROM ${tbl} WHERE tenant_id = ?`, [targetId]);
      } catch (_) {}
    }

    res.json({ success: true, message: `🗑️ Tenant store "${tenant.name}" (${tenant.subdomain}) deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/saas/tenants/:id/status — Toggle active / suspended status
app.patch('/api/saas/tenants/:id/status', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status || !['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Valid status ("active" or "suspended") is required.' });
  }

  try {
    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ? OR subdomain = ?', [id, id]);
    if (!tenant) return res.status(404).json({ error: 'Tenant store not found.' });

    const targetId = tenant.id;
    await dbRun('UPDATE tenants SET status = ? WHERE id = ?', [status, targetId]);

    // Real-time SSE alert: instantly notify all open POS/Customer sessions of this tenant
    notifyPOS({ type: 'tenant_status_changed', status, tenantId: targetId, storeName: tenant.name }, targetId);
    notifyPublicStore({ type: 'tenant_status_changed', status, tenantId: targetId, storeName: tenant.name }, targetId);

    res.json({ success: true, message: `Store "${tenant.name}" status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/tenant/status - Check if a tenant store exists and is active
app.get('/api/public/tenant/status', publicApiLimiter, async (req, res) => {
  try {
    const raw = req.query.tenant || req.query.tenantId || req.headers['x-tenant-id'] || 'default_tenant';
    let target = String(raw).trim();
    if (target === 'kb2c') target = 'tenant_kb2c';
    const tenant = await dbGet('SELECT id, name, subdomain, status FROM tenants WHERE id = ? OR subdomain = ?', [target, target]);
    if (!tenant) {
      return res.status(404).json({ exists: false, error: 'Store not found or has been deleted.', code: 'TENANT_DELETED' });
    }
    res.json({
      exists: true,
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/menu — Alias for /api/menu_items for POS menu syncing
app.get('/api/menu', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    const rows = await dbAll(
      `SELECT * FROM menu_items WHERE tenant_id = ?`,
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/public/menu
app.get('/api/public/menu', publicApiLimiter, async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const categories = await dbAll(
      `SELECT id, name, emoji FROM categories WHERE tenant_id = ? ORDER BY name`,
      [tenantId]
    );
    const items = await dbAll(
      `SELECT id, name, price, category, emoji, stock, description, dietaryTags, imageUrl, isAvailable FROM menu_items
       WHERE (isAvailable = 1 OR isAvailable IS NULL) AND tenant_id = ? ORDER BY name`,
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

    const st = await getSettingsMap(tenantId, ['restaurantName', 'businessName', 'logo', 'storeOpen', 'defaultPrepTime', 'deliveryFee', 'minimumOrder', 'currencySymbol', 'phone', 'address']);

    res.json({
      tenantId,
      restaurantName: st.restaurantName || st.businessName || 'GastroFlow Bistro',
      storePhone: st.phone || '0752237947',
      address: st.address || 'Sri Lanka',
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
        const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET;
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
        // Atomic stock reduction for menu item (safe non-blocking update)
        await dbRun('UPDATE menu_items SET stock = MAX(0, COALESCE(stock, 100) - ?) WHERE id = ?', [item.quantity, item.id]);

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
    payload = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
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

// Note: otpLimiter defined at boot (max:3/10min, BUG-008). Removed duplicate declaration here.

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
      process.env.JWT_SECRET || JWT_SECRET,
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
    await writeAuditLog(reset.userId, 'customer', 'password_reset_confirmed', 'Password reset successfully');
    res.json({ ok: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── Customer Support Desk Tickets Endpoints ──────────────────────────────
app.post('/api/public/support/tickets', async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const { orderId, name, phone, email, issueCategory = 'general', message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message text is required.' });
    }

    const ticketId = `tkt_${Date.now()}`;
    await dbRun(
      `INSERT INTO support_tickets (id, tenant_id, orderId, customerName, customerPhone, customerEmail, issueCategory, message, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [ticketId, tenantId, orderId || null, name || 'Customer', phone || null, email || null, issueCategory, String(message).trim(), Date.now()]
    );

    // Notify POS stream in real-time
    notifyPOS({
      type: 'support_ticket_escalated',
      ticketId,
      orderId,
      customerName: name,
      message,
      timestamp: Date.now()
    }, tenantId);

    const business = await getSettingAny(tenantId, ['businessName', 'restaurantName'], 'GastroFlow Bistro');
    const waText = encodeURIComponent(`🚨 URGENT CUSTOMER TICKET #${ticketId} (${business}): ${message} (Order: ${orderId || 'N/A'})`);

    res.json({
      success: true,
      ticketId,
      message: `Support ticket #${ticketId} created successfully. Our manager has been notified.`,
      whatsappUrl: `https://wa.me/94112345678?text=${waText}`
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.get('/api/public/support/tickets', async (req, res) => {
  try {
    const tenantId = await resolvePublicTenant(req);
    const { phone, email } = req.query;
    let query = 'SELECT * FROM support_tickets WHERE tenant_id = ?';
    const params = [tenantId];
    if (phone) {
      query += ' AND (customerPhone = ? OR customerPhone = ?)';
      params.push(phone, normalizeLkPhone(phone));
    } else if (email) {
      query += ' AND LOWER(customerEmail) = ?';
      params.push(String(email).toLowerCase());
    } else {
      query += ' AND 1=1';
    }
    query += ' ORDER BY createdAt DESC LIMIT 20';
    const tickets = await dbAll(query, params);
    res.json(tickets || []);
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
app.post('/api/public/payment/payhere/hash', publicApiLimiter, async (req, res) => {
  try {
    const { orderId, currency = 'LKR' } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const tenantId = await resolvePublicTenant(req);
    const order = await dbGet('SELECT id, total FROM orders WHERE id = ? AND tenant_id = ?', [orderId, tenantId]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const merchantId = process.env.PAYHERE_MERCHANT_ID;
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
    if (!merchantId || !merchantSecret) return res.status(503).json({ error: 'Online payments are not configured.' });
    const formattedAmount = Number(order.total).toFixed(2);

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

    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
    if (!merchantSecret) return res.status(503).send('Payment gateway is not configured');
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

if (fs.existsSync(customerDistPath)) {
  app.use('/customer', express.static(customerDistPath));
}
if (fs.existsSync(driverDistPath)) {
  app.use('/driver-app', express.static(driverDistPath));
}
if (fs.existsSync(posDistPath)) {
  app.use(express.static(posDistPath));
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

// GET /api/tables/:id/qr — Table QR code URL & Printable PNG Image resolution
app.get('/api/tables/:id/qr', publicApiLimiter, async (req, res) => {
  try {
    const tableId = req.params.id;
    const tenantId = req.query.tenant || 'default_tenant';
    const table = await dbGet('SELECT * FROM tables WHERE id = ? AND tenant_id = ?', [tableId, tenantId]);
    if (!table) return res.status(404).json({ error: 'Table not found.' });

    const host = req.headers.host || 'localhost:3000';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = process.env.CUSTOMER_APP_URL || `${protocol}://${host}/customer`;
    const qrUrl = `${baseUrl}/?table=${table.number}&tenant=${tenantId}`;

    let qrcodeDataUri = null;
    try {
      const QRCode = (await import('qrcode')).default;
      qrcodeDataUri = await QRCode.toDataURL(qrUrl, { margin: 2, width: 300 });
    } catch (e) {
      console.warn('QRCode generation fallback:', e.message);
    }

    res.json({ tableId: table.id, number: table.number, qrUrl, qrcodeDataUri });
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

// 2. Category Routes
app.get('/api/categories', async (req, res) => {
  try {
    const tid = req.tenantId || 'default_tenant';
    let rows = await dbAll('SELECT * FROM categories WHERE tenant_id = ?', [tid]);
    if (!rows || rows.length === 0) {
      await seedDatabase(tid);
      rows = await dbAll('SELECT * FROM categories WHERE tenant_id = ?', [tid]);
    }
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/categories', requireRole(['owner', 'manager']), async (req, res) => {
  const { id, name, emoji } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Category name is required.' });
  const tid = req.tenantId || 'default_tenant';
  const catId = id || `cat_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  const catEmoji = emoji || '🍛';

  try {
    const existing = await dbGet('SELECT id FROM categories WHERE id = ? AND tenant_id = ?', [catId, tid]);
    if (existing) {
      await dbRun('UPDATE categories SET name = ?, emoji = ? WHERE id = ? AND tenant_id = ?', [name, catEmoji, catId, tid]);
    } else {
      await dbRun('INSERT INTO categories (id, name, emoji, tenant_id) VALUES (?, ?, ?, ?)', [catId, name, catEmoji, tid]);
    }
    await writeAuditLog(req.user.id, req.user.username, 'save_category', `Saved category ${name} (${catId})`);
    res.json({ id: catId, name, emoji: catEmoji, tenant_id: tid });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.delete('/api/categories/:id', requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  try {
    const tid = req.tenantId || 'default_tenant';
    await dbRun('DELETE FROM categories WHERE id = ? AND tenant_id = ?', [id, tid]);
    await writeAuditLog(req.user.id, req.user.username, 'delete_category', `Deleted category ${id}`);
    res.json({ success: true, id });
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
  const {
    id, name, price, cost, category, emoji, stock, minStock,
    description, imageUrl, dietaryTags, allergens, isAvailable,
    spiceLevel, isHalal, preparationTime, portionSize
  } = req.body;
  try {
    const prevRow = await dbGet('SELECT isAvailable FROM menu_items WHERE id = ?', [id]);
    const prevAvail = prevRow?.isAvailable;
    const newAvail = isAvailable !== undefined ? parseInt(isAvailable, 10) : 1;
    const halalVal = isHalal ? 1 : 0;

    await dbRun(`
      INSERT OR REPLACE INTO menu_items
        (id, name, price, cost, category, emoji, stock, minStock, description,
         imageUrl, dietaryTags, allergens, isAvailable,
         spiceLevel, isHalal, preparationTime, portionSize, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, name, price, cost, category, emoji,
      parseInt(stock) || 0, parseInt(minStock) || 0, description,
      imageUrl || null, dietaryTags || null, allergens || null, newAvail,
      parseInt(spiceLevel) || 0, halalVal,
      parseInt(preparationTime) || 0, portionSize || null,
      req.tenantId
    ]);
    await writeAuditLog(req.user.id, req.user.username, 'save_menu_item',
      `Created/updated menu item ${name} (${id}) — price=${price}, stock=${stock}, halal=${halalVal}`);
    const saved = {
      id, name, price, cost, category, emoji, stock, minStock, description,
      imageUrl, dietaryTags, allergens, isAvailable: newAvail,
      spiceLevel, isHalal: halalVal, preparationTime, portionSize
    };
    res.json(saved);

    // Push live availability update to customer app and POS screens
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
      const generatedPin = ownerPin || generateSecurePin();
      const pinHash = await bcrypt.hash(String(generatedPin), 10);
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
          pin: ownerPin ? '(as provided)' : generatedPin,
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

app.post('/api/orders', authenticateToken, async (req, res) => {
  const {
    id, tableId, diningType, customerId, items,
    discountType, discountValue, status, timestamp,
    paymentMethod, paymentTimestamp, paymentSplit, tip,
    promoCode, managerPin
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Order ID is required.' });
  }

  const userId = req.user?.id || 'usr_pos';
  const username = req.user?.username || 'pos_user';
  const tenantId = req.tenantId || 'tenant_kb2c';

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
          await writeAuditLog(userId, username, 'cancel_order', `Cancelled order ${id}`);
        }

        if (newStatus === 'paid' && oldStatus !== 'paid') {
          // Free table
          if (existingOrder.tableId) {
            await dbRun('UPDATE tables SET status = "free", currentOrderId = NULL WHERE id = ?', [existingOrder.tableId]);
          }
          const earnedPoints = Math.floor((existingOrder.total || 0) / 10);
          // Loyalty points accrual (Walk-in customer)
          if (existingOrder.customerId) {
            await dbRun(`
              UPDATE customers 
              SET points = COALESCE(points, 0) + ?, orderCount = COALESCE(orderCount, 0) + 1, totalSpent = COALESCE(totalSpent, 0) + ? 
              WHERE id = ?
            `, [earnedPoints, existingOrder.total || 0, existingOrder.customerId]);
          }
          // Loyalty points accrual (Registered online customer account)
          if (existingOrder.customerAccountId) {
            await dbRun(`
              UPDATE customer_accounts
              SET loyaltyPoints = COALESCE(loyaltyPoints, 0) + ?, totalSpent = COALESCE(totalSpent, 0) + ?
              WHERE id = ?
            `, [earnedPoints, existingOrder.total || 0, existingOrder.customerAccountId]);
          }
          // Assign a gapless fiscal invoice number exactly once, at settlement.
          if (!existingOrder.invoiceNumber) {
            const invoiceNumber = await allocateInvoiceNumber();
            await dbRun('UPDATE orders SET invoiceNumber = ? WHERE id = ?', [invoiceNumber, id]);
          }
          await writeAuditLog(userId, username, 'pay_order', `Completed settlement for order ${id} via ${paymentMethod || 'cash'}`);
        }

        // Update orders table
        await dbRun(`
          UPDATE orders 
          SET status = ?, paymentMethod = ?, paymentTimestamp = ?, paymentSplit = ?, tip = COALESCE(?, tip), tenant_id = COALESCE(tenant_id, ?)
          WHERE id = ?
        `, [
          newStatus, 
          paymentMethod || existingOrder.paymentMethod, 
          paymentTimestamp || existingOrder.paymentTimestamp || Date.now(),
          paymentSplit ? JSON.stringify(paymentSplit) : existingOrder.paymentSplit,
          tip !== undefined ? parseFloat(tip) : null,
          tenantId,
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
      const userRole = req.user?.role || 'owner';
      if (hasDiscount && userRole !== 'owner' && userRole !== 'manager') {
        if (!managerPin) {
          return res.status(403).json({ error: 'Discount requires a manager PIN override.' });
        }
        // Verify manager PIN
        const managers = await dbAll('SELECT pin FROM users WHERE role IN ("owner", "manager")');
        let pinVerified = false;
        for (const mgr of managers) {
          if (mgr.pin === managerPin) {
            pinVerified = true;
            break;
          }
          try {
            const match = await bcrypt.compare(managerPin, mgr.pin);
            if (match) {
              pinVerified = true;
              break;
            }
          } catch (_) {}
        }
        if (!pinVerified) {
          return res.status(403).json({ error: 'Invalid or unauthorized manager PIN for discount.' });
        }
      }

      // 2. Calculate billing totals on the server using unified billing helper
      const bill = await resolveAndCalculateBill(items, discountType, discountValue, 0, tip, promoCode, 0, tenantId);

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
          bill.serviceCharge, bill.tip, bill.roundedAmount, userId, bill.promoDiscount, tenantId
        ]);

        // Insert items into order_items & update menu item stock
        for (const item of bill.resolvedItems) {
          const orderItemId = `ord_itm_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          await dbRun(`
            INSERT INTO order_items (id, orderId, menuItemId, name, price, quantity, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [orderItemId, id, item.id, item.name, item.unitPrice, item.quantity, item.notes || '']);

          // Atomic conditional stock check and update
          await dbRun('UPDATE menu_items SET stock = MAX(0, stock - ?) WHERE id = ?', [item.quantity, item.id]);
        }

        // Update table status if dine-in
        if (diningType === 'dine-in' && tableId) {
          const newTableStatus = (status === 'hold') ? 'billing' : 'occupied';
          await dbRun('UPDATE tables SET status = ?, currentOrderId = ? WHERE id = ?', [newTableStatus, id, tableId]);
        }

        await writeAuditLog(userId, username, 'create_order', `Created order ${id} with total ${bill.total}`);
        if (bill.totalDiscount > 0) {
          await writeAuditLog(userId, username, 'apply_discount', `Discount of ${bill.totalDiscount} applied to order ${id}`);
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

// ── Multi-Branch Central Kitchen & Stock Transfer Engine ──
app.get('/api/inventory/transfers', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id || 'default_tenant';
    const transfers = await dbAll('SELECT * FROM stock_transfers WHERE tenant_id = ? ORDER BY timestamp DESC', [tenantId]);
    res.json(transfers);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/inventory/transfers', authenticateToken, async (req, res) => {
  const { sourceOutlet, destinationOutlet, ingredientId, ingredientName, quantity, unit } = req.body;
  if (!destinationOutlet || !ingredientId || !quantity) {
    return res.status(400).json({ error: 'destinationOutlet, ingredientId, and quantity are required.' });
  }
  try {
    const tenantId = req.user?.tenant_id || 'default_tenant';
    const id = `tr_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    await dbRun(
      `INSERT INTO stock_transfers (id, sourceOutlet, destinationOutlet, ingredientId, ingredientName, quantity, unit, status, requestedBy, timestamp, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [id, sourceOutlet || 'Central Kitchen', destinationOutlet, ingredientId, ingredientName || 'Raw Ingredient', quantity, unit || 'kg', req.user?.username || 'Staff', Date.now(), tenantId]
    );
    res.status(201).json({ id, message: 'Stock transfer request dispathed successfully!' });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

app.post('/api/inventory/transfers/:id/approve', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { id } = req.params;
  try {
    const tenantId = req.user?.tenant_id || 'default_tenant';
    const transfer = await dbGet('SELECT * FROM stock_transfers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (!transfer) return res.status(404).json({ error: 'Transfer request not found' });
    if (transfer.status === 'approved') return res.status(400).json({ error: 'Transfer already approved' });

    await dbRun('BEGIN TRANSACTION');
    // Reduce from ingredient stock if matching ingredient exists
    await dbRun('UPDATE ingredients SET stock = MAX(0, stock - ?) WHERE id = ? AND tenant_id = ?', [transfer.quantity, transfer.ingredientId, tenantId]);
    await dbRun('UPDATE stock_transfers SET status = "approved", approvedBy = ? WHERE id = ?', [req.user?.username || 'Manager', id]);
    await dbRun('COMMIT');

    res.json({ message: `Stock transfer #${id} approved and quantity deducted from Central Kitchen!` });
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── SaaS Multi-Tenancy Provisioning & Tenant List Endpoints ──
app.get('/api/saas/tenants', async (req, res) => {
  try {
    const defaultStore = {
      id: 'default_tenant',
      name: 'GastroFlow Main Bistro (Primary)',
      subdomain: 'main',
      ownerEmail: 'admin@gastroflow.lk',
      plan: 'enterprise',
      status: 'active',
      staffUsername: 'admin',
      temporaryPassword: '***',
      createdAt: 1700000000000
    };

    let tenantsFromDb = [];
    try {
      tenantsFromDb = await dbAll('SELECT * FROM tenants ORDER BY createdAt DESC');
    } catch (_) {}

    const knownIds = new Set();
    const resultList = [];

    // Always put default_tenant at the top
    resultList.push(defaultStore);
    knownIds.add('default_tenant');

    for (const t of tenantsFromDb) {
      if (t.id && !knownIds.has(t.id)) {
        resultList.push(t);
        knownIds.add(t.id);
      }
    }

    res.json(resultList);
  } catch (err) {

    res.status(500).json({ error: errMsg(err) });
  }
});



app.post('/api/saas/tenants', authenticateToken, requireRole(['owner', 'manager']), async (req, res) => {
  const { name, subdomain, ownerEmail, plan } = req.body;
  if (!name || !subdomain || !ownerEmail) {
    return res.status(400).json({ error: 'name, subdomain, and ownerEmail are required.' });
  }

  const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
  try {
    const existing = await dbGet('SELECT * FROM tenants WHERE subdomain = ?', [cleanSubdomain]);
    if (existing) return res.status(400).json({ error: `Subdomain "${cleanSubdomain}" is already taken.` });

    const tenantId = `tenant_${cleanSubdomain}_${Date.now().toString(36)}`;
    const staffUsername = `${cleanSubdomain}_admin`;
    const temporaryPassword = generateStrongPassword(10);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const createdAt = Date.now();

    await dbRun('BEGIN TRANSACTION');

    await dbRun(
      'INSERT INTO tenants (id, name, subdomain, ownerEmail, plan, status, staffUsername, temporaryPassword, createdAt) VALUES (?, ?, ?, ?, ?, "active", ?, ?, ?)',
      [tenantId, name, cleanSubdomain, ownerEmail, plan || 'pro', staffUsername, temporaryPassword, createdAt]
    );

    const userId = `usr_${Date.now()}`;
    await dbRun(
      'INSERT INTO users (id, username, passwordHash, role, pin, tenant_id) VALUES (?, ?, ?, "owner", "1234", ?)',
      [userId, staffUsername, passwordHash, tenantId]
    );

    await seedDatabase(tenantId);
    await dbRun('COMMIT');

    const createdTenant = {
      id: tenantId,
      name,
      subdomain: cleanSubdomain,
      ownerEmail,
      plan: plan || 'pro',
      status: 'active',
      staffUsername,
      temporaryPassword,
      createdAt
    };

    res.status(201).json({ tenant: createdTenant, message: `Tenant store "${name}" provisioned successfully!` });
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
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

// ── Customer Support Desk & Live Chat Thread API Endpoints ──

// GET /api/tickets — Fetch support tickets for staff/admin POS view
app.get(['/api/tickets', '/api/support/tickets'], authenticateToken, requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default_tenant';
    const tickets = await dbAll('SELECT * FROM support_tickets WHERE tenant_id = ? ORDER BY createdAt DESC', [tenantId]);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/tickets/:id/resolve — Resolve a ticket (POS staff)
app.post(['/api/tickets/:id/resolve', '/api/support/tickets/:id/resolve'], authenticateToken, requireRole(['owner', 'manager', 'cashier']), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun("UPDATE support_tickets SET status = 'resolved', resolvedAt = ? WHERE id = ?", [Date.now(), id]);
    broadcastEvent('support_ticket_updated', { ticketId: id, status: 'resolved' });
    res.json({ success: true, message: `Ticket #${id} marked as resolved.` });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/tickets/:id/messages — Fetch message history for a ticket thread
app.get(['/api/tickets/:id/messages', '/api/support/tickets/:id/messages'], publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await dbAll('SELECT * FROM support_ticket_messages WHERE ticketId = ? ORDER BY createdAt ASC', [id]);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/tickets/:id/messages — Append reply message to ticket thread (Staff or Customer)
app.post(['/api/tickets/:id/messages', '/api/support/tickets/:id/messages'], publicApiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, senderType, senderName } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    await dbRun(
      'INSERT INTO support_ticket_messages (id, ticketId, senderType, senderName, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [msgId, id, senderType || 'staff', senderName || 'Support Agent', message.trim(), Date.now()]
    );

    await dbRun("UPDATE support_tickets SET status = 'in_progress' WHERE id = ? AND status = 'open'", [id]);

    broadcastEvent('support_ticket_updated', { ticketId: id, message: message.trim(), senderType: senderType || 'staff', senderName: senderName || 'Support Agent' });
    res.json({ success: true, messageId: msgId });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/customer/support/tickets — Customer ticket history
app.get('/api/customer/support/tickets', publicApiLimiter, async (req, res) => {
  try {
    let customerPhone = req.query.phone || '';
    let customerEmail = req.query.email || '';

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7), process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET);
        if (decoded.phone) customerPhone = decoded.phone;
        if (decoded.email) customerEmail = decoded.email;
      } catch (_) {}
    }

    if (!customerPhone && !customerEmail) {
      return res.json([]);
    }

    const tickets = await dbAll(
      `SELECT * FROM support_tickets WHERE (customerPhone = ? OR customerEmail = ?) ORDER BY createdAt DESC`,
      [customerPhone, customerEmail]
    );

    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/customer/support/tickets — Create a new support ticket (Customer PWA / Bot)
app.post('/api/customer/support/tickets', publicApiLimiter, async (req, res) => {
  try {
    const { name, phone, email, issueCategory, message, orderId, otpCode } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message description is required.' });
    }

    let verifiedName = name ? name.trim() : 'Customer';
    let verifiedPhone = phone ? phone.trim() : null;
    let verifiedEmail = email ? email.toLowerCase().trim() : null;

    const authHeader = req.headers.authorization;
    let authedUser = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        authedUser = jwt.verify(authHeader.slice(7), process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || JWT_SECRET);
        verifiedName = authedUser.name || verifiedName;
        verifiedPhone = authedUser.phone || verifiedPhone;
        verifiedEmail = authedUser.email || verifiedEmail;
      } catch (_) {}
    }

    if (!authedUser) {
      if (!verifiedPhone && !verifiedEmail) {
        return res.status(400).json({ error: 'Please provide your name and phone number or email.' });
      }
      if (otpCode) {
        const dest = verifiedEmail || verifiedPhone;
        if (!verifyOTP(dest, otpCode)) {
          return res.status(400).json({ error: 'Invalid or expired verification code.' });
        }
      }
    }

    const ticketId = `tkt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const tenantId = await resolvePublicTenant(req);

    await dbRun(
      `INSERT INTO support_tickets (id, orderId, customerName, customerPhone, issueCategory, message, status, createdAt, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [ticketId, orderId || null, verifiedName, verifiedPhone || verifiedEmail, issueCategory || 'general', message.trim(), Date.now(), tenantId]
    );

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    await dbRun(
      'INSERT INTO support_ticket_messages (id, ticketId, senderType, senderName, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [msgId, ticketId, 'customer', verifiedName, message.trim(), Date.now()]
    );

    broadcastEvent('support_ticket_created', {
      ticketId,
      customerName: verifiedName,
      customerPhone: verifiedPhone || verifiedEmail,
      message: message.trim(),
      timestamp: Date.now()
    });

    res.status(201).json({
      success: true,
      ticketId,
      message: 'Support ticket registered! Our team has been notified.'
    });
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


