import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const legacyPath = 'src/components/MyAttendance.jsx';
const canonicalPath = 'apps/pos-web/src/components/MyAttendance.jsx';
const source = path => readFileSync(path, 'utf8');

describe('POS attendance component relocation contract', () => {
  it('keeps the original POS import as a compatibility re-export', () => {
    const previous = source(legacyPath).trim();
    expect(previous).toBe("export { default } from '../../apps/pos-web/src/components/MyAttendance.jsx';");
    expect(resolve(dirname(legacyPath), '../../apps/pos-web/src/components/MyAttendance.jsx'))
      .toBe(resolve(canonicalPath));
  });

  it('retains the original POS auth, timezone, and styles imports', () => {
    const current = source(canonicalPath);
    for (const imported of [
      '../../../../src/context/POSContext',
      '../../../../src/utils/restaurant-time',
      '../../../../src/components/my-attendance.css',
    ]) {
      expect(current).toContain(imported);
      const target = resolve(dirname(canonicalPath), imported);
      expect([target, target + '.js', target + '.jsx'].some(existsSync)).toBe(true);
    }
  });

  it('preserves attendance endpoints and explicit clock-out confirmation', () => {
    const current = source(canonicalPath);
    expect(current).toContain("timeclock('status')");
    expect(current).toContain("timeclock('mine')");
    expect(current).toContain("'clock-out' : 'clock-in'");
    expect(current).toContain('if (clockedIn && !confirmOut)');
    expect(current).toContain("localStorage.getItem('gastroflow_token')");
    expect(current).toContain('restaurantDayBounds(today, zone)');
    expect(current).toContain('formatRestaurantTime(');
  });
});
