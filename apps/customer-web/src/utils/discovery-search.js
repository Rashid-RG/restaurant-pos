// Accent-tolerant marketplace search across supported restaurant names and cuisine terms.
// Do not fabricate aliases: only index text actually supplied for each store.
export function normalizeDiscoveryQuery(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function matchesRestaurantQuery(store, value) {
  const query = normalizeDiscoveryQuery(value);
  if (!query) return true;
  const searchable = normalizeDiscoveryQuery([
    store?.name, store?.cuisine, store?.location, store?.cuisineTag
  ].filter(v => typeof v === 'string' && v.trim()).join(' '));
  return query.split(' ').every(term => searchable.includes(term));
}
