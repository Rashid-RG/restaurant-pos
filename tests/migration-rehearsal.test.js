import { describe, expect, it } from 'vitest';
import { rehearseMigrations } from '../lib/migration-rehearsal.js';

const fixture = [
  'CREATE TABLE restaurants (id TEXT PRIMARY KEY)',
  'CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES restaurants(id), amount INTEGER NOT NULL)',
  "INSERT INTO restaurants (id) VALUES ('shop-a')",
  "INSERT INTO restaurants (id) VALUES ('shop-b')",
  "INSERT INTO orders (id,tenant_id,amount) VALUES ('order-a','shop-a',100)",
  "INSERT INTO orders (id,tenant_id,amount) VALUES ('order-b','shop-b',200)",
];
const addition = {version:'0001_add_order_source',statements:[
  "ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'pos'",
  'CREATE INDEX IF NOT EXISTS idx_orders_tenant_source ON orders(tenant_id,source)',
]};

describe('clone-only versioned migration rehearsal', () => {
  it('applies an additive migration and records a stable checksum', async () => {
    const result = await rehearseMigrations({seedStatements:fixture,migrations:[addition]});
    expect(result.ok).toBe(true);
    expect(result.foreignKeyViolationCount).toBe(0);
    expect(result.applied[0].status).toBe('applied');
    expect(result.ledger).toEqual([{version:addition.version,checksum:result.applied[0].checksum}]);
    expect(result.applied[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats an identical version as already applied and rejects changed definitions', async () => {
    const again = await rehearseMigrations({seedStatements:fixture,migrations:[addition,addition]});
    expect(again.applied.map(row=>row.status)).toEqual(['applied','already_applied']);
    expect(again.ledger).toHaveLength(1);
    await expect(rehearseMigrations({
      seedStatements:fixture,
      migrations:[addition,{...addition,statements:['ALTER TABLE orders ADD COLUMN changed TEXT']}],
    })).rejects.toThrow(/checksum changed/);
  });

  it('fails atomically on incompatible additive DDL', async () => {
    const bad = {version:'0002_duplicate_column', statements:[
      'ALTER TABLE orders ADD COLUMN safe_note TEXT',
      'ALTER TABLE orders ADD COLUMN amount INTEGER',
    ]};
    await expect(rehearseMigrations({seedStatements:fixture,migrations:[bad]}))
      .rejects.toThrow(/duplicate column name/);
    const unaffected=await rehearseMigrations({seedStatements:fixture,migrations:[addition]});
    expect(unaffected.ok).toBe(true);
  });

  it('rejects destructive statements and never accepts an external database connection', async () => {
    for (const statement of [
      'DROP TABLE orders',
      'DELETE FROM orders',
      'UPDATE orders SET amount = 0',
      'CREATE TABLE unrelated(id TEXT)',
      'ALTER TABLE orders DROP COLUMN amount',
      'CREATE INDEX idx_order ON orders(amount)',
      'ALTER TABLE orders ADD COLUMN note TEXT; DROP TABLE orders',
    ]) {
      await expect(rehearseMigrations({seedStatements:fixture,migrations:[
        {version:'0003_bad_attempt',statements:[statement]},
      ]})).rejects.toThrow(/only single-statement additive/);
    }
    // Unexpected url/connection keys are ignored; the implementation creates :memory: itself.
    const withInjectedUrl=await rehearseMigrations({
      databaseUrl:'libsql://invalid.example',
      connection:{execute(){throw new Error('must not use external connection');}},
      seedStatements:fixture,migrations:[],
    });
    expect(withInjectedUrl.ok).toBe(true);
  });
});
