import { restaurantDayBounds, shiftCalendarDate } from '../src/utils/restaurant-time.js';

const cents = value => Math.round(Number(value || 0) * 100);
const money = value => Math.round(value) / 100;

export function payrollPeriod(month, timeZone) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new RangeError('Invalid payroll month');
  const [year, mon] = month.split('-').map(Number);
  if (year < 2000 || year > 2100 || mon < 1 || mon > 12) throw new RangeError('Invalid payroll month');
  const nextMonth = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return { start: restaurantDayBounds(month + '-01', timeZone)[0], end: restaurantDayBounds(nextMonth + '-01', timeZone)[0] };
}

export function attendanceMinutes(entries, start, end) {
  let milliseconds = 0;
  let sessions = 0;
  for (const entry of entries || []) {
    const clockIn = Number(entry.clockIn);
    const clockOut = Number(entry.clockOut);
    // Open timeclock sessions require supervisor review; never silently pay unverified hours.
    if (!Number.isFinite(clockIn) || !Number.isFinite(clockOut) || !clockOut || clockOut <= clockIn) continue;
    const minutes = Math.max(0, Math.min(clockOut, end) - Math.max(clockIn, start));
    if (minutes > 0) { milliseconds += minutes; sessions++; }
  }
  return { minutes: Math.round(milliseconds / 60000), sessions };
}

export function previewPayroll({ month, timeZone, users, entries, compensation }) {
  const { start, end } = payrollPeriod(month, timeZone);
  const configs = new Map((compensation || []).map(c => [c.userId, c]));
  return (users || []).map(user => {
    const configuration = configs.get(user.id);
    const times = attendanceMinutes((entries || []).filter(e => e.userId === user.id), start, end);
    const hours = Math.round((times.minutes / 60) * 100) / 100;
    const rate = configuration ? Number(configuration.rate) : 0;
    const basicCents = configuration?.payType === 'monthly' ? cents(rate) : Math.round(rate * 100 * times.minutes / 60);
    const allowancesCents = configuration ? cents(configuration.allowance) : 0;
    const deductionsCents = configuration ? cents(configuration.deduction) : 0;
    return {
      userId: user.id, username: user.username, role: user.role, month,
      payType: configuration?.payType || null, rate, hours, sessions: times.sessions,
      allowance: money(allowancesCents), deduction: money(deductionsCents),
      basicPay: money(basicCents), totalPay: money(Math.max(0, basicCents + allowancesCents - deductionsCents)),
      configured: Boolean(configuration)
    };
  });
}
