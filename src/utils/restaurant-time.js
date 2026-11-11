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
