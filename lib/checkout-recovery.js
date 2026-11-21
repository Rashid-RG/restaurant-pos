// Compatibility layer for existing consumers; canonical implementation lives in lib/orders.
export { initCheckoutRecovery, checkoutIdentity, findRecoveredOrder, saveCheckout, publicOrderConfirmation } from './orders/checkout-recovery.js';
