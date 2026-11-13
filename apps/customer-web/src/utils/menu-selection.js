// One source of truth for menu item availability, modifier cost and safe quantities.
// Browser-side validation improves UX; the backend remains authoritative at checkout.
export const MENU_QUANTITY_LIMIT = 100;

export function isMenuItemAvailable(item) {
  if (!item || item.isAvailable === false || item.isAvailable === 0) return false;
  if (item.stock != null && (!Number.isFinite(Number(item.stock)) || Number(item.stock) <= 0)) return false;
  return true;
}

export function maxMenuItemQuantity(item) {
  if (!isMenuItemAvailable(item)) return 0;
  if (item.stock == null) return MENU_QUANTITY_LIMIT;
  return Math.max(0, Math.min(MENU_QUANTITY_LIMIT, Math.floor(Number(item.stock))));
}

export function validMenuQuantity(qty, item) {
  return Number.isInteger(qty) && qty >= 1 && qty <= maxMenuItemQuantity(item);
}

export function menuItemTotal(item, qty, selectedModifiers = []) {
  const base = Number(item?.price);
  const modifiers = (selectedModifiers || []).reduce((sum, option) => sum + Number(option?.priceDelta), 0);
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(modifiers) || base + modifiers < 0 || !validMenuQuantity(qty, item)) return null;
  return Math.round((base + modifiers) * qty * 100) / 100;
}

export function isRequiredModifierMissing(groups, selectedModifiers = []) {
  return Object.entries(groups || {}).some(([group, modifiers]) =>
    modifiers.some(m => m.isRequired === true || Number(m.isRequired) === 1) &&
    !selectedModifiers.some(mod => mod.groupName === group)
  );
}
