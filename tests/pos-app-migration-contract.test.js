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

describe('POS gradual application migration compatibility', () => {
  it('preserves identical staff authentication helpers through the old import path', () => {
    expect(legacyExpired).toBe(posExpired);
    expect(legacyRestore).toBe(posRestore);
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
