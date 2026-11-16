// Client-side validation for a single, explicit GastroMate multi-item cart confirmation.
// Recheck against fresh server menu data. Checkout MUST independently revalidate prices.
import { isMenuItemAvailable, maxMenuItemQuantity, menuItemTotal } from './menu-selection.js';

function validQuantity(value) {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}
export function prepareGastroBatch(plan, menu, cartItems = [], tenantId = '') {
  const fail = reason => ({ ok: false, reason, items: [], subtotal: 0 });
  if (!tenantId || !menu || String(menu.tenantId) !== String(tenantId) || menu.offlineSnapshot) {
    return fail('Restaurant selection changed or menu is offline. Please reload the restaurant menu.');
  }
  if (menu.storeOpen !== true) return fail('This restaurant is not accepting online orders.');
  if (!plan || plan.type !== 'multi_item_preview' || !Array.isArray(plan.lines) ||
      plan.lines.length < 2 || plan.lines.length > 6 || !plan.totalKnown) {
    return fail('Your food selection contains unclear items. Please review them individually.');
  }
  const all = Array.isArray(menu.items) ? menu.items : [];
  const indexed = new Map(all.map(item => [String(item.id), item]));
  const combined = new Map();
  for (const entry of plan.lines) {
    const id = String(entry?.itemId || '');
    const quantity = Number(entry?.quantity);
    const item = indexed.get(id);
    if (!item || !validQuantity(quantity) || !isMenuItemAvailable(item)) {
      return fail('One of these items is no longer available. Please review the menu again.');
    }
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    if (modifiers.length) {
      return fail(item.name + ' requires customization. Please select options from the menu first.');
    }
    const total = menuItemTotal(item, quantity);
    if (total == null) return fail('Invalid item price or quantity. Please review the menu.');
    combined.set(id, { item, quantity: (combined.get(id)?.quantity || 0) + quantity });
  }
  const verified = [];
  let subtotal = 0;
  for (const {item, quantity} of combined.values()) {
    const existingQty = (Array.isArray(cartItems) ? cartItems : [])
      .filter(entry => String(entry.id) === String(item.id))
      .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
    if (!Number.isFinite(existingQty) || existingQty < 0 ||
        quantity + existingQty > maxMenuItemQuantity(item)) {
      return fail('Not enough stock for ' + item.name + ', including items already in your cart.');
    }
    subtotal += menuItemTotal(item, quantity);
    verified.push({item, quantity});
  }
  subtotal = Math.round(subtotal * 100) / 100;
  // No claim of fee-inclusive budget compliance. Modifier-free base prices only.
  if (plan.budget != null && subtotal > Number(plan.budget)) {
    return fail('The refreshed food subtotal exceeds your stated budget.');
  }
  return {ok:true, reason:'', items:verified, subtotal};
}
