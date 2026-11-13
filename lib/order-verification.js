import crypto from 'node:crypto';
import { normalizeLkPhone } from './notifications.js';

// This proof is independent of the login JWT: possession of one verified
// email or phone does not grant access to a customer account.
export const ORDER_PROOF_TTL_MS = 10 * 60 * 1000;
export const orderProofHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');

export function normalizeCheckoutContact(value) {
  const str = String(value || '').trim();
  if (str.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) ? str.toLowerCase() : '';
  const phone = normalizeLkPhone(str);
  return /^\+947\d{8}$/.test(phone) ? phone : '';
}

export async function issueOrderProof({ dbRun, tenantId, destination, now = Date.now() }) {
  const contact = normalizeCheckoutContact(destination);
  if (!tenantId || !contact) throw Error('Invalid contact for checkout verification.');
  const token = crypto.randomBytes(32).toString('base64url');
  await dbRun(
    'INSERT INTO order_verification_proofs (id,tenant_id,destination,tokenHash,expiresAt,createdAt) VALUES (?,?,?,?,?,?)',
    [crypto.randomUUID(),tenantId,contact,orderProofHash(token),now+ORDER_PROOF_TTL_MS,now]
  );
  return { checkoutProof: token, expiresAt: now+ORDER_PROOF_TTL_MS };
}

// Call this only *inside the same database transaction* as the order insert.
// A replay returns its existing order BEFORE this single-use proof is checked.
export async function consumeOrderProof({ dbRun, tenantId, checkoutProof, customerPhone, customerEmail, now = Date.now() }) {
  if (typeof checkoutProof !== 'string' || checkoutProof.length < 32 || checkoutProof.length > 128) return false;
  const contacts = [normalizeCheckoutContact(customerPhone),normalizeCheckoutContact(customerEmail)].filter(Boolean);
  if (!contacts.length) return false;
  const result = await dbRun(
    `UPDATE order_verification_proofs SET consumedAt=?
      WHERE tenant_id=? AND tokenHash=? AND consumedAt IS NULL AND expiresAt>?
      AND destination IN (${contacts.map(()=>'?').join(',')})`,
    [now,tenantId,orderProofHash(checkoutProof),now,...contacts]
  );
  return result?.changes === 1;
}
