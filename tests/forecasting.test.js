import { describe, it, expect } from 'vitest';
import { predictStockDepletion, forecastInventoryList } from '../lib/ai_forecasting.js';

describe('AI Inventory Forecasting Engine (100% Free)', () => {
  it('handles empty stock gracefully with high risk', () => {
    const res = predictStockDepletion(0, []);
    expect(res.daysRemaining).toBe(0);
    expect(res.riskLevel).toBe('high');
  });

  it('calculates accurate depletion days based on usage history', () => {
    const history = [
      { timestamp: Date.now() - 3 * 86400000, qty: 10 },
      { timestamp: Date.now() - 2 * 86400000, qty: 12 },
      { timestamp: Date.now() - 1 * 86400000, qty: 11 }
    ];
    const res = predictStockDepletion(50, history);
    expect(res.avgDailyUsage).toBeGreaterThan(5);
    expect(res.daysRemaining).toBeLessThanOrEqual(10);
    expect(res.riskLevel).toBe('medium');
  });

  it('batch forecasts an array of inventory items', () => {
    const items = [
      { id: 'ing1', name: 'Samba Rice', stock: 100 },
      { id: 'ing2', name: 'Chicken', stock: 2 }
    ];
    const forecast = forecastInventoryList(items, []);
    expect(forecast).toHaveLength(2);
    expect(forecast[1].forecast.riskLevel).toBe('high');
  });

});
