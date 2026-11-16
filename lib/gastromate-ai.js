// GastroMate's stateless trust boundary. No database writes and no credentials.
// All menu records must already be fetched with tenant_id = resolved tenant.
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 600;

export function normalizeGastroHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).filter(turn =>
    turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
  ).slice(-MAX_TURNS).map(turn => ({
    role: turn.role,
    content: turn.content.trim().slice(0, MAX_TURN_CHARS)
  })).filter(turn => turn.content);
}

export function isGastroMenuItemAvailable(item) {
  return !!item && (item.isAvailable == null || (item.isAvailable !== false && item.isAvailable !== 'false' && Number(item.isAvailable) !== 0)) &&
    (item.stock == null || (Number.isFinite(Number(item.stock)) && Number(item.stock) > 0)) &&
    Number.isFinite(Number(item.price)) && Number(item.price) >= 0;
}

export function selectGastroMenu(items, query, history = [], max = 60) {
  const terms = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const prior = normalizeGastroHistory(history).filter(t => t.role === 'user').slice(-2)
    .map(t => t.content).join(' ').toLowerCase();
  const score = item => {
    const name = String(item.name || '').toLowerCase();
    const text = [name, item.category, item.description, item.dietaryTags].join(' ').toLowerCase();
    const termScore = terms.reduce((sum, term) =>
      sum + (term.length > 2 && name.includes(term) ? 5 : term.length > 2 && text.includes(term) ? 2 : 0), 0);
    return termScore + (prior && name.length > 2 && prior.includes(name) ? 4 : 0);
  };
  return (Array.isArray(items) ? items : []).filter(isGastroMenuItemAvailable)
    .map((item, index) => ({item, index, rank: score(item)}))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, Math.min(Math.max(1, Number(max) || 60), 80))
    .map(({item}) => ({
      id: item.id, name: item.name, price: Number(item.price),
      category: item.category, dietaryTags: item.dietaryTags,
      description: String(item.description || '').slice(0, 150)
    }));
}

export function gastroCartContext(cartItems, menuItems) {
  const allowed = new Map((menuItems || []).filter(isGastroMenuItemAvailable).map(item => [String(item.id), item]));
  return (Array.isArray(cartItems) ? cartItems.slice(0, 30) : []).flatMap(entry => {
    const item = allowed.get(String(entry?.id || entry?.menuItemId || ''));
    if (!item) return [];
    const qty = Number(entry?.qty ?? entry?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) return [];
    return [{id: item.id, name: item.name, quantity: qty}];
  });
}

export function gastroPrivateOrderQuestion(message) {
  return /\b(track|tracking|cancel|cancellation|where.*(order|driver)|order status|my order|refund|delivery status)\b/i.test(String(message || ''));
}

export function validateGastroResponse(raw, items) {
  const available = new Map((items || []).filter(isGastroMenuItemAvailable).map(item => [String(item.id), item]));
  const ids = Array.isArray(raw?.recommendedItemIds) ? raw.recommendedItemIds : [];
  const recommendedItems = [...new Set(ids.map(String))].slice(0, 5)
    .map(id => available.get(id)).filter(Boolean);
  const rawAction = raw?.action;
  let action = null;
  if (rawAction?.type === 'connect_support') action = {type: 'connect_support'};
  if (rawAction?.type === 'add_to_cart') {
    const item = available.get(String(rawAction.itemId || ''));
    const quantity = Number(rawAction.quantity);
    if (item && Number.isInteger(quantity) && quantity > 0 && quantity <= 20 &&
        (item.stock == null || quantity <= Number(item.stock))) {
      action = {type: 'add_to_cart', itemId: String(item.id), quantity};
    }
  }
  const proposedItem = action?.type === 'add_to_cart' ? available.get(action.itemId) : null;
  return {
    // No model-produced claim is allowed to imply a cart mutation succeeded.
    reply: proposedItem
      ? `I found ${proposedItem.name} for Rs. ${Number(proposedItem.price)}. Confirm below if you would like to add it to your cart.`
      : typeof raw?.reply === 'string' && raw.reply.trim()
        ? raw.reply.trim().slice(0, 3500) : 'I can help with available menu items. What would you like?',
    recommendedItems,
    suggestions: (Array.isArray(raw?.suggestions) ? raw.suggestions : [])
      .filter(s => typeof s === 'string').slice(0, 4).map(s => s.slice(0, 75)),
    action
  };
}

/** Extract a customer-stated individual-item budget. Never treat quantities as prices. */
export function gastroBudget(text) {
  const cleaned = String(text || '').replace(/(?<=\\d),(?=\\d{3}\\b)/g, '');
  const match = cleaned.match(/(?:\\b(?:under|below|less than|up to|budget(?: of)?|within|maximum|rs\\.?|lkr)\\s*(?:rs\\.?|lkr)?\\s*)(\\d{2,6})(?:\\b|\\s|$)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return amount >= 50 && amount <= 100000 ? amount : null;
}

export function groundedGastroRecommendations(items, query, history = []) {
  const recent = normalizeGastroHistory(history).filter(t => t.role === 'user');
  const context = String(query || '');
  const budget = gastroBudget(context) ?? gastroBudget(recent.at(-1)?.content);
  const isVeg = /\\b(vegetarian|vegan|veg food|veggie)\\b|ශාකභක්ෂක|சைவ/i.test(context);
  const isVegan = /\\bvegan\\b/i.test(context);
  const isSpicy = /\\b(spicy|hot food|fiery)\\b|සැර|காரமான/i.test(context);
  const candidates = (Array.isArray(items) ? items : []).filter(isGastroMenuItemAvailable)
    .filter(item => budget == null || Number(item.price) <= budget)
    .filter(item => !isVeg || (isVegan
      ? /(?:^|[,\\s|])vegan(?:$|[,\\s|])/i.test(String(item.dietaryTags || ''))
      : /(?:^|[,\\s|])(?:vegetarian|vegan|veg)(?:$|[,\\s|])/i.test(String(item.dietaryTags || ''))))
    .filter(item => !isSpicy || /spicy|hot|devilled|kottu/i.test([item.dietaryTags,item.name].join(' ')));
  const ranked = selectGastroMenu(candidates, context, history, 5);
  return {
    recommendedItems: ranked.map(i => candidates.find(c => String(c.id) === String(i.id))).filter(Boolean),
    budget,
    restricted: budget != null || isVeg || isSpicy,
    label: isVegan ? 'vegan-tagged' : isVeg ? 'vegetarian-tagged' : isSpicy ? 'spicy' : 'available'
  };
}

/** Do not let the model write unverified food prices/availability claims. */
export function gastroVerifiedReply(items, intro = 'Here are options from this restaurant') {
  if (!items.length) return 'I could not find a currently available menu item matching that request. Try changing the budget or preference.';
  const lines = items.slice(0,5).map(item => `• ${item.name} — Rs. ${Number(item.price)}`);
  return `${intro}:\\n${lines.join('\\n')}\\n\\nPrices shown are for menu items before checkout fees and customizations. Please confirm item options before ordering.`;
}
