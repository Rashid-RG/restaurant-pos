import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { resolveAndCalculateBill } from '../lib/billing.js';

// Tenant-isolation tests. These prove that the `WHERE tenant_id = ?` scoping pattern
// used throughout server.js prevents one tenant from reading another tenant's data.
// They run against an in-memory SQLite DB mirroring the scoped tables.

function makeDb() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
  const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
  const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
  return { db, run, all, get };
}

describe('Multi-tenant isolation', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeDb();
    await ctx.run(`CREATE TABLE orders (id TEXT PRIMARY KEY, total REAL, status TEXT, tenant_id TEXT DEFAULT 'default_tenant')`);
    await ctx.run(`CREATE TABLE menu_items (id TEXT PRIMARY KEY, name TEXT, tenant_id TEXT DEFAULT 'default_tenant')`);
    await ctx.run(`CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, tenant_id TEXT DEFAULT 'default_tenant')`);
    await ctx.run(`INSERT INTO orders VALUES ('o1',100,'paid','default_tenant'),('o2',200,'paid','default_tenant'),('o3',999,'paid','tenant_B')`);
    await ctx.run(`INSERT INTO menu_items VALUES ('m1','Pizza','default_tenant'),('m2','Secret Curry','tenant_B')`);
    await ctx.run(`INSERT INTO customers VALUES ('c1','Alice','default_tenant'),('c2','Bob','tenant_B')`);
  });

  it('order list is scoped to the requesting tenant', async () => {
    const a = await ctx.all('SELECT id FROM orders WHERE tenant_id = ? ORDER BY id', ['default_tenant']);
    const b = await ctx.all('SELECT id FROM orders WHERE tenant_id = ? ORDER BY id', ['tenant_B']);
    expect(a.map((r) => r.id)).toEqual(['o1', 'o2']);
    expect(b.map((r) => r.id)).toEqual(['o3']);
  });

  it('revenue reports never sum across tenants', async () => {
    const a = await ctx.get("SELECT SUM(total) t FROM orders WHERE tenant_id=? AND status='paid'", ['default_tenant']);
    const b = await ctx.get("SELECT SUM(total) t FROM orders WHERE tenant_id=? AND status='paid'", ['tenant_B']);
    expect(a.t).toBe(300);
    expect(b.t).toBe(999);
  });

  it('menu of one tenant is invisible to another', async () => {
    const a = await ctx.all('SELECT name FROM menu_items WHERE tenant_id = ?', ['default_tenant']);
    const names = a.map((r) => r.name);
    expect(names).toContain('Pizza');
    expect(names).not.toContain('Secret Curry');
  });

  it('customers are isolated per tenant', async () => {
    const b = await ctx.all('SELECT name FROM customers WHERE tenant_id = ?', ['tenant_B']);
    expect(b.map((r) => r.name)).toEqual(['Bob']);
  });

  it('a missing/unknown tenant id returns no data (no accidental leak)', async () => {
    const rows = await ctx.all('SELECT id FROM orders WHERE tenant_id = ?', ['does_not_exist']);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-tenant SETTINGS (composite PK tenant_id + key) — each tenant has its own
// restaurant config; toggling one tenant's store never affects another.
// ---------------------------------------------------------------------------
describe('Per-tenant settings isolation', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeDb();
    await ctx.run(`CREATE TABLE settings (tenant_id TEXT NOT NULL DEFAULT 'default_tenant', key TEXT NOT NULL, value TEXT, PRIMARY KEY (tenant_id, key))`);
    await ctx.run(`INSERT INTO settings VALUES
      ('default_tenant','restaurantName','GastroFlow Bistro'),
      ('default_tenant','storeOpen','true'),
      ('default_tenant','taxRate','10'),
      ('tenant_B','restaurantName','Colombo Spice House'),
      ('tenant_B','storeOpen','false'),
      ('tenant_B','taxRate','8')`);
  });

  it('each tenant reads its own restaurant name', async () => {
    const a = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['default_tenant', 'restaurantName']);
    const b = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['tenant_B', 'restaurantName']);
    expect(a.value).toBe('GastroFlow Bistro');
    expect(b.value).toBe('Colombo Spice House');
  });

  it("one tenant's store-closed toggle does not affect another", async () => {
    await ctx.run('INSERT OR REPLACE INTO settings (tenant_id,key,value) VALUES (?,?,?)', ['default_tenant', 'storeOpen', 'false']);
    const a = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['default_tenant', 'storeOpen']);
    const b = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['tenant_B', 'storeOpen']);
    expect(a.value).toBe('false');
    expect(b.value).toBe('false'); // B was already false and is untouched
    // Now re-open B and confirm A stays closed.
    await ctx.run('INSERT OR REPLACE INTO settings (tenant_id,key,value) VALUES (?,?,?)', ['tenant_B', 'storeOpen', 'true']);
    const a2 = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['default_tenant', 'storeOpen']);
    const b2 = await ctx.get('SELECT value FROM settings WHERE tenant_id=? AND key=?', ['tenant_B', 'storeOpen']);
    expect(a2.value).toBe('false');
    expect(b2.value).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Billing engine is tenant-aware: prices only the requesting tenant's menu,
// uses that tenant's tax/service rate, and rejects cross-tenant item injection.
// ---------------------------------------------------------------------------
describe('Tenant-scoped billing', () => {
  // Menu items + settings keyed by tenant; the mock honours the tenant param.
  const menu = {
    'default_tenant': { itemA: { id: 'itemA', name: 'Pizza', price: 1000, cost: 400, stock: 50 } },
    'tenant_B': { itemB: { id: 'itemB', name: 'Curry', price: 800, cost: 300, stock: 50 } }
  };
  const settings = {
    'default_tenant': { taxRate: '10', serviceChargeRate: '0' },
    'tenant_B': { taxRate: '8', serviceChargeRate: '0' }
  };
  const makeTenantDbGet = () => async (sql, params = []) => {
    if (/FROM menu_items/.test(sql)) {
      const [id, tenantId] = params;
      return menu[tenantId]?.[id] ?? null;
    }
    if (/FROM settings/.test(sql)) {
      const [tenantId, key] = params;
      const v = settings[tenantId]?.[key];
      return v !== undefined ? { value: String(v) } : null;
    }
    if (/FROM modifiers/.test(sql)) return null;
    if (/FROM promotions/.test(sql)) return null;
    return null;
  };

  it('prices with the requesting tenant tax rate', async () => {
    const billA = await resolveAndCalculateBill({ dbGet: makeTenantDbGet(), tenantId: 'default_tenant' }, [{ menuItemId: 'itemA', quantity: 1 }], null, 0, 0);
    const billB = await resolveAndCalculateBill({ dbGet: makeTenantDbGet(), tenantId: 'tenant_B' }, [{ menuItemId: 'itemB', quantity: 1 }], null, 0, 0);
    expect(billA.subtotal).toBe(1000);
    expect(billA.tax).toBe(100); // 10% of 1000
    expect(billB.subtotal).toBe(800);
    expect(billB.tax).toBeCloseTo(64); // 8% of 800
  });

  it('rejects ordering another tenant\'s menu item (no cross-tenant injection)', async () => {
    // Tenant B tries to order default_tenant's itemA → must be "not found".
    await expect(
      resolveAndCalculateBill({ dbGet: makeTenantDbGet(), tenantId: 'tenant_B' }, [{ menuItemId: 'itemA', quantity: 1 }], null, 0, 0)
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Driver dispatch is tenant-bound (Phase 2): a driver only ever sees and acts on
// deliveries belonging to their own tenant. Mirrors the `WHERE tenant_id = ?`
// scoping the authenticated driver endpoints apply using the tenant in the JWT.
// ---------------------------------------------------------------------------
describe('Tenant-bound driver dispatch', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeDb();
    await ctx.run(`CREATE TABLE orders (id TEXT PRIMARY KEY, orderType TEXT, driverId TEXT, status TEXT, tenant_id TEXT DEFAULT 'default_tenant')`);
    await ctx.run(`CREATE TABLE drivers (id TEXT PRIMARY KEY, name TEXT, phone TEXT, passwordHash TEXT, status TEXT, tenant_id TEXT DEFAULT 'default_tenant')`);
    await ctx.run(`INSERT INTO orders VALUES
      ('oA1','delivery',NULL,'ready','default_tenant'),
      ('oA2','delivery','drvA','preparing','default_tenant'),
      ('oB1','delivery',NULL,'ready','tenant_B')`);
    await ctx.run(`INSERT INTO drivers VALUES ('drvA','Kamal','0771','hash','available','default_tenant'),('drvB','Nimal','0772','hash','available','tenant_B')`);
  });

  it('unassigned pool only shows the driver tenant\'s deliveries', async () => {
    const pool = await ctx.all(
      "SELECT id FROM orders WHERE tenant_id = ? AND orderType = 'delivery' AND (driverId IS NULL OR driverId = '') AND status IN ('pending','preparing','ready') ORDER BY id",
      ['default_tenant']
    );
    expect(pool.map(r => r.id)).toEqual(['oA1']); // never oB1 (tenant_B)
  });

  it('a driver cannot claim an order outside their tenant', async () => {
    // Driver from default_tenant tries to claim tenant_B's order oB1 → tenant guard finds nothing.
    const target = await ctx.get('SELECT tenant_id FROM orders WHERE id = ?', ['oB1']);
    const driverTenant = 'default_tenant';
    expect(target.tenant_id).not.toBe(driverTenant); // endpoint returns 404 in this case
    const res = await ctx.run("UPDATE orders SET driverId = 'drvA' WHERE id = 'oB1' AND tenant_id = 'default_tenant'");
    const after = await ctx.get('SELECT driverId FROM orders WHERE id = ?', ['oB1']);
    expect(after.driverId).toBeNull(); // scoped UPDATE changed nothing
  });

  it('driver login lookup is scoped by tenant (same phone can exist per tenant)', async () => {
    const a = await ctx.get('SELECT id FROM drivers WHERE phone = ? AND tenant_id = ?', ['0771', 'default_tenant']);
    const b = await ctx.get('SELECT id FROM drivers WHERE phone = ? AND tenant_id = ?', ['0771', 'tenant_B']);
    expect(a?.id).toBe('drvA');
    expect(b).toBeUndefined();
  });
});
