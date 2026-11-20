// Server-persisted, tenant-scoped presentation preferences. Financial calculations,
// fiscal invoice allocation, kitchen tickets and database records are not altered.
export const RECEIPT_CONFIG_KEY = 'smartReceiptConfig';
export const DEFAULT_RECEIPT_CONFIG = Object.freeze({
  layout: 'compact', logo: true, logoSize: 46, showUnitPrice: false,
  showSubtotal: false, hideZeroTax: true, showOrderId: true,
  showInvoiceNumber: false, footer: 'friendly', customMessage: '',
  platformCredit: true
});
export function readReceiptConfig(settings = {}) {
  let saved = {};
  try {
    const raw = settings?.[RECEIPT_CONFIG_KEY];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
  } catch { /* Prefer safe defaults if an old setting is malformed. */ }
  const allowed = ['compact', 'standard', 'detailed'];
  return {
    layout: allowed.includes(saved.layout) ? saved.layout : DEFAULT_RECEIPT_CONFIG.layout,
    logo: saved.logo !== false,
    logoSize: [32,46,64,80].includes(Number(saved.logoSize)) ? Number(saved.logoSize) : 46,
    showUnitPrice: saved.showUnitPrice === true,
    showSubtotal: saved.showSubtotal === true,
    hideZeroTax: saved.hideZeroTax !== false,
    showOrderId: saved.showOrderId !== false,
    // Invoice numbers are internal by default. Tax invoice requirements must
    // be handled by a separate compliant invoice workflow when needed.
    showInvoiceNumber: false, // Customer receipts never expose sequential internal invoice numbers.
    footer: ['friendly', 'simple', 'custom', 'none'].includes(saved.footer) ? saved.footer : 'friendly',
    customMessage: typeof saved.customMessage === 'string' ? saved.customMessage.slice(0, 120) : '',
    platformCredit: saved.platformCredit !== false
  };
}
export function receiptFooterMessage(config) {
  switch (config.footer) {
    case 'none': return '';
    case 'simple': return 'Thank you!';
    case 'custom': return config.customMessage.trim().slice(0, 120);
    default: return 'Thank you! Visit again! :)';
  }
}
export function shouldPrintSubtotal(receipt, config) {
  const subtotal = Number(receipt?.subtotal || 0);
  const total = Number(receipt?.total || 0);
  return config.showSubtotal || Math.abs(subtotal - total) >= 0.005;
}
export function shouldPrintTax(receipt, config) {
  // Never hide non-zero tax. Zero-value tax can be suppressed for compact bills.
  return Number(receipt?.tax || 0) !== 0 || !config.hideZeroTax;
}
