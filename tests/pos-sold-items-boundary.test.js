import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const legacy = 'src/components/SoldItems.jsx';
const canonical = 'apps/pos-web/src/components/SoldItems.jsx';
const source = path => readFileSync(path, 'utf8');

describe('POS sold items reporting relocation', () => {
  it('keeps the old POS import working', () => {
    expect(source(legacy).trim())
      .toBe("export { default } from '../../apps/pos-web/src/components/SoldItems.jsx';");
    expect(resolve(dirname(legacy), '../../apps/pos-web/src/components/SoldItems.jsx'))
      .toBe(resolve(canonical));
  });

  it('keeps the shared POS context, reporting calculations, store timezone and stylesheet', () => {
    const current = source(canonical);
    for (const imported of [
      '../../../../src/context/POSContext',
      '../../../../src/utils/restaurant-time',
      '../../../../src/utils/sold-items',
      '../../../../src/components/sold-items.css',
    ]) {
      expect(current).toContain(imported);
      const target = resolve(dirname(canonical), imported);
      expect([target, target + '.js', target + '.jsx'].some(existsSync)).toBe(true);
    }
    expect(current).toContain('summarizeSoldItems(orders,');
    expect(current).toContain('soldItemsPeriod(period, today, from, to)');
  });

  it('preserves management-only visibility and CSV formula injection protection', () => {
    const current = source(canonical);
    expect(current).toContain("['owner', 'manager'].includes(currentUser?.role)");
    expect(current).toContain('currentUser?.isPlatformAdmin');
    expect(current).toContain("const safe = /^[\\s]*[=+@-]/.test(raw)");
    expect(current).toContain("link.download = `gastroflow_sold_items_");
    expect(current).toContain('URL.revokeObjectURL(url)');
  });
});
