import { describe, expect, it, vi } from 'vitest';
import { initOrderInventory, setOrderInventory } from '../lib/orders/index.js';
import { initOrderInventory as oldInit, setOrderInventory as oldSet } from '../lib/order-inventory.js';

describe('orders domain inventory compatibility and tenant isolation', () => {
  it('preserves legacy inventory exports exactly', () => {
    expect(oldInit).toBe(initOrderInventory);
    expect(oldSet).toBe(setOrderInventory);
  });

  it('initializes inventory tables and tenant-scoped movement index', async () => {
    const dbRun = vi.fn(async () => ({ changes: 1 }));
    await initOrderInventory(dbRun);
    const sql = dbRun.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('order_inventory_state');
    expect(sql).toContain('inventory_movements');
    expect(sql).toContain('inventory_movement_order ON inventory_movements(tenant_id,orderId)');
  });

  it('rejects inventory snapshots belonging to a different restaurant', async () => {
    const dbRun = vi.fn();
    const dbGet = vi.fn(async () => ({tenant_id: 'restaurant-B', requirements: '{}'}));
    const dbAll = vi.fn();
    await expect(setOrderInventory({
      dbGet,dbAll,dbRun,orderId:'order-A',tenantId:'restaurant-A',
      items:[],reason:'offline_order'
    })).rejects.toThrow('Inventory belongs to another restaurant.');
    expect(dbRun).not.toHaveBeenCalled();
    expect(dbAll).not.toHaveBeenCalled();
  });

  it('rejects invalid quantities without changing stock', async () => {
    const dbRun = vi.fn();
    const dbGet = vi.fn(async()=>null);
    const dbAll = vi.fn();
    await expect(setOrderInventory({
      dbGet,dbAll,dbRun,orderId:'order-A',tenantId:'restaurant-A',
      items:[{id:'menu-A',quantity:0}],reason:'offline_order'
    })).rejects.toThrow('Inventory requires positive whole item quantities.');
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('scopes recipe and stock movements to the requested tenant', async () => {
    const dbRun = vi.fn(async () => ({changes:1}));
    const dbGet = vi.fn(async()=>null);
    const dbAll = vi.fn(async()=>[]);
    const result = await setOrderInventory({
      dbGet,dbAll,dbRun,orderId:'order-A',tenantId:'restaurant-A',
      items:[{id:'menu-A',quantity:2}],reason:'offline_order'
    });
    expect(result.changed).toBe(true);
    expect(dbAll).toHaveBeenCalledWith(expect.stringContaining('r.tenant_id=?'),['menu-A','restaurant-A']);
    expect(dbRun).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE menu_items SET stock=stock-? WHERE id=? AND tenant_id=?'),
      [2,'menu-A','restaurant-A',2]
    );
    expect(dbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO inventory_movements'),
      expect.arrayContaining(['restaurant-A','order-A'])
    );
  });
});
