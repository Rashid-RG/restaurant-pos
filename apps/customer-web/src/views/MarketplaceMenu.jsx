import { resolveCustomerImageUrl } from '../utils/native-image-url.js';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Store, ArrowUpRight, RefreshCw, MapPin, ShoppingBag } from 'lucide-react';
import { apiFetch, apiUrl } from '../utils/api.js';
import { marketplaceReadSignal } from '../utils/native-marketplace-timeout.js';
import './MarketplaceMenu.css';
import PromotionShowcase from '../components/PromotionShowcase.jsx';

const asItems = (menu) => Array.isArray(menu?.items) ? menu.items : [];
const isMenuItemAvailable = item => item.isAvailable !== 0 && item.isAvailable !== false && (item.stock === undefined || item.stock === null || Number(item.stock) > 0);
const toPrice = value => Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 });

export default function MarketplaceMenu({ onChooseStore }) {
  const [stores, setStores] = useState([]);
  const [menus, setMenus] = useState({});
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [promotionCount,setPromotionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failedMenus, setFailedMenus] = useState(0);
  const [limit, setLimit] = useState(24);
  const [menusLoaded, setMenusLoaded] = useState(0);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  // Open/closed state can change while a customer is browsing. Refresh the
  // public marketplace without changing their selected restaurant or cart.
  useEffect(() => {
    const onFocus = () => setRefresh(v => v + 1);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh(v => v + 1);
    }, 60000);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      setMenus({});
      setMenusLoaded(0);
      setFailedMenus(0);
      try {
        const discovered = await apiFetch('/public/restaurants', {
          cache: 'no-store',
          signal: marketplaceReadSignal({nativeBuild:import.meta.env.MODE==='native',parentSignal:controller.signal})
        });
        if (cancelled) return;
        const openStores = Array.isArray(discovered) ? discovered.filter(store => store && store.id && store.isOpen === true) : [];
        setStores(openStores);
        // Batch requests so a large marketplace does not overload the API.
        // Public menu lookups are tenant-scoped and cannot change the active cart tenant.
        for (let i = 0; i < openStores.length; i += 5) {
          const batch = openStores.slice(i, i + 5);
          const results = await Promise.allSettled(batch.map(async store => {
            const url = new URL(apiUrl('/api/public/menu'));
            url.searchParams.set('tenantId', store.id);
            const response = await fetch(url.toString(), {
              signal: marketplaceReadSignal({nativeBuild:import.meta.env.MODE==='native',parentSignal:controller.signal}),
              cache: 'no-store'
            });
            if (!response.ok) throw new Error('Unable to load store menu');
            const data = await response.json();
            if (data.tenantId !== store.id) throw new Error('Mismatched restaurant menu');
            return { id: store.id, data };
          }));
          if (cancelled) return;
          setFailedMenus(count => count + results.filter(result => result.status === 'rejected').length);
          setMenusLoaded(count => count + batch.length);
          setMenus(previous => {
            const next = { ...previous };
            for (const result of results) {
              if (result.status === 'fulfilled') next[result.value.id] = result.value.data;
            }
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load available restaurants');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; controller.abort(); };
  }, [refresh]);

  const allItems = useMemo(() => stores.flatMap(store => {
    const menu = menus[store.id];
    if (!menu || menu.storeOpen !== true) return [];
    return asItems(menu).filter(isMenuItemAvailable).map(item => ({ item, store }));
  }), [stores, menus]);

  const categories = useMemo(() => {
    const names = new Set();
    for (const {item} of allItems) {
      const category = String(item.categoryName || item.category || '').trim();
      // Never show internal category IDs (cat_*) in customer-facing filters.
      if (category && category.length <= 32 && !/^cat[_-]/i.test(category)) names.add(category);
    }
    return ['All', ...Array.from(names)];
  }, [allItems]);

  const visibleItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return allItems.filter(({ item, store }) => {
      const category = String(item.categoryName || item.category || '').trim();
      if (selectedCategory !== 'All' && category !== selectedCategory) return false;
      return !search || [item.name, item.description, store.name, store.cuisine, category]
        .some(value => String(value || '').toLocaleLowerCase().includes(search));
    });
  }, [allItems, query, selectedCategory]);

  const heroFoodImage = allItems.find(({item}) => item.imageUrl)?.item.imageUrl;
  // Automatically enrich store campaigns with a real photo from that store's
  // available public menu, never from another restaurant.
  const promotionImages = useMemo(() => {
    const images = {};
    for (const {item,store} of allItems) {
      if (item.imageUrl && !images[store.id]) images[store.id]=item.imageUrl;
    }
    return images;
  },[allItems]);

  return <div className="marketplace-menu">
    <PromotionShowcase stores={stores} itemImages={promotionImages} onChooseStore={onChooseStore} onCampaignCount={setPromotionCount}/>
    <section className={'marketplace-hero '+(promotionCount>0?'has-live-promotions':'')} >
      {promotionCount===0 && <div className="marketplace-hero-layout">
        <div className="marketplace-hero-copy">
          <h1>What are you craving today?</h1>

        </div>
        <div className="marketplace-hero-visual" aria-hidden="true">
          {heroFoodImage
            ? <img src={resolveCustomerImageUrl(heroFoodImage,{nativeBuild:import.meta.env.MODE==='native',configuredOrigin:import.meta.env.VITE_NATIVE_API_ORIGIN})} alt="" loading="lazy"/>
            : <span>🍜</span>}
        </div>
      </div>}
      <label className="marketplace-search">
        <Search size={21} aria-hidden="true"/>
        <span className="sr-only">Search available menus</span>
        <input value={query} onChange={e => { setQuery(e.target.value); setLimit(24); }} placeholder="Search dishes, restaurants or cuisines…" autoComplete="off"/>
      </label>
      <div className="marketplace-stats"><span><Store size={16}/> {stores.length} open restaurants</span><span><ShoppingBag size={16}/> {allItems.length} available dishes</span></div>
    </section>
    {categories.length > 1 && <div className="marketplace-category-row" role="group" aria-label="Filter dishes by category">
      {categories.map(category => <button key={category} type="button" className={selectedCategory === category ? 'is-active' : ''} aria-pressed={selectedCategory === category} onClick={() => { setSelectedCategory(category); setLimit(24); }}>{category === 'All' ? 'All dishes' : category}</button>)}
    </div>}

    {error && <div className="marketplace-error" role="alert">{error}<button type="button" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16}/> Retry</button></div>}
    {loading && <p className="marketplace-loading" role="status">Loading menus from available restaurants… {menusLoaded}/{stores.length}</p>}
    {!loading && !error && stores.length === 0 && <div className="marketplace-empty"><Store size={34}/><h2>No stores accepting online orders</h2><p>Please check again later or browse the Stores tab.</p></div>}
    {!loading && !error && failedMenus > 0 && <div className="marketplace-error" role="status">
      {failedMenus} restaurant {failedMenus === 1 ? 'menu is' : 'menus are'} temporarily unavailable.
      <button type="button" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16}/> Retry menus</button>
    </div>}
    {!loading && !error && failedMenus < stores.length && visibleItems.length === 0 && <div className="marketplace-empty"><Search size={32}/><h2>No matching dishes found</h2><p>Try another search or select a restaurant in Stores.</p>
      {(query || selectedCategory !== 'All') && <button className="btn btn-outline" onClick={() => { setQuery(''); setSelectedCategory('All'); setLimit(24); }}>Clear filters</button>}</div>}

    {visibleItems.length > 0 && <>
      <div className="marketplace-results-title"><div><h2>Available dishes</h2></div><small>{visibleItems.length} result{visibleItems.length === 1 ? '' : 's'}</small></div>
      <div className="marketplace-item-grid">
        {visibleItems.slice(0,limit).map(({ item, store }) => <article className="marketplace-item" key={`${store.id}:${item.id}`}>
          <div className="marketplace-item-image">
            {item.imageUrl ? <img src={resolveCustomerImageUrl(item.imageUrl,{nativeBuild:import.meta.env.MODE==='native',configuredOrigin:import.meta.env.VITE_NATIVE_API_ORIGIN})} loading="lazy" alt={item.name}/> : <div className="marketplace-item-fallback" aria-hidden="true">{item.emoji || '🍽️'}</div>}
            <span className="marketplace-item-store"><Store size={13}/> {store.name}</span>
          </div>
          <div className="marketplace-item-info">
            <h3>{item.name}</h3>
            <p>{item.description || store.cuisine || 'Freshly prepared'}</p>
            <div className="marketplace-item-footer"><strong>Rs. {toPrice(item.price)}</strong>
              <button type="button" onClick={() => onChooseStore(store)} aria-label={`View ${item.name} at ${store.name}`}>View menu <ArrowUpRight size={16}/></button>
            </div>
          </div>
        </article>)}
      </div>
      {visibleItems.length > limit && <button className="marketplace-more" type="button" onClick={() => setLimit(n => n + 24)}>Show more dishes ({visibleItems.length - limit} remaining)</button>}
    </>}
    {stores.length > 0 && <section className="marketplace-restaurants">
      <div className="marketplace-results-title"><div><h2>Choose your kitchen</h2></div></div>
      <div className="marketplace-store-grid">{stores.map(store => <button type="button" key={store.id} className="marketplace-store" onClick={() => onChooseStore(store)}>
        <div className="marketplace-store-icon"><Store size={23}/></div><div><strong>{store.name}</strong><small><MapPin size={12}/>{store.location || store.cuisine || 'Restaurant'}</small></div><ArrowUpRight size={20}/>
      </button>)}</div>
    </section>}
    <p className="marketplace-notice">Orders and carts remain restaurant-specific. Select a store to customize dishes and check out securely.</p>
  </div>;
}
