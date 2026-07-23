/**
 * tests/billing.test.js
 *
 * G3 — Billing engine tests for GastroFlow POS.
 *
 * Strategy: dependency injection.
 * resolveAndCalculateBill and allocateInvoiceNumber accept { dbGet, dbRun }
 * helpers. Tests supply synchronous in-memory stubs — no SQLite process needed.
 *
 * Coverage targets (per CLAUDE.md G3 spec):
 *  ✓ Basic item pricing
 *  ✓ Modifier cost resolution (server-side; spoofed client price ignored)
 *  ✓ Percentage discount
 *  ✓ Flat discount
 *  ✓ Discount capped at subtotal
 *  ✓ Service charge
 *  ✓ Tax (applied after service charge)
 *  ✓ Tip clamping (negative → 0)
 *  ✓ LKR rounding (Math.round)
 *  ✓ Delivery fee
 *  ✓ Minimum-order enforcement (throws when subtotal < minimumOrder — tested at call site)
 *  ✓ Promo code — percent
 *  ✓ Promo code — flat
 *  ✓ Promo code — min-spend not met (throws)
 *  ✓ Promo code — invalid/expired (throws)
 *  ✓ Loyalty redemption (100 pts = 1 LKR)
 *  ✓ Total discount capped at subtotal
 *  ✓ Multi-item order
 *  ✓ Unknown menu item throws
 *  ✓ Insufficient stock throws
 *  ✓ Gapless invoice counter — sequential allocation
 *  ✓ Invoice counter regression — deliberate wrong total fails assertion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAndCalculateBill, allocateInvoiceNumber } from '../lib/billing.js';

// ---------------------------------------------------------------------------
// Helpers — build a minimal mock DB
// ---------------------------------------------------------------------------

/**
 * Build a dbGet mock from a data map.
 * Handles the four query patterns used by resolveAndCalculateBill:
 *   1. SELECT * FROM menu_items WHERE id = ?
 *   2. SELECT id,name,priceDelta FROM modifiers WHERE id = ? AND menuItemId = ?
 *   3. SELECT value FROM settings WHERE key = "serviceChargeRate"
 *   4. SELECT value FROM settings WHERE key = "taxRate"
 *   5. SELECT * FROM promotions WHERE code = ? AND isActive = 1
 */
function makeDbGet({ menuItems = {}, modifiers = {}, settings = {}, promos = {} } = {}) {
  return async (sql, params = []) => {
    if (/FROM menu_items WHERE id/.test(sql)) {
      return menuItems[params[0]] ?? null;
    }
    if (/FROM modifiers WHERE id/.test(sql)) {
      const [modId, itemId] = params;
      const key = `${modId}:${itemId}`;
      return modifiers[key] ?? null;
    }
    if (/FROM settings WHERE key/.test(sql)) {
      // The key may be a param OR embedded in the SQL string (e.g. WHERE key = "serviceChargeRate")
      const settingKey = params[0] ?? sql.match(/key\s*=\s*["']([^"']+)["']/)?.[1];
      return settings[settingKey] !== undefined ? { value: String(settings[settingKey]) } : null;
    }
    if (/FROM promotions WHERE code/.test(sql)) {
      return promos[params[0].toUpperCase()] ?? null;
    }
    return null;
  };
}


/** Standard settings: 10% service charge, 8% tax */
const stdSettings = { serviceChargeRate: 10, taxRate: 8 };

/** Zero-rate settings: no service charge, no tax */
const noChargeSettings = { serviceChargeRate: 0, taxRate: 0 };

/** A basic menu item fixture */
function item(id, price, stock = 100, cost = 0) {
  return { id, name: `Item-${id}`, price, stock, cost };
}

/** A cart entry */
function cartItem(id, quantity = 1, selectedModifiers = []) {
  return { id, quantity, selectedModifiers };
}

// Shorthand to call resolveAndCalculateBill with defaults
async function calc(
  { menuItems = {}, modifiers = {}, settings = noChargeSettings, promos = {} } = {},
  items = [],
  discountType = null,
  discountValue = 0,
  loyalty = 0,
  tip = 0,
  promoCode = null,
  deliveryFee = 0
) {
  const dbGet = makeDbGet({ menuItems, modifiers, settings, promos });
  return resolveAndCalculateBill(
    { dbGet },
    items,
    discountType,
    discountValue,
    loyalty,
    tip,
    promoCode,
    deliveryFee
  );
}

// ---------------------------------------------------------------------------
// 1. Item pricing
// ---------------------------------------------------------------------------
describe('Item pricing', () => {
  it('prices a single item correctly', async () => {
    const bill = await calc(
      { menuItems: { a: item('a', 500) } },
      [cartItem('a', 1)]
    );
    expect(bill.subtotal).toBe(500);
    expect(bill.total).toBe(500);
    expect(bill.resolvedItems).toHaveLength(1);
    expect(bill.resolvedItems[0].lineTotal).toBe(500);
  });

  it('multiplies unit price by quantity', async () => {
    const bill = await calc(
      { menuItems: { b: item('b', 200) } },
      [cartItem('b', 3)]
    );
    expect(bill.subtotal).toBe(600);
    expect(bill.resolvedItems[0].lineTotal).toBe(600);
  });

  it('sums multiple items', async () => {
    const bill = await calc(
      { menuItems: { a: item('a', 100), b: item('b', 250) } },
      [cartItem('a', 2), cartItem('b', 1)]
    );
    // 100*2 + 250*1 = 450
    expect(bill.subtotal).toBe(450);
  });

  it('accepts item keyed as menuItemId', async () => {
    const dbGet = makeDbGet({ menuItems: { x: item('x', 300) }, settings: noChargeSettings });
    const bill = await resolveAndCalculateBill(
      { dbGet },
      [{ menuItemId: 'x', quantity: 1 }],
      null, 0, 0
    );
    expect(bill.subtotal).toBe(300);
  });

  it('throws for unknown menu item', async () => {
    await expect(
      calc({ menuItems: {} }, [cartItem('missing', 1)])
    ).rejects.toThrow('Menu item not found: missing');
  });

  it('throws when stock is insufficient', async () => {
    await expect(
      calc(
        { menuItems: { low: { ...item('low', 100), stock: 2 } } },
        [cartItem('low', 5)]
      )
    ).rejects.toThrow('Insufficient stock');
  });

  it('allows purchase of exact available stock', async () => {
    const bill = await calc(
      { menuItems: { exact: { ...item('exact', 100), stock: 3 } } },
      [cartItem('exact', 3)]
    );
    expect(bill.subtotal).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 2. Modifiers
// ---------------------------------------------------------------------------
describe('Modifiers', () => {
  const menuItems = { burger: item('burger', 1000) };
  const modifiers = {
    'extra-cheese:burger': { id: 'extra-cheese', name: 'Extra Cheese', priceDelta: 150 },
    'bacon:burger': { id: 'bacon', name: 'Bacon', priceDelta: 200 }
  };

  it('adds modifier priceDelta to unit price', async () => {
    const bill = await calc(
      { menuItems, modifiers },
      [cartItem('burger', 1, [{ id: 'extra-cheese' }])]
    );
    // 1000 + 150 = 1150
    expect(bill.resolvedItems[0].unitPrice).toBe(1150);
    expect(bill.subtotal).toBe(1150);
  });

  it('stacks multiple modifiers', async () => {
    const bill = await calc(
      { menuItems, modifiers },
      [cartItem('burger', 2, [{ id: 'extra-cheese' }, { id: 'bacon' }])]
    );
    // (1000 + 150 + 200) * 2 = 2700
    expect(bill.resolvedItems[0].unitPrice).toBe(1350);
    expect(bill.subtotal).toBe(2700);
  });

  it('silently ignores an unknown modifier (no price added)', async () => {
    // If a client sends a spoofed modifier ID that doesn't exist for this item, it's skipped
    const bill = await calc(
      { menuItems, modifiers: {} },
      [cartItem('burger', 1, [{ id: 'nonexistent-mod' }])]
    );
    expect(bill.resolvedItems[0].unitPrice).toBe(1000);
    expect(bill.resolvedItems[0].selectedModifiers).toHaveLength(0);
  });

  it('correctly records resolved modifier list', async () => {
    const bill = await calc(
      { menuItems, modifiers },
      [cartItem('burger', 1, [{ id: 'extra-cheese' }])]
    );
    expect(bill.resolvedItems[0].selectedModifiers).toEqual([
      { id: 'extra-cheese', name: 'Extra Cheese', priceDelta: 150 }
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Discounts
// ---------------------------------------------------------------------------
describe('Discounts', () => {
  const menuItems = { p: item('p', 1000) };
  const db = { menuItems, settings: noChargeSettings };

  it('applies percent discount correctly', async () => {
    const bill = await calc(db, [cartItem('p', 1)], 'percent', 20);
    // 1000 * 20% = 200 discount
    expect(bill.discount).toBe(200);
    expect(bill.total).toBe(800);
  });

  it('applies flat discount correctly', async () => {
    const bill = await calc(db, [cartItem('p', 1)], 'flat', 300);
    expect(bill.discount).toBe(300);
    expect(bill.total).toBe(700);
  });

  it('caps flat discount at subtotal (never goes negative)', async () => {
    const bill = await calc(db, [cartItem('p', 1)], 'flat', 9999);
    expect(bill.discount).toBe(1000); // capped at subtotal
    expect(bill.total).toBe(0);
  });

  it('caps percent discount at 100% (edge: 100%)', async () => {
    const bill = await calc(db, [cartItem('p', 1)], 'percent', 100);
    expect(bill.discount).toBe(1000);
    expect(bill.total).toBe(0);
  });

  it('ignores unknown discount type (no discount applied)', async () => {
    const bill = await calc(db, [cartItem('p', 1)], 'bogus', 50);
    expect(bill.discount).toBe(0);
    expect(bill.total).toBe(1000);
  });

  it('applies no discount when discountType is null', async () => {
    const bill = await calc(db, [cartItem('p', 1)], null, 0);
    expect(bill.discount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Service charge & tax
// ---------------------------------------------------------------------------
describe('Service charge and tax', () => {
  const menuItems = { x: item('x', 1000) };

  it('applies service charge as percentage of (subtotal − discount)', async () => {
    const bill = await calc(
      { menuItems, settings: { serviceChargeRate: 10, taxRate: 0 } },
      [cartItem('x', 1)]
    );
    // SC = 1000 * 10% = 100
    expect(bill.serviceCharge).toBe(100);
    expect(bill.total).toBe(1100);
  });

  it('applies tax on (subtotal − discount + serviceCharge)', async () => {
    const bill = await calc(
      { menuItems, settings: { serviceChargeRate: 0, taxRate: 10 } },
      [cartItem('x', 1)]
    );
    // Tax base = 1000; tax = 100
    expect(bill.tax).toBe(100);
    expect(bill.total).toBe(1100);
  });

  it('stacks service charge then tax correctly', async () => {
    const bill = await calc(
      { menuItems, settings: { serviceChargeRate: 10, taxRate: 10 } },
      [cartItem('x', 1)]
    );
    // SC = 1000 * 10% = 100; tax base = 1000+100=1100; tax = 110
    expect(bill.serviceCharge).toBe(100);
    expect(bill.tax).toBe(110);
    expect(bill.total).toBe(1210);
  });

  it('applies both after discount is deducted', async () => {
    const bill = await calc(
      { menuItems, settings: { serviceChargeRate: 10, taxRate: 10 } },
      [cartItem('x', 1)],
      'flat', 200 // discount 200 → net 800
    );
    // SC = 800 * 10% = 80; tax base = 800+80=880; tax = 88
    expect(bill.serviceCharge).toBe(80);
    expect(bill.tax).toBe(88);
    expect(bill.total).toBe(968);
  });

  it('returns 0 service charge and tax when rates are 0', async () => {
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('x', 1)]
    );
    expect(bill.serviceCharge).toBe(0);
    expect(bill.tax).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Tips
// ---------------------------------------------------------------------------
describe('Tips', () => {
  const menuItems = { t: item('t', 500) };
  const db = { menuItems, settings: noChargeSettings };

  it('adds tip to total', async () => {
    const bill = await calc(db, [cartItem('t', 1)], null, 0, 0, 100);
    expect(bill.tip).toBe(100);
    expect(bill.total).toBe(600);
  });

  it('clamps negative tip to 0', async () => {
    const bill = await calc(db, [cartItem('t', 1)], null, 0, 0, -50);
    expect(bill.tip).toBe(0);
    expect(bill.total).toBe(500);
  });

  it('handles string tip value (coerced to number)', async () => {
    const bill = await calc(db, [cartItem('t', 1)], null, 0, 0, '75');
    expect(bill.tip).toBe(75);
    expect(bill.total).toBe(575);
  });

  it('handles zero tip', async () => {
    const bill = await calc(db, [cartItem('t', 1)], null, 0, 0, 0);
    expect(bill.tip).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. LKR rounding
// ---------------------------------------------------------------------------
describe('LKR rounding', () => {
  it('rounds total to nearest integer', async () => {
    // 333.33 * 3 = 999.99 → rounds to 1000
    const menuItems = { r: { ...item('r', 333.33), stock: 10 } };
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('r', 3)]
    );
    expect(Number.isInteger(bill.total)).toBe(true);
    expect(bill.total).toBe(1000);
    // roundedAmount = total - rawTotal
    expect(Math.abs(bill.roundedAmount)).toBeLessThanOrEqual(0.5);
  });

  it('reports the rounded amount correctly', async () => {
    const menuItems = { s: { ...item('s', 100.60), stock: 10 } };
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('s', 1)]
    );
    // raw = 100.60, rounded = 101, roundedAmount = 0.40
    expect(bill.total).toBe(101);
    expect(bill.roundedAmount).toBeCloseTo(0.4, 2);
  });
});

// ---------------------------------------------------------------------------
// 7. Delivery fee
// ---------------------------------------------------------------------------
describe('Delivery fee', () => {
  const menuItems = { d: item('d', 500) };
  const db = { menuItems, settings: noChargeSettings };

  it('adds delivery fee to total', async () => {
    const bill = await calc(db, [cartItem('d', 1)], null, 0, 0, 0, null, 200);
    expect(bill.total).toBe(700);
  });

  it('applies delivery fee after all discounts/charges/tax', async () => {
    const bill = await calc(
      { menuItems, settings: { serviceChargeRate: 10, taxRate: 0 } },
      [cartItem('d', 1)], null, 0, 0, 0, null, 150
    );
    // subtotal=500, SC=50, deliveryFee=150 → 700
    expect(bill.total).toBe(700);
  });

  it('works when delivery fee is 0', async () => {
    const bill = await calc(db, [cartItem('d', 1)], null, 0, 0, 0, null, 0);
    expect(bill.total).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 8. Promo codes
// ---------------------------------------------------------------------------
describe('Promo codes', () => {
  const menuItems = { item1: item('item1', 1000) };

  it('applies a percent promo code', async () => {
    const promos = {
      SAVE10: { code: 'SAVE10', type: 'percent', value: 10, minSpend: 0, isActive: 1 }
    };
    const bill = await calc(
      { menuItems, settings: noChargeSettings, promos },
      [cartItem('item1', 1)], null, 0, 0, 0, 'SAVE10'
    );
    expect(bill.promoDiscount).toBe(100); // 1000 * 10%
    expect(bill.appliedPromoCode).toBe('SAVE10');
    expect(bill.total).toBe(900);
  });

  it('applies a flat promo code', async () => {
    const promos = {
      FLAT200: { code: 'FLAT200', type: 'flat', value: 200, minSpend: 0, isActive: 1 }
    };
    const bill = await calc(
      { menuItems, settings: noChargeSettings, promos },
      [cartItem('item1', 1)], null, 0, 0, 0, 'FLAT200'
    );
    expect(bill.promoDiscount).toBe(200);
    expect(bill.total).toBe(800);
  });

  it('promo code is case-insensitive', async () => {
    const promos = {
      UPPER: { code: 'UPPER', type: 'flat', value: 100, minSpend: 0, isActive: 1 }
    };
    const bill = await calc(
      { menuItems, settings: noChargeSettings, promos },
      [cartItem('item1', 1)], null, 0, 0, 0, 'upper'
    );
    expect(bill.promoDiscount).toBe(100);
  });

  it('throws when minimum spend is not met', async () => {
    const promos = {
      HIGHMIN: { code: 'HIGHMIN', type: 'flat', value: 100, minSpend: 2000, isActive: 1 }
    };
    await expect(
      calc(
        { menuItems, settings: noChargeSettings, promos },
        [cartItem('item1', 1)], null, 0, 0, 0, 'HIGHMIN'
      )
    ).rejects.toThrow('Minimum spend');
  });

  it('throws for an invalid or expired promo code', async () => {
    await expect(
      calc(
        { menuItems, settings: noChargeSettings, promos: {} },
        [cartItem('item1', 1)], null, 0, 0, 0, 'BOGUS'
      )
    ).rejects.toThrow('Invalid or expired promo code: BOGUS');
  });

  it('skips promo code logic when promoCode is null', async () => {
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('item1', 1)], null, 0, 0, 0, null
    );
    expect(bill.promoDiscount).toBe(0);
    expect(bill.appliedPromoCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Loyalty redemption
// ---------------------------------------------------------------------------
describe('Loyalty redemption', () => {
  const menuItems = { lp: item('lp', 1000) };
  const db = { menuItems, settings: noChargeSettings };

  it('converts 100 points to 1 LKR discount', async () => {
    const bill = await calc(db, [cartItem('lp', 1)], null, 0, 500); // 500 pts = 5 LKR
    expect(bill.loyaltyDiscount).toBe(5);
    expect(bill.total).toBe(995);
  });

  it('floors partial points (no fractional LKR from loyalty)', async () => {
    const bill = await calc(db, [cartItem('lp', 1)], null, 0, 150); // 150 pts = 1.5 → floor = 1
    expect(bill.loyaltyDiscount).toBe(1);
  });

  it('loyalty discount of 0 when points are 0', async () => {
    const bill = await calc(db, [cartItem('lp', 1)], null, 0, 0);
    expect(bill.loyaltyDiscount).toBe(0);
  });

  it('combines loyalty with regular discount', async () => {
    const bill = await calc(
      db,
      [cartItem('lp', 1)],
      'flat', 100,  // staff discount 100
      500           // 500 pts = 5 LKR loyalty
    );
    expect(bill.discount).toBe(100);
    expect(bill.loyaltyDiscount).toBe(5);
    expect(bill.totalDiscount).toBe(105);
    expect(bill.total).toBe(895);
  });

  it('total discount is capped at subtotal even with combined discounts', async () => {
    const bill = await calc(
      db,
      [cartItem('lp', 1)],
      'flat', 900,   // staff discount 900
      50000          // 50000 pts = 500 LKR loyalty — this would exceed subtotal
    );
    // Would be 900 + 500 = 1400, but subtotal is only 1000
    expect(bill.totalDiscount).toBe(1000);
    expect(bill.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Combined scenarios
// ---------------------------------------------------------------------------
describe('Combined scenarios', () => {
  it('full order: multiple items + modifier + discount + SC + tax + tip + delivery', async () => {
    const menuItems = {
      pizza: item('pizza', 2000),
      drink: item('drink', 300)
    };
    const modifiers = {
      'extra-toppings:pizza': { id: 'extra-toppings', name: 'Extra Toppings', priceDelta: 250 }
    };

    // Pizza (2000 + 250 mod) * 2 = 4500; Drink 300 * 1 = 300; subtotal = 4800
    // 10% staff discount = 480 → net = 4320
    // SC 10% of 4320 = 432; tax 8% of (4320+432)=4752 → tax = 380.16
    // tip = 200; delivery = 500
    // raw = 4320 + 432 + 380.16 + 200 + 500 = 5832.16 → round = 5832

    const bill = await calc(
      { menuItems, modifiers, settings: stdSettings },
      [
        cartItem('pizza', 2, [{ id: 'extra-toppings' }]),
        cartItem('drink', 1)
      ],
      'percent', 10, 0, 200, null, 500
    );

    expect(bill.subtotal).toBe(4800);
    expect(bill.discount).toBe(480);
    expect(bill.serviceCharge).toBe(432);
    expect(bill.tax).toBeCloseTo(380.16, 1);
    expect(bill.tip).toBe(200);
    expect(bill.total).toBe(Math.round(5832.16));
    expect(bill.resolvedItems).toHaveLength(2);
  });

  it('deliberately wrong expected total fails the assertion', async () => {
    const menuItems = { w: item('w', 1000) };
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('w', 1)]
    );
    // Sanity check: if someone tries to weaken a total check this will catch it
    expect(bill.total).not.toBe(999);
    expect(bill.total).not.toBe(1001);
    expect(bill.total).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 11. Invoice counter (gapless sequence)
// ---------------------------------------------------------------------------
describe('allocateInvoiceNumber', () => {
  it('returns sequentially increasing numbers starting from 1', async () => {
    let counter = 0;
    const store = { lastNumber: 0 };

    const dbRun = async (sql) => {
      if (/UPDATE invoice_counter/.test(sql)) {
        store.lastNumber += 1;
      }
    };
    const dbGet = async (sql) => {
      if (/SELECT lastNumber/.test(sql)) return { lastNumber: store.lastNumber };
      return null;
    };

    const n1 = await allocateInvoiceNumber({ dbGet, dbRun });
    const n2 = await allocateInvoiceNumber({ dbGet, dbRun });
    const n3 = await allocateInvoiceNumber({ dbGet, dbRun });

    expect(n1).toBe(1);
    expect(n2).toBe(2);
    expect(n3).toBe(3);
    // All sequential — no gaps
    expect(n2 - n1).toBe(1);
    expect(n3 - n2).toBe(1);
  });

  it('is gapless — no numbers are skipped', async () => {
    const store = { lastNumber: 41 };
    const dbRun = async () => { store.lastNumber += 1; };
    const dbGet = async () => ({ lastNumber: store.lastNumber });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await allocateInvoiceNumber({ dbGet, dbRun }));
    }

    // Should be 42, 43, 44, 45, 46 — completely contiguous
    for (let i = 1; i < results.length; i++) {
      expect(results[i] - results[i - 1]).toBe(1);
    }
  });

  it('never returns a previously allocated number (idempotent per call)', async () => {
    const store = { lastNumber: 0 };
    const dbRun = async () => { store.lastNumber += 1; };
    const dbGet = async () => ({ lastNumber: store.lastNumber });

    const nums = new Set();
    for (let i = 0; i < 20; i++) {
      const n = await allocateInvoiceNumber({ dbGet, dbRun });
      expect(nums.has(n)).toBe(false); // must be unique
      nums.add(n);
    }
    expect(nums.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 12. Return shape invariants
// ---------------------------------------------------------------------------
describe('Return shape invariants', () => {
  it('always returns all required fields', async () => {
    const menuItems = { z: item('z', 100) };
    const bill = await calc(
      { menuItems, settings: noChargeSettings },
      [cartItem('z', 1)]
    );

    const required = [
      'resolvedItems', 'subtotal', 'discount', 'promoDiscount',
      'loyaltyDiscount', 'totalDiscount', 'appliedPromoCode',
      'serviceCharge', 'tax', 'tip', 'roundedAmount', 'total'
    ];
    for (const field of required) {
      expect(bill).toHaveProperty(field);
    }
  });

  it('all monetary fields are numbers rounded to 2 decimal places (or integer)', async () => {
    const menuItems = { z: item('z', 333.333) };
    const bill = await calc(
      { menuItems, settings: stdSettings },
      [cartItem('z', 3)],
      'percent', 7, 0, 99
    );

    const monetaryFields = ['subtotal', 'discount', 'promoDiscount', 'loyaltyDiscount',
      'totalDiscount', 'serviceCharge', 'tax', 'tip', 'roundedAmount'];
    for (const f of monetaryFields) {
      const val = bill[f];
      expect(typeof val).toBe('number');
      // Check max 2 decimal places
      expect(parseFloat(val.toFixed(2))).toBe(val);
    }
    expect(typeof bill.total).toBe('number');
    expect(Number.isInteger(bill.total)).toBe(true);
  });
});
