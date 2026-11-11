// Tenant-local calendar helpers. Stored timestamps remain unchanged.
export const DEFAULT_TIME_ZONE = 'Asia/Colombo';

export function validTimeZone(zone) {
  if (typeof zone !== 'string' || zone.length > 100) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; }
  catch { return false; }
}

export function restaurantTimeZone(settings) {
  const zone = settings?.timeZone || settings?.timezone;
  return validTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

export function dateAtRestaurant(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)) {
    if (['year', 'month', 'day'].includes(part.type)) parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatRestaurantTime(instant, timeZone, options = {}) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    dateStyle: 'medium', timeStyle: 'short', ...options
  }).format(date);
}

// Shift a YYYY-MM-DD calendar date without using the user's device timezone.
export function shiftCalendarDate(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * UTC milliseconds delimiting a restaurant calendar day [start, end).
 * Each midnight is resolved independently to support 23/25-hour DST days.
 */
export function restaurantDayBounds(day, timeZone) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) {
    throw new RangeError('Invalid calendar date');
  }
  const zone = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const midnight = (calendarDay) => {
    const desired = Date.parse(calendarDay + 'T00:00:00Z');
    let guess = desired;
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    for (let i = 0; i < 4; i++) {
      const parts = {};
      for (const p of formatter.formatToParts(guess)) {
        if (['year','month','day','hour','minute','second'].includes(p.type)) parts[p.type] = Number(p.value);
      }
      const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const difference = desired - shown;
      guess += difference;
      if (difference === 0) break;
    }
    return guess;
  };
  return [midnight(day), midnight(shiftCalendarDate(day, 1))];
}
