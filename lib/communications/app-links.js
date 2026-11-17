/**
 * Resolve the existing customer and POS application base URLs used in emails.
 * Preserves the historical precedence and fallback behavior.
 * These are configuration helpers, not access-control or tenant-routing gates.
 */
export function customerAppUrl(env = process.env) {
  return env.CUSTOMER_APP_URL || env.CORS_ORIGIN || 'http://localhost:3001';
}

export function posAppUrl(env = process.env) {
  return env.POS_APP_URL || 'http://localhost:3000';
}
