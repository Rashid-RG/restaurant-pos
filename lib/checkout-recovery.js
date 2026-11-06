import crypto from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const conflict = message => Object.assign(new Error(message), { status: 409 });

export async function initCheckoutRecovery(dbRun) {
  await dbRun(`CREATE TABLE IF NOT EXISTS checkout_requests (
    tenant_id TEXT NOT NULL, requestHash TEXT NOT NULL, payloadHash TEXT NOT NULL,
    orderId TEXT NOT NULL REFERENCES orders(id), createdAt BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, requestHash)
  )`);
}

// The random browser key is private recovery access. Store only its digest.
// Authentication tokens may rotate without changing an authenticated customer's intent.
export function checkoutIdentity(key, body, customerAccountId) {
  if (key == null) return null; // Older API clients keep their existing contract.
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw Object.assign(new Error('Use a private checkout key of 32 to 128 letters, digits, hyphens or underscores.'), { status: 400 });
  const { customerToken, ...intent } = body;
  return { requestHash: digest(key), payloadHash: digest(JSON.stringify(canonical({ intent, customerAccountId }))) };
}

export async function findRecoveredOrder({ dbGet, tenantId, identity }) {
  if (!identity) return null;
  const previous = await dbGet('SELECT payloadHash,orderId FROM checkout_requests WHERE tenant_id=? AND requestHash=?', [tenantId, identity.requestHash]);
  if (!previous) return null;
  if (previous.payloadHash !== identity.payloadHash) throw conflict('This checkout key belongs to a different order. Recover the previous checkout before starting another.');
  const order = await dbGet('SELECT * FROM orders WHERE id=? AND tenant_id=?', [previous.orderId, tenantId]);
  if (!order) throw conflict('The saved checkout needs restaurant support. Do not submit a replacement automatically.');
  return order;
}

// Called inside the same transaction as order, inventory and loyalty writes.
export async function saveCheckout({ dbRun, tenantId, identity, orderId }) {
  if (identity) await dbRun('INSERT INTO checkout_requests (tenant_id,requestHash,payloadHash,orderId,createdAt) VALUES (?,?,?,?,?)', [tenantId, identity.requestHash, identity.payloadHash, orderId, Date.now()]);
}

export function publicOrderConfirmation(order) {
  return {
    orderId: order.id, status: order.status, paymentStatus: order.paymentStatus,
    subtotal: order.subtotal, discount: order.discount, serviceCharge: order.serviceCharge,
    tax: order.tax, deliveryFee: order.deliveryFee, deliveryDistanceKm: order.deliveryDistanceKm,
    etaMinutes: order.etaMinutes, total: order.total
  };
}
