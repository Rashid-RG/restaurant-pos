import { restaurantTimeZone } from '../src/utils/restaurant-time.js';

/**
 * Restaurant-local peak windows. Inclusive boundaries and configured window
 * fallbacks preserve existing delivery pricing semantics.
 */
export function isPeakWindow(hhmm, settings = {}) {
  const lunchStart = settings.peakLunchStart || '11:30';
  const lunchEnd = settings.peakLunchEnd || '14:00';
  const dinnerStart = settings.peakDinnerStart || '18:30';
  const dinnerEnd = settings.peakDinnerEnd || '21:30';
  return (hhmm >= lunchStart && hhmm <= lunchEnd) || (hhmm >= dinnerStart && hhmm <= dinnerEnd);
}

/** Resolve a wall-clock HH:mm in the restaurant's configured IANA timezone. */
export function restaurantLocalHourMinute(instant, settings = {}) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: restaurantTimeZone(settings),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  const hour = parts.find(part => part.type === 'hour')?.value;
  const minute = parts.find(part => part.type === 'minute')?.value;
  return `${hour}:${minute}`;
}

/**
 * All settings are tenant-scoped. The default zone follows the same
 * Asia/Colombo fallback as existing restaurant-time reporting helpers.
 */
export function createPeakHourService({ getSettingsMap, now = () => new Date() }) {
  if (typeof getSettingsMap !== 'function') throw new TypeError('Tenant settings provider required');
  return async function isPeakHour(tenantId = 'default_tenant') {
    const settings = await getSettingsMap(tenantId, [
      'peakLunchStart', 'peakLunchEnd', 'peakDinnerStart', 'peakDinnerEnd', 'timeZone', 'timezone'
    ]);
    return isPeakWindow(restaurantLocalHourMinute(now(), settings), settings);
  };
}
