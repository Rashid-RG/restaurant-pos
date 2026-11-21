// Build contact links only from recognizable phone numbers. Never invent a rider contact.
export function normalizeContactPhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const original = String(value).trim();
  if (!/^\+?[0-9\s().-]+$/.test(original)) return null;
  const digits = original.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  if (original.includes('+') && !original.startsWith('+')) return null;
  return (original.startsWith('+') ? '+' : '') + digits;
}
export function contactLinks(value) {
  const phone = normalizeContactPhone(value);
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // WhatsApp needs a country calling code; Sri Lankan domestic 0XX numbers
  // can be normalized reliably, but do not guess the country for other numbers.
  const waDigits = /^0\d{9}$/.test(digits) ? '94' + digits.slice(1)
    : /^(?:94\d{9})$/.test(digits) ? digits
    : phone.startsWith('+') ? digits : null;
  return { tel: 'tel:' + phone, whatsapp: waDigits ? 'https://wa.me/' + waDigits : null };
}
