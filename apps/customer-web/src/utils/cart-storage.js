// Private browser cart keys must be isolated per restaurant to avoid mixing orders.
export function cartStorageKey(tenantId) {
  return 'gastroflow_cart_items:' + encodeURIComponent(String(tenantId || 'default_tenant'));
}

export function parseSavedCart(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.id === 'string' && Number.isFinite(Number(item.qty)) && Number(item.qty)>0 && Number.isFinite(Number(item.unitPrice)));
  } catch { return []; }
}
