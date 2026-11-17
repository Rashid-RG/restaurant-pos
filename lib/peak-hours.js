/**
 * Legacy per-restaurant peak-hour windows. This pure predicate deliberately
 * preserves the existing inclusive comparison and default hours. Timezone
 * normalization is a separate, tested change; callers supply local HH:mm.
 */
export function isPeakWindow(hhmm, settings = {}) {
  const lunchStart = settings.peakLunchStart || '11:30';
  const lunchEnd = settings.peakLunchEnd || '14:00';
  const dinnerStart = settings.peakDinnerStart || '18:30';
  const dinnerEnd = settings.peakDinnerEnd || '21:30';
  return (hhmm >= lunchStart && hhmm <= lunchEnd) || (hhmm >= dinnerStart && hhmm <= dinnerEnd);
}

/**
 * Inject tenant-scoped settings; never read another restaurant's schedule.
 * The current clock behavior is unchanged while modularizing.
 */
export function createPeakHourService({ getSettingsMap, now = () => new Date() }) {
  if (typeof getSettingsMap !== 'function') throw new TypeError('Tenant settings provider required');
  return async function isPeakHour(tenantId = 'default_tenant') {
    const date = now();
    const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const settings = await getSettingsMap(tenantId, ['peakLunchStart', 'peakLunchEnd', 'peakDinnerStart', 'peakDinnerEnd']);
    return isPeakWindow(hhmm, settings);
  };
}
