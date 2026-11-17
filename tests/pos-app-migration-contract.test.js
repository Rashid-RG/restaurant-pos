import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isExpiredStaffSession as legacyExpired,
  restoreStaffSession as legacyRestore
} from '../src/utils/staff-session.js';
import {
  isExpiredStaffSession as posExpired,
  restoreStaffSession as posRestore
} from '../apps/pos-web/src/utils/staff-session.js';

import { createKitchenAction as oldKitchenAction, isTransientKitchenFailure as oldKitchenFailure } from '../src/utils/kitchen-recovery.js';
import { createKitchenAction as posKitchenAction, isTransientKitchenFailure as posKitchenFailure } from '../apps/pos-web/src/utils/kitchen-recovery.js';
import { summarizeSoldItems as oldSoldSummary, soldItemsPeriod as oldSoldPeriod } from '../src/utils/sold-items.js';
import { summarizeSoldItems as posSoldSummary, soldItemsPeriod as posSoldPeriod } from '../apps/pos-web/src/utils/sold-items.js';

describe('POS gradual application migration compatibility', () => {
  it('preserves identical staff authentication helpers through the old import path', () => {
    expect(legacyExpired).toBe(posExpired);
    expect(legacyRestore).toBe(posRestore);
  });

  it('preserves identical kitchen retry and sold-items functions via legacy POS imports', () => {
    expect(oldKitchenAction).toBe(posKitchenAction);
    expect(oldKitchenFailure).toBe(posKitchenFailure);
    expect(oldSoldSummary).toBe(posSoldSummary);
    expect(oldSoldPeriod).toBe(posSoldPeriod);
  });

  it('preserves kitchen retry key, ETA and transient failure semantics', () => {
    expect(posKitchenAction({revision:4,state:'pending'},'preparing',undefined,()=> 'retry-001')).toEqual({
      revision:4,state:'preparing',etaMinutes:25,retryKey:'retry-001'
    });
    expect(posKitchenAction({revision:5,state:'preparing'},'ready','line-A',()=> 'retry-002')).toEqual({
      revision:5,state:'ready',lineId:'line-A',retryKey:'retry-002'
    });
    expect(posKitchenFailure({status:503})).toBe(true);
    expect(posKitchenFailure({status:429})).toBe(true);
    expect(posKitchenFailure({status:409})).toBe(false);
  });

  it('preserves store-timezone-aware sold-item totals and periods', () => {
    const orders=[
      {id:'paid-1',status:'paid',timestamp:Date.UTC(2026,10,17,12),items:[{id:'rice',quantity:2,price:150}]},
      {id:'unpaid-2',status:'pending',timestamp:Date.UTC(2026,10,17,12),items:[{id:'rice',quantity:9,price:150}]}
    ];
    const summary=posSoldSummary(orders,{timeZone:'Asia/Colombo',menuItems:[{id:'rice',name:'Rice',category:'Meals'}]});
    expect(summary.paidOrderCount).toBe(1);
    expect(summary.unitsSold).toBe(2);
    expect(summary.grossItemSales).toBe(300);
    expect(summary.rows[0].name).toBe('Rice');
    expect(posSoldPeriod('today','2026-11-17')).toEqual({from:'2026-11-17',to:'2026-11-17'});
  });

  it('does not invalidate staff sessions on billing or tenant authorization restrictions', () => {
    for (const code of ['TENANT_SUSPENDED','TENANT_DELETED','SUBSCRIPTION_PAST_DUE','PLAN_LIMIT','FORBIDDEN']) {
      expect(posExpired(403,{code})).toBe(false);
    }
    expect(posExpired(401,{code:'TOKEN_EXPIRED'})).toBe(true);
  });

  it('still restores valid staff sessions from the same storage keys', () => {
    const store={gastroflow_token:'token',gastroflow_user:JSON.stringify({id:'staff-A',tenant_id:'restaurant-A'})};
    const storage={getItem(key){return store[key]}};
    expect(posRestore(storage)).toEqual({id:'staff-A',tenant_id:'restaurant-A'});
    expect(posRestore({getItem(){return null}})).toBeNull();
  });

  it('keeps the active POS HTML, entrypoint, build commands and output location unchanged', () => {
    const html=readFileSync('index.html','utf8');
    const vite=readFileSync('vite.config.js','utf8');
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    const appFacade=readFileSync('apps/pos-web/src/App.jsx','utf8');
    expect(html).toContain('src="/src/main.jsx"');
    expect(vite).not.toMatch(/root\s*:/);
    expect(pkg.scripts.build).toBe('vite build');
    expect(pkg.scripts['build:all']).toContain('vite build &&');
    expect(appFacade).toContain("../../../src/App.jsx");
  });
});
