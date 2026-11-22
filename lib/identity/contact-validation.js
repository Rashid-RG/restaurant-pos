/**
 * Legacy customer contact validation shared by OTP and checkout.
 * Preserve the existing API acceptance policy during server modularization.
 * Do not silently broaden accepted phone formats without matching backend tests.
 */
export function isValidSriLankanPhone(phone) {
  if (!phone) return false;
  const cleanPhone = phone.replace(/[\s-]/g, '');
  return /^(?:\+94|0)7\d{8}$/.test(cleanPhone);
}

export function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  return trimmed.length >= 3;
}
