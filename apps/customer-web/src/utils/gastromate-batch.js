// Client-side validation for a single, explicit GastroMate multi-item cart confirmation.
// Recheck against fresh server menu data. Checkout MUST independently revalidate prices.
import { isMenuItemAvailable, maxMenuItemQuantity, menuItemTotal } from './menu-selection.js';

function validQuantity(value) {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}
export function prepareGastroBatch(plan, menu, cartItems = [], tenantId = '') {
  const fail = reason => ({ ok: false, reason, items: [], subtotal: 0 });
  if (!tenantId || !menu || String(plan?.tenantId) !== String(tenantId) ||
      String(menu.tenantId) !== String(tenantId) || menu.offlineSnapshot) {
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


/** Atomic reducer for a confirmed batch. Any stale/invalid line leaves cart untouched. */
export function applyGastroBatch(currentItems, verifiedItems) {
  if (!Array.isArray(currentItems) || !Array.isArray(verifiedItems) ||
      verifiedItems.length < 2 || verifiedItems.length > 6) return currentItems;
  const copy = currentItems.slice();
  const counts = new Map();
  for (const row of verifiedItems) {
    const item = row?.item;
    const quantity = row?.quantity;
    if (!item || !validQuantity(quantity) || !isMenuItemAvailable(item) ||
        (Array.isArray(item.modifiers) && item.modifiers.length > 0) ||
        menuItemTotal(item, quantity) == null) return currentItems;
    counts.set(String(item.id), (counts.get(String(item.id)) || 0) + quantity);
  }
  for (const [id, qty] of counts) {
    const item = verifiedItems.find(row => String(row.item.id) === id).item;
    const existingQty = copy.filter(row => String(row.id) === id)
      .reduce((sum,row)=>sum + Number(row.qty||0),0);
    if (!Number.isFinite(existingQty) || existingQty + qty > maxMenuItemQuantity(item))
      return currentItems;
  }
  for (const [id, qty] of counts) {
    const item = verifiedItems.find(row => String(row.item.id) === id).item;
    const uniqueId = String(item.id) + '__';
    const price = menuItemTotal(item, 1);
    const index = copy.findIndex(row => row.cartId === uniqueId);
    if (index >= 0) copy[index] = {...copy[index], qty:Number(copy[index].qty)+qty, unitPrice:price};
    else copy.push({...item, cartId:uniqueId, qty, selectedModifiers:[],notes:'',unitPrice:price});
  }
  return copy;
}
