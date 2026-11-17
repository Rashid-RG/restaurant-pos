import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const legacy = 'src/components/Sidebar.jsx';
const canonical = 'apps/pos-web/src/components/Sidebar.jsx';
const read = file => readFileSync(file, 'utf8');

describe('POS sidebar module compatibility', () => {
  it('keeps the active POS sidebar import unchanged', () => {
    expect(read(legacy).trim()).toBe("export { default } from '../../apps/pos-web/src/components/Sidebar.jsx';");
    expect(resolve(dirname(legacy), '../../apps/pos-web/src/components/Sidebar.jsx')).toBe(resolve(canonical));
  });

  it('preserves POS context and current navigation policy hooks', () => {
    const current = read(canonical);
    for (const dependency of [
      '../../../../src/context/POSContext',
      '../../../../src/components/WorkspaceTools',
    ]) {
      expect(current).toContain(dependency);
      const target = resolve(dirname(canonical), dependency);
      expect([target, target + '.js', target + '.jsx'].some(existsSync)).toBe(true);
    }
    expect(current).toContain('const items = useDestinations()');
    expect(current).toContain('currentUser?.isPlatformAdmin === true');
    expect(current).toContain("activeTab === 'platform'");
  });

  it('preserves mobile/desktop navigation and the logout action', () => {
    const current = read(canonical);
    for (const contract of [
      'desktop-sidebar',
      'mobile-bottom-nav',
      'mobile-more-sheet',
      'setActiveTab(id)',
      'onClick={logout}',
      'switchWorkspace',
      'aria-label="Staff navigation"',
    ]) expect(current).toContain(contract);
  });
});
