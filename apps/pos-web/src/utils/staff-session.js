// Classify authentication failures without equating every 403 with an expired login.
// A permission error, suspended tenant or billing restriction must not erase the
// employee's stored sign-in. The login expires only on an explicit auth failure.
export function isExpiredStaffSession(status, data = {}) {
  if (status !== 401 && status !== 403) return false;
  const code = String(data?.code || '').toUpperCase();
  if (['TENANT_SUSPENDED','TENANT_DELETED','SUBSCRIPTION_PAST_DUE','PLAN_LIMIT','FORBIDDEN'].includes(code)) return false;
  const message = String(data?.error || data?.message || '').toLowerCase();
  if (/suspend|deleted|no longer exists|subscription|billing|plan limit|insufficient role|unauthorized action|access denied|not permitted|only an owner|only a manager|permission/.test(message)) return false;
  if (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN' || code === 'AUTH_REQUIRED') return true;
  return /token (is )?(invalid|expired|missing)|authentication token required|session expired|invalid or expired token/.test(message);
}
export function restoreStaffSession(storage) {
  const token = storage?.getItem('gastroflow_token');
  if (!token) return null;
  try {
    const user = JSON.parse(storage.getItem('gastroflow_user') || 'null');
    return user && typeof user.id === 'string' && typeof user.tenant_id === 'string' ? user : null;
  } catch { return null; }
}
