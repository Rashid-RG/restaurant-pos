import { billingConfig } from './saas-billing.js';
// Keep configuration validation side-effect free so boot failures are testable.
export function validateProductionConfig(env) {
  if (env.SAAS_BILLING_ENABLED !== undefined && !['true','false'].includes(env.SAAS_BILLING_ENABLED)) throw new Error('SAAS_BILLING_ENABLED must be true or false.');
  if (env.SAAS_BILLING_ENABLED === 'true') billingConfig(env);
  if (env.NODE_ENV !== 'production') return;
  const secret = (name) => {
    const value = String(env[name] || '').trim();
    if (value.length < 32 || /change.?me|replace|your_|mock_|dev.only|super_secret|998877/i.test(value)) {
      throw new Error(`${name} must be a unique random secret of at least 32 characters.`);
    }
    return value;
  };
  if (secret('JWT_SECRET') === secret('CUSTOMER_JWT_SECRET')) {
    throw new Error('Staff and customer JWT secrets must be different.');
  }
  if (!env.ADMIN_USERNAME?.trim()) throw new Error('ADMIN_USERNAME is required.');
  const password = String(env.ADMIN_PASSWORD || '');
  if (password.length < 12 || Buffer.byteLength(password) > 72 || /change.?me|password|admin123/i.test(password)) {
    throw new Error('ADMIN_PASSWORD must be a unique password between 12 and 72 bytes.');
  }
  if (!/^\d{6}$/.test(env.ADMIN_PIN || '') || /^(\d)\1+$|^123456$/.test(env.ADMIN_PIN)) {
    throw new Error('ADMIN_PIN must be a non-trivial six-digit PIN.');
  }
  const origins = String(env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('CORS_ORIGIN must contain explicit HTTPS origins.');
  if (env.PAYHERE_ENABLED !== undefined && !['true', 'false'].includes(env.PAYHERE_ENABLED)) throw new Error('PAYHERE_ENABLED must be true or false.');
  if (env.PAYHERE_ENABLED !== 'false') {
    for (const name of ['PAYHERE_MERCHANT_ID', 'PAYHERE_MERCHANT_SECRET']) {
      if (!env[name] || /change.?me|mock_|your_/i.test(env[name])) throw new Error(`${name} is required.`);
    }
    try {
      if (new URL(env.PAYHERE_NOTIFY_URL).protocol !== 'https:') throw new Error();
    } catch { throw new Error('PAYHERE_NOTIFY_URL must be a public HTTPS URL.'); }
  }
  // The current SQL migrations and transaction layer have only been verified on SQLite.
  if (env.DATABASE_URL) throw new Error('PostgreSQL production support is not yet validated. Use DATABASE_FILE for the supported single-instance deployment.');
  if (env.RENDER && !env.TURSO_DATABASE_URL) throw new Error('Render deployments require durable external storage. Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  if (env.TURSO_DATABASE_URL && !env.TURSO_DATABASE_URL.startsWith('file:')) {
    if (!env.TURSO_DATABASE_URL.startsWith('libsql://') || !env.TURSO_AUTH_TOKEN) throw new Error('Configure a libsql:// database URL and its Turso authentication token.');
  }
  if (env.RENDER && env.TURSO_DATABASE_URL?.startsWith('file:')) throw new Error('A local file is not durable storage on Render.');
}
