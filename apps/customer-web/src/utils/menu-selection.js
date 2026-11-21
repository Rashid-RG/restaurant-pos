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

 
// Keep selection semantics consistent for checkbox/radio groups, including
// menu APIs that omit the groupName on individual modifier options.
export function toggleMenuModifier(selected = [], option, groupName, multiSelect = false) {
  const group = String(groupName || option?.groupName || '').trim();
  if (!option || !group || option.id == null) return [...selected];
  const normalized = {...option, groupName:group};
  const rest = (selected || []).filter(m =>
    multiSelect ? !(String(m.id) === String(option.id) && String(m.groupName || '') === group)
      : String(m.groupName || '') !== group
  );
  const alreadySelected = (selected || []).some(m =>
    String(m.id) === String(option.id) && String(m.groupName || '') === group
  );
  if (multiSelect && alreadySelected) return rest;
  return [...rest, normalized];
}

// Validate the exact options against the item's current modifier configuration.
// Client checks are advisory; checkout must still verify variants and pricing.
export function validateMenuModifiers(item, selected = []) {
  const options = Array.isArray(item?.modifiers) ? item.modifiers : [];
  const grouped = {};
  for (const option of options) {
    const group = String(option?.groupName || '').trim();
    if (!group) continue;
    (grouped[group] ||= []).push(option);
  }
  const seen = new Set();
  for (const mod of selected || []) {
    const group = String(mod?.groupName || '').trim();
    const valid = (grouped[group] || []).find(x => String(x.id) === String(mod.id));
    if (!valid || seen.has(group + ':' + String(mod.id))) return false;
    seen.add(group + ':' + String(mod.id));
  }
  for (const [group, choices] of Object.entries(grouped)) {
    const chosen = (selected || []).filter(mod => String(mod.groupName) === group);
    const required = choices.some(x => x.isRequired === true || Number(x.isRequired) === 1);
    const multi = choices.some(x => x.isMultiSelect === true || Number(x.isMultiSelect) === 1);
    if (required && !chosen.length) return false;
    if (!multi && chosen.length > 1) return false;
  }
  return true;
}

export function remainingMenuQuantity(item, existingQuantity = 0) {
  const already = Number(existingQuantity);
  if (!Number.isFinite(already) || already < 0) return 0;
  return Math.max(0, maxMenuItemQuantity(item) - Math.floor(already));
}
