/**
 * lib/plans.js — SaaS subscription plan definitions + limit helpers.
 *
 * Pure, dependency-free, and unit-testable. The server reads live usage from the
 * DB and compares against these limits to enforce per-plan seat + volume caps.
 * `Infinity` means unlimited (enterprise).
 */
export const PLANS = {
  basic: { label: 'Basic', maxUsers: 3, maxOrdersPerMonth: 500, priceLkr: 4900 },
  pro: { label: 'Pro', maxUsers: 15, maxOrdersPerMonth: 5000, priceLkr: 14900 },
  enterprise: { label: 'Enterprise', maxUsers: Infinity, maxOrdersPerMonth: Infinity, priceLkr: 49900 }
};

export const DEFAULT_PLAN = 'basic';

export function getPlan(plan) {
  return PLANS[plan] || PLANS[DEFAULT_PLAN];
}

/**
 * Decide whether an action is allowed under a plan given current usage.
 * @returns {{ allowed: boolean, limit: number, current: number, reason?: string }}
 */
export function checkLimit(plan, resource, current) {
  const limits = getPlan(plan);
  const key = resource === 'users' ? 'maxUsers' : 'maxOrdersPerMonth';
  const limit = limits[key];
  if (current < limit) return { allowed: true, limit, current };
  return {
    allowed: false,
    limit,
    current,
    reason: resource === 'users'
      ? `Your ${limits.label} plan allows up to ${limit} staff users. Upgrade to add more.`
      : `Your ${limits.label} plan allows ${limit} orders per month. Upgrade to continue taking orders.`
  };
}

export function planList() {
  return Object.entries(PLANS).map(([id, p]) => ({ id, ...p }));
}
