import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOfflineQueue as legacyGetQueue,
  saveOfflineOrder as legacySave,
  clearOfflineQueue as legacyClear,
  flushOfflineQueue as legacyFlush
} from '../src/utils/offlineSync.js';
import {
  getOfflineQueue as posGetQueue,
  saveOfflineOrder as posSave,
  clearOfflineQueue as posClear,
  flushOfflineQueue as posFlush
} from '../apps/pos-web/src/utils/offlineSync.js';

function setupStorage(tenantId = 'restaurant-A') {
  const entries = new Map([
    ['gastroflow_user', JSON.stringify({id:'cashier-A',tenant_id:tenantId})],
    ['gastroflow_token', 'staging-session']
  ]);
  const localStorage = {
    getItem: vi.fn(key => entries.get(key) ?? null),
    setItem: vi.fn((key,value) => entries.set(key,value)),
    removeItem: vi.fn(key => entries.delete(key))
  };
  vi.stubGlobal('localStorage', localStorage);
  return {entries,localStorage};
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('POS offline sales queue relocation compatibility', () => {
  it('preserves identical public functions and one shared queue implementation', () => {
    expect(legacyGetQueue).toBe(posGetQueue);
    expect(legacySave).toBe(posSave);
    expect(legacyClear).toBe(posClear);
    expect(legacyFlush).toBe(posFlush);
  });

  it('keeps unacknowledged sales scoped to the signed-in restaurant', () => {
    const {entries}=setupStorage();
    const pending=posSave({items:[{menuItemId:'rice',quantity:1}],total:500});
    expect(pending.tenant_id).toBe('restaurant-A');
    expect(pending.offlineId).toMatch(/^off_/);
    expect(posGetQueue()).toHaveLength(1);
    entries.set('gastroflow_user',JSON.stringify({id:'cashier-B',tenant_id:'restaurant-B'}));
    expect(legacyGetQueue()).toEqual([]);
    entries.set('gastroflow_user',JSON.stringify({id:'cashier-A',tenant_id:'restaurant-A'}));
    expect(legacyGetQueue()[0].offlineId).toBe(pending.offlineId);
  });

  it('refuses to create offline sales without a restaurant session', () => {
    const {entries}=setupStorage();
    entries.delete('gastroflow_user');
    expect(()=>legacySave({total:100})).toThrow('Sign in to a restaurant');
    expect(posGetQueue()).toEqual([]);
  });

  it('clears only the active restaurant queue', () => {
    const {entries}=setupStorage();
    const a=posSave({total:100});
    entries.set('gastroflow_user',JSON.stringify({id:'cashier-B',tenant_id:'restaurant-B'}));
    const b=posSave({total:200});
    legacyClear();
    expect(posGetQueue()).toEqual([]);
    entries.set('gastroflow_user',JSON.stringify({id:'cashier-A',tenant_id:'restaurant-A'}));
    expect(posGetQueue()[0].offlineId).toBe(a.offlineId);
    expect(posGetQueue()).toHaveLength(1);
    expect(b.offlineId).not.toBe(a.offlineId);
  });

  it('removes only server-acknowledged sales, preserving pending ones', async () => {
    const {entries}=setupStorage();
    const first=posSave({total:100});
    const second=posSave({total:200});
    const fetch=vi.fn(async(url,options)=>({
      ok:true,json:async()=>({syncedCount:1,syncedIds:[first.offlineId]})
    }));
    vi.stubGlobal('fetch',fetch);
    const result=await legacyFlush();
    expect(result.syncedCount).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('/api/orders/offline-sync');
    const payload=JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.orders.map(o=>o.offlineId)).toEqual([first.offlineId,second.offlineId]);
    expect(posGetQueue().map(o=>o.offlineId)).toEqual([second.offlineId]);
    expect(entries.has('gastroflow_offline_orders:restaurant-A')).toBe(true);
  });
});
