import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search, SlidersHorizontal, Store, ArrowUpRight, RefreshCw, Star, Clock3, Bike, CheckCircle2, AlertCircle, Navigation, ShoppingBag, MapPinned, Sparkles } from 'lucide-react';
import L from 'leaflet';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import { calculateHaversineDistanceKm, resolveAddressToCoords, evaluateStoreProximity } from '../utils/geo.js';
import { acceptsOnlineOrders, recommendationScore, recommendedOpenStores } from '../utils/marketplace-availability.js';
import { restaurantRatingText, restaurantDeliveryText, restaurantEmptyState, sortRestaurants } from '../utils/discovery-display.js';


const CUISINE_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🍽️' },
  { id: 'srilankan', label: 'Sri Lankan', icon: '🍛' },
  { id: 'burgers', label: 'Burgers', icon: '🍔' },
  { id: 'pizza', label: 'Pizza', icon: '🍕' },
  { id: 'asian', label: 'Asian', icon: '🍜' },
  { id: 'healthy', label: 'Healthy', icon: '🥗' },
  { id: 'desserts', label: 'Desserts', icon: '🍰' }
];

export default function RestaurantsView({ onSelectRestaurant, toast = () => {} }) {
  const { t, dict } = useLang();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('all');

  const [deliveryLocation, setDeliveryLocation] = useState(
    localStorage.getItem('gastroflow_delivery_address') || 'Detecting Location...'
  );
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [customAddressInput, setCustomAddressInput] = useState('');

  const [userCoords, setUserCoords] = useState(null);
  const [nearestStore, setNearestStore] = useState(null);
  const [isOutOfCoverage, setIsOutOfCoverage] = useState(false);
  const [showOutOfCoverageModal, setShowOutOfCoverageModal] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dismissedCoverage, setDismissedCoverage] = useState(false);
  const [userAccuracy, setUserAccuracy] = useState(null);

  // Render location dialogs outside scrolling app ancestors and freeze the
  // underlying page while either dialog is visible (especially important on iOS).
  useEffect(() => {
    if (!showLocationModal && !showOutOfCoverageModal) return;
    const y = window.scrollY;
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      Object.assign(document.body.style, {
        position: previous.position, top: previous.top,
        left: previous.left, right: previous.right,
        width: previous.width, overflow: previous.overflow
      });
      document.documentElement.style.overflow = previous.htmlOverflow;
      window.scrollTo(0, y);
    };
  }, [showLocationModal, showOutOfCoverageModal]);

  const CITY_COORDS = {
    'Colombo 03, Western': { lat: 6.9147, lng: 79.8517 },
    'Colombo 01, Western': { lat: 6.9344, lng: 79.8428 },
    'Colombo 07, Western': { lat: 6.9080, lng: 79.8660 },
    'Dehiwala, Western': { lat: 6.8511, lng: 79.8650 },
    'Nugegoda, Western': { lat: 6.8724, lng: 79.8872 },
    'Battaramulla, Western': { lat: 6.8973, lng: 79.9220 },
    'Kotte, Western': { lat: 6.8906, lng: 79.9015 },
    'Negombo, Western': { lat: 7.2083, lng: 79.8358 },
    'Galgamuwa, North Western': { lat: 7.9861, lng: 80.2921 },
    'Galgamuwa, North Western Province': { lat: 7.9861, lng: 80.2921 },
    'Kurunegala, North Western': { lat: 7.4863, lng: 80.3647 },
    'Puttalam, North Western': { lat: 8.0362, lng: 79.8283 },
    'Chilaw, North Western': { lat: 7.5758, lng: 79.7953 },
    'Anuradhapura, North Central': { lat: 8.3114, lng: 80.4037 },
    'Polonnaruwa, North Central': { lat: 7.9403, lng: 81.0188 },
    'Kandy City, Central': { lat: 7.2906, lng: 80.6337 },
    'Matale, Central': { lat: 7.4675, lng: 80.6234 },
    'Nuwara Eliya, Central': { lat: 6.9497, lng: 80.7891 },
    'Galle Fort, Southern': { lat: 6.0535, lng: 80.2210 },
    'Matara, Southern': { lat: 5.9549, lng: 80.5550 },
    'Hambantota, Southern': { lat: 6.1247, lng: 81.1185 },
    'Jaffna City, Northern': { lat: 9.6615, lng: 80.0255 },
    'Vavuniya, Northern': { lat: 8.7514, lng: 80.4971 },
    'Mannar, Northern': { lat: 8.9810, lng: 79.9044 },
    'Trincomalee, Eastern': { lat: 8.5874, lng: 81.2152 },
    'Batticaloa, Eastern': { lat: 7.7310, lng: 81.6747 },
    'Badulla, Uva': { lat: 6.9934, lng: 81.0550 },
    'Bandarawela, Uva': { lat: 6.8324, lng: 80.9856 },
    'Ratnapura, Sabaragamuwa': { lat: 6.6828, lng: 80.3992 },
    'Kegalle, Sabaragamuwa': { lat: 7.2513, lng: 80.3464 }
  };

  const calculateHaversineKm = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
  };

  const resolveCoordsForAddress = (address) => {
    if (!address) return null;
    if (CITY_COORDS[address]) return CITY_COORDS[address];
    const lower = String(address).toLowerCase();

    for (const [key, coords] of Object.entries(CITY_COORDS)) {
      const cityName = key.split(',')[0].toLowerCase().trim();
      if (lower.includes(cityName) || cityName.includes(lower)) return coords;
    }

    // Specific town keyword matchers
    if (lower.includes('galgamuwa')) return { lat: 7.9861, lng: 80.2921 };
    if (lower.includes('kurunegala')) return { lat: 7.4863, lng: 80.3647 };
    if (lower.includes('anuradhapura')) return { lat: 8.3114, lng: 80.4037 };
    if (lower.includes('puttalam')) return { lat: 8.0362, lng: 79.8283 };
    if (lower.includes('kandy')) return { lat: 7.2906, lng: 80.6337 };
    if (lower.includes('galle')) return { lat: 6.0535, lng: 80.2210 };
    if (lower.includes('jaffna')) return { lat: 9.6615, lng: 80.0255 };
    if (lower.includes('trincomalee')) return { lat: 8.5874, lng: 81.2152 };
    if (lower.includes('matara')) return { lat: 5.9549, lng: 80.5550 };
    if (lower.includes('badulla')) return { lat: 6.9934, lng: 81.0550 };
    if (lower.includes('ratnapura')) return { lat: 6.6828, lng: 80.3992 };

    return null;
  };



  // Browsing should never require sharing GPS on initial page load.
  // Customers can explicitly select a city, precise pin, or GPS location.

  const detectRealGpsLocation = () => {
    if (!('geolocation' in navigator)) {
      toast('Geolocation not supported. Select a city or address.', 'warning');
      return;
    }
    setIsDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy || 0);

          // Country & Distance Sanity Check: Sri Lanka bounds (Lat 5.0 - 10.0 N, Lng 79.0 - 82.0 E)
          const isInsideSriLanka = lat >= 5.0 && lat <= 10.0 && lng >= 79.0 && lng <= 82.0;

          if (!isInsideSriLanka) {
            toast('Location is outside Sri Lanka. Please select a Sri Lankan address.', 'warning');
            return;
          }

          setUserCoords({ lat, lng });
          setUserAccuracy(accuracy);

          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=lk`);
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const city = addr.suburb || addr.city || addr.town || addr.village || addr.county || 'Detected Pin';
            const country = addr.country || 'Sri Lanka';
            const state = addr.state || country || 'GPS Location';
            const resolvedStr = `${city}, ${state}`;
            setDeliveryLocation(resolvedStr);
            localStorage.setItem('gastroflow_delivery_address', resolvedStr);
          } else {
            const coordsStr = `GPS Pin (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
            setDeliveryLocation(coordsStr);
            localStorage.setItem('gastroflow_delivery_address', coordsStr);
          }

          processStoreProximity(lat, lng);
        } catch (e) {
          toast('Could not determine the address. Choose your location manually.', 'warning');
        } finally {
          setIsDetectingGps(false);
        }
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setIsDetectingGps(false);
        toast('Location unavailable. Select a city or enter an address.', 'warning');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSelectPredefinedCity = (cityStr) => {
    setDeliveryLocation(cityStr);
    localStorage.setItem('gastroflow_delivery_address', cityStr);
    setShowLocationModal(false);

    const coords = CITY_COORDS[cityStr] || resolveCoordsForAddress(cityStr);
    if (coords) {
      setUserCoords(coords);
      localStorage.setItem('gastroflow_user_coords', JSON.stringify(coords));
      processStoreProximity(coords.lat, coords.lng);
    }
  };

  const [addressSearchResults, setAddressSearchResults] = useState([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const mapContainerRef = useRef(null);

  // Live forward geocoding address autocomplete search
  useEffect(() => {
    if (!customAddressInput || customAddressInput.trim().length < 3) {
      setAddressSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingAddress(true);
      try {
        const query = encodeURIComponent(customAddressInput.trim());
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=lk&limit=5`);
        if (res.ok) {
          const data = await res.json();
          setAddressSearchResults(data || []);
        }
      } catch (err) {
        console.warn('Forward geocoding search error:', err);
      } finally {
        setIsSearchingAddress(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [customAddressInput]);

  const handleSelectAddressSuggestion = (item) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const displayParts = (item.display_name || '').split(',');
    const shortAddr = displayParts.slice(0, 3).join(', ').trim() || 'Custom Pin';

    setUserCoords({ lat, lng });
    setDeliveryLocation(shortAddr);
    localStorage.setItem('gastroflow_delivery_address', shortAddr);
    localStorage.setItem('gastroflow_user_coords', JSON.stringify({ lat, lng }));

    processStoreProximity(lat, lng);
    setShowLocationModal(false);
    setCustomAddressInput('');
    setAddressSearchResults([]);
    toast(`📍 Delivery location set: ${shortAddr}`, 'success');
  };

  const handleSaveCustomAddress = async (e) => {
    e.preventDefault();
    if (!customAddressInput.trim()) return;

    setIsSearchingAddress(true);
    const manualAddr = customAddressInput.trim();
    try {
      const query = encodeURIComponent(manualAddr);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=lk&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          handleSelectAddressSuggestion(data[0]);
          return;
        }
      }
    } catch (err) {
      console.warn('Geocoding submit error:', err);
    } finally {
      setIsSearchingAddress(false);
    }

    // Fuzzy match against Sri Lanka city dictionary
    const matchedCoords = resolveCoordsForAddress(manualAddr);
    if (matchedCoords) {
      setUserCoords(matchedCoords);
      localStorage.setItem('gastroflow_user_coords', JSON.stringify(matchedCoords));
      processStoreProximity(matchedCoords.lat, matchedCoords.lng);
    }

    setDeliveryLocation(manualAddr);
    localStorage.setItem('gastroflow_delivery_address', manualAddr);
    setShowLocationModal(false);
    setCustomAddressInput('');
    toast(`Delivery address saved: ${manualAddr}`, 'success');
  };

  const handlePinLocationChange = async (lat, lng) => {
    setUserCoords({ lat, lng });
    localStorage.setItem('gastroflow_user_coords', JSON.stringify({ lat, lng }));
    processStoreProximity(lat, lng);

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=lk`);
      if (res.ok) {
        const data = await res.json();
        const addr = data.address || {};
        const shortStr = `${addr.suburb || addr.road || addr.village || 'Custom Pin'}, ${addr.city || addr.town || addr.county || 'Sri Lanka'}`;
        setDeliveryLocation(shortStr);
        localStorage.setItem('gastroflow_delivery_address', shortStr);
      }
    } catch (_) {}
  };

  useEffect(() => {
    const savedCoordsRaw = localStorage.getItem('gastroflow_user_coords');
    let activeCoords = null;
    if (savedCoordsRaw) {
      try { activeCoords = JSON.parse(savedCoordsRaw); } catch (_) {}
    }
    if (!activeCoords) {
      const savedAddr = localStorage.getItem('gastroflow_delivery_address');
      activeCoords = resolveCoordsForAddress(savedAddr);
    }

    if (activeCoords) {
      setUserCoords(activeCoords);
    }

    fetchRestaurants(activeCoords);
  }, []);

  // Keep public store-open statuses current when another tab or owner POS
  // toggles availability. Browsing does not require GPS permission.
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState !== 'visible') return;
      let lastCoords = null;
      try {
        const saved = JSON.parse(localStorage.getItem('gastroflow_user_coords') || 'null');
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) lastCoords = saved;
      } catch (_) {}
      fetchRestaurants(lastCoords);
    };
    const interval = window.setInterval(reload, 45000);
    window.addEventListener('focus', reload);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', reload); };
  }, []);

  const [sortBy, setSortBy] = useState('recommendation');

  // Strict deduplication helper
  const deduplicateStores = (storeList) => {
    const map = new Map();
    (storeList || []).forEach(s => {
      if (s && s.id && !map.has(s.id)) {
        map.set(s.id, s);
      }
    });
    return Array.from(map.values());
  };

  // ── Dynamic Delivery Fee: Base + Distance × Rate × Rush-Hour Multiplier ──
  const calculateDynamicFee = (dist, isInRange) => {
    if (!isInRange) return 250;
    const BASE = 80;
    const RATE_PER_KM = 20; // LKR per km
    const now = new Date();
    const hour = now.getHours();
    const isRushHour = (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21);
    const multiplier = isRushHour ? 1.3 : 1.0;
    const raw = (BASE + dist * RATE_PER_KM) * multiplier;
    return Math.min(600, Math.max(80, Math.round(raw)));
  };

  const isCurrentlyRushHour = () => {
    const h = new Date().getHours();
    return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
  };

  const processStoreProximity = (uLat, uLng, rawStores = restaurants) => {
    if (!uLat || !uLng || rawStores.length === 0) return;

    const uniqueRaw = deduplicateStores(rawStores);
    const distances = uniqueRaw.map(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) ? calculateHaversineKm(uLat,uLng,r.lat,r.lng) : null);
    const maxDist = Math.max(...distances.filter(Number.isFinite), 1);

    const updated = uniqueRaw.map((r, idx) => {
      const dist = distances[idx];
      const radius = Number(r.deliveryRadiusKm) > 0 ? Number(r.deliveryRadiusKm) : 15;
      const inRange = Number.isFinite(dist) ? dist <= radius : null;
      const fee = r.deliveryFee;
      // ETA is supplied by the restaurant; never infer a fake driving time.
      const isOpenNow = acceptsOnlineOrders(r); // missing state must not be shown as open
      const isNew = r.isNew || false;
      const recScore = recommendationScore({ distanceKm: dist, maxDistanceKm: maxDist, rating: r.rating, ratingCount: r.ratingCount, orderCount: (() => { try { return JSON.parse(localStorage.getItem('gastroflow_order_history') || '[]').filter(o => o.restaurantId === r.id).length; } catch { return 0; } })(), hasVerifiedPromotion: Boolean(r.promoVerified === true), isNew, isOpen: isOpenNow });

      // Fee breakdown for tooltip
      const h = new Date().getHours();
      const rushHour = (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
      const feeBreakdown = inRange ? {
        base: 80,
        distFee: Math.round(dist * 20),
        multiplier: rushHour ? 1.3 : 1.0,
        isRush: rushHour,
        total: fee
      } : null;

      return {
        ...r,
        distanceKm: Number.isFinite(dist) ? dist : null,
        isDeliverable: inRange,
        deliveryFee: fee,
        feeBreakdown: null,
        deliveryTime: r.deliveryTime,
        recommendationScore: recScore,
        isOpenNow
      };
    });

    setRestaurants(updated);

    const deliverableStores = updated.filter(s => s.isDeliverable);
    const knownStores = updated.filter(store => Number.isFinite(store.distanceKm));
    const closest = [...knownStores].sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
    setNearestStore(closest);
    const outsideAllKnownZones = knownStores.length > 0 && deliverableStores.length === 0;
    setIsOutOfCoverage(outsideAllKnownZones);
    // Non-blocking alert: never automatically open a full-screen modal on load.
    setShowOutOfCoverageModal(false);
    setDismissedCoverage(false);
  };

  const fetchRestaurants = async (overrideCoords = null) => {
    setLoading(true);
    setLoadError('');
    try {
      const coords = overrideCoords || userCoords;
      const q = coords && coords.lat && coords.lng ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      const data = await apiFetch(`/public/restaurants${q}`);
      const storeList = deduplicateStores(data || []).map(store => ({ ...store, isOpen: acceptsOnlineOrders(store), isOpenNow: acceptsOnlineOrders(store) }));
      setRestaurants(storeList);

      if (coords && coords.lat && coords.lng) {
        processStoreProximity(coords.lat, coords.lng, storeList);
      } else {
        const savedAddr = localStorage.getItem('gastroflow_delivery_address');
        let resolved = resolveCoordsForAddress(savedAddr);
        if (!resolved && savedAddr && savedAddr !== 'Detecting Location...') {
          try {
            const query = encodeURIComponent(savedAddr);
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=lk&limit=1`);
            if (res.ok) {
              const geoData = await res.json();
              if (geoData && geoData[0]) {
                resolved = { lat: parseFloat(geoData[0].lat), lng: parseFloat(geoData[0].lon) };
              }
            }
          } catch (_) {}
        }
        if (resolved) {
          setUserCoords(resolved);
          processStoreProximity(resolved.lat, resolved.lng, storeList);
        } else {
          setNearestStore(null);
          setIsOutOfCoverage(false);
        }
      }

    } catch (err) {
      console.error('Error fetching restaurants:', err);
      setLoadError('Unable to load restaurants. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  };

  const filtered = sortRestaurants(deduplicateStores(
    restaurants.filter(r => {
      const name = String(r.name || '').toLocaleLowerCase();
      const cuisine = String(r.cuisine || '').toLocaleLowerCase();
      const query = search.trim().toLocaleLowerCase();
      const matchesSearch = !query || name.includes(query) || cuisine.includes(query);
      const matchesCuisine = activeCuisine === 'all' || r.cuisineTag === activeCuisine;
      const matchesOpen = !openOnly || acceptsOnlineOrders(r);
      const matchesDelivery = !deliveryOnly || r.isDeliverable === true;
      return matchesSearch && matchesCuisine && matchesOpen && matchesDelivery;
    })
  ), sortBy);

  const emptyState = restaurantEmptyState({loading, failed:Boolean(loadError), total:restaurants.length, search, cuisine:activeCuisine, openOnly, deliveryOnly});
  const hasActiveFilters = Boolean(search.trim() || activeCuisine !== 'all' || openOnly || deliveryOnly);

  const openCount = restaurants.filter(acceptsOnlineOrders).length;
  const deliverableCount = restaurants.filter(r => acceptsOnlineOrders(r) && r.isDeliverable === true).length;
  const hasPreciseLocation = Boolean(userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lng));

  return (
    <div className="restaurants-view gastrofood-discovery" style={{ padding: '16px', maxWidth: 1120, margin: '0 auto', paddingBottom: 96, fontFamily: 'inherit' }}>
      
      {/* Top Location & Banner */}
      <div className="restaurants-location-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button type="button" className="restaurants-location-button stores-modern-location" onClick={() => setShowLocationModal(true)} aria-label="Select delivery location">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
            {t('deliveringTo') || 'Delivering to'}
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={17}/> {isDetectingGps ? (t('detectingGps') || 'Detecting GPS Location...') : deliveryLocation} <span style={{ fontSize: '0.8rem', color: 'var(--brand)' }}>▼</span>
          </div>
        </button>
        <div className="restaurants-context-label">Order from local restaurants</div>
      </div>

      {/* Location Picker Modal */}
      {showLocationModal && createPortal(
        <div className="customer-location-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="restaurants-location-dialog" role="dialog" aria-modal="true" aria-label="Select delivery location" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 24, maxWidth: 440, width: '100%', maxHeight:'calc(100dvh - 32px)', overflowY:'auto', color: 'var(--text-1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>📍 {t('selectDeliveryLocation') || 'Select Delivery Location'}</h3>
              <button type="button" aria-label="Close location picker" onClick={() => setShowLocationModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-1)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
            </div>

            {/* GPS Auto-detect button */}
            <button
              onClick={() => { detectRealGpsLocation(); setShowLocationModal(false); }}
              disabled={isDetectingGps}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                background: '#10b981',
                color: '#fff',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 16
              }}
            >
              <span>🎯 {isDetectingGps ? (t('locatingGps') || 'Locating via GPS...') : (t('useMyGps') || 'Use My Current Real GPS Location')}</span>
            </button>

            {/* Live Search & Autocomplete Form */}
            <form onSubmit={handleSaveCustomAddress} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, position: 'relative' }}>
              <label style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700 }}>🔍 Search Address or Landmark (Live Autocomplete):</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. 45 Main Street, Kandy or Galle Road"
                  value={customAddressInput}
                  onChange={e => setCustomAddressInput(e.target.value)}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-1)', fontSize: '0.88rem' }}
                />
                <button type="submit" style={{ padding: '10px 16px', borderRadius: 8, background: '#ff6b35', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                  {isSearchingAddress ? '...' : (t('save') || 'Save')}
                </button>
              </div>

              {/* Autocomplete Suggestions Dropdown */}
              {addressSearchResults.length > 0 && (
                <div style={{ background: '#1f2937', border: '1px solid #ff6b35', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 10 }}>
                  {addressSearchResults.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectAddressSuggestion(item)}
                      style={{ padding: '10px 12px', borderBottom: '1px solid #374151', cursor: 'pointer', fontSize: '0.82rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>📍</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.display_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </form>

            {/* Interactive Leaflet Pin Picker Map */}
            <InteractiveMapPicker userCoords={userCoords} onPinLocationChange={handlePinLocationChange} />

            <div style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10, marginTop: 14 }}>
              Or Select Quick City Pin:
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {[
                'Colombo 03, Western',
                'Kandy City, Central',
                'Galle Fort, Southern',
                'Dehiwala, Western',
                'Nugegoda, Western',
                'Negombo, Western',
                'Jaffna City, Northern',
                'Battaramulla, Western'
              ].map(loc => (
                <button
                  key={loc}
                  onClick={() => handleSelectPredefinedCity(loc)}
                  style={{
                    padding: '10px',
                    borderRadius: 8,
                    background: '#1f2937',
                    border: '1px solid #374151',
                    color: '#f8fafc',
                    fontSize: '0.82rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  📍 {loc}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Super Premium Out of Coverage Modal */}
      {showOutOfCoverageModal && nearestStore && createPortal(
        <div className="customer-location-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="customer-coverage-dialog" role="dialog" aria-modal="true" aria-label="Delivery area availability" style={{ background: 'linear-gradient(145deg, #1f2937 0%, #111827 100%)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 24, padding: 28, maxWidth: 460, width: '100%', color: '#f8fafc', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '2.2rem' }}>📍</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#f59e0b' }}>{t('storeNotAvailableArea') || 'Store Not Available in Area'}</h3>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600 }}>{nearestStore.distanceKm != null ? `Delivery beyond ${nearestStore.deliveryRadiusKm || 15} km zone` : 'Check your delivery address'}</span>
                </div>
              </div>
              <button type="button" aria-label="Close coverage notice" onClick={() => setShowOutOfCoverageModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 14, padding: 14, marginBottom: 20 }}>
              <p style={{ margin: 0, fontSize: '0.86rem', color: '#fef3c7', lineHeight: 1.5 }}>
                {Number.isFinite(Number(nearestStore.distanceKm)) && nearestStore.distanceKm !== null
                  ? <>Your selected location is <strong>{nearestStore.distanceKm} km</strong> from <strong>{nearestStore.name}</strong>. </>
                  : <>We could not verify the distance from your selected location to <strong>{nearestStore.name}</strong>. </>}
                {Number.isFinite(Number(nearestStore.deliveryRadiusKm)) && nearestStore.deliveryRadiusKm > 0
                  ? <>The delivery radius is <strong>{nearestStore.deliveryRadiusKm} km</strong>.</>
                  : <>Select a precise address pin to check delivery availability.</>}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => { setShowOutOfCoverageModal(false); onSelectRestaurant && onSelectRestaurant(nearestStore); }}
                style={{ width: '100%', padding: '14px', borderRadius: 14, background: 'var(--brand-gradient)', color: '#fff', border: 'none', fontWeight: 800, fontSize: '0.92rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 14px rgba(255,107,53,0.4)' }}
              >
                <span>{t('orderSelfPickup') || '🏬 Order for Self-Pickup / Takeaway Instead'}</span>
              </button>

              <button
                onClick={() => { setShowOutOfCoverageModal(false); setShowLocationModal(true); }}
                style={{ width: '100%', padding: '12px', borderRadius: 14, background: '#374151', color: '#f8fafc', border: '1px solid #4b5563', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <span>{t('selectDifferentCity') || '📍 Select Different City / Address Pin'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <section className="stores-modern-hero" aria-label="Browse restaurants">
        <div className="stores-hero-copy">
          <span className="stores-eyebrow"><Sparkles size={14}/> GASTROFLOW MARKETPLACE</span>
          <h1>Good food, made nearby.</h1>
          <p>Find something delicious from restaurants on GastroFlow. Explore menus, pickup options and delivery availability.</p>
          <div className="stores-hero-kpis" aria-label="Restaurant overview">
            <span><Store size={15}/> {restaurants.length} restaurants</span>
            <span><CheckCircle2 size={15}/> {openCount} accepting orders</span>
            {hasPreciseLocation && <span><Bike size={15}/> {deliverableCount} in delivery range</span>}
          </div>
        </div>
        <div className="stores-hero-visual" aria-hidden="true">
          <div className="stores-hero-food">🍛</div>
          <span className="stores-hero-pin"><MapPin size={20}/></span>
        </div>
      </section>

      {loadError && <div className="stores-error" role="alert"><AlertCircle size={18}/>{loadError}<button type="button" onClick={()=>fetchRestaurants()}><RefreshCw size={15}/> Retry</button></div>}

      {nearestStore && isOutOfCoverage && !dismissedCoverage && (
        <div className="stores-coverage-inline" role="status">
          <AlertCircle size={21}/>
          <div><strong>Delivery not available at this address</strong><span>Explore restaurants for pickup, or choose another delivery pin.</span></div>
          <button type="button" onClick={()=>{setShowLocationModal(true);setDismissedCoverage(true)}}>Change address</button>
          <button type="button" className="stores-dismiss" onClick={()=>setDismissedCoverage(true)} aria-label="Dismiss delivery notice">×</button>
        </div>
      )}

      <div className="stores-modern-search" role="search">
        <Search size={20}/>
        <input type="search" enterKeyHint="search" autoComplete="off" aria-label="Search restaurants or cuisines" placeholder="Search restaurants, pizza, burgers, rice…" value={search} onChange={e=>setSearch(e.target.value)}/>
        {search && <button type="button" aria-label="Clear search" onClick={()=>setSearch('')}>×</button>}
      </div>
      <div className="stores-quick-filters" aria-label="Availability filters">
        <button type="button" aria-pressed={openOnly} className={openOnly?'active':''} onClick={()=>setOpenOnly(v=>!v)}><CheckCircle2 size={17}/> Open now</button>
        <button type="button" aria-pressed={deliveryOnly} className={deliveryOnly?'active':''} disabled={!hasPreciseLocation} title={!hasPreciseLocation?'Select your location first':'Only stores that can deliver to your location'} onClick={()=>setDeliveryOnly(v=>!v)}><Bike size={17}/> Delivers here</button>
        <button type="button" onClick={()=>setShowLocationModal(true)}><MapPinned size={17}/> Change location</button>
        {hasActiveFilters && <button type="button" className="gastrofood-clear-filters" onClick={() => {setSearch('');setActiveCuisine('all');setOpenOnly(false);setDeliveryOnly(false);}} aria-label="Clear all restaurant filters">Clear all</button>}
      </div>

      {/* Discovery sorting — available restaurants always appear first. */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, scrollbarWidth: 'none' }}>
        {[
          { id: 'recommendation', label: 'Browse', desc: 'Available restaurants first' },
          { id: 'fastest', label: 'Prep estimate', desc: 'Restaurant-supplied' },
          { id: 'rating', label: 'Ratings', desc: 'Verified reviews only' },
          { id: 'distance', label: 'Nearest', desc: 'Proximity' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSortBy(tab.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              fontSize: '0.78rem',
              fontWeight: 800,
              border: sortBy === tab.id ? 'none' : '1px solid var(--border-color)',
              background: sortBy === tab.id ? '#176f4e' : 'var(--surface-1)',
              color: sortBy === tab.id ? '#fff' : 'var(--text-1)',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              boxShadow: sortBy === tab.id ? '0 4px 12px rgba(25,112,74,0.14)' : 'none'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Cuisine Tag Selector */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, marginBottom: 16, scrollbarWidth: 'none' }}>
        {CUISINE_CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveCuisine(c.id)}
            style={{
              padding: '8px 14px',
              borderRadius: 20,
              fontSize: '0.82rem',
              fontWeight: 700,
              border: activeCuisine === c.id ? 'none' : '1px solid var(--border-color)',
              background: activeCuisine === c.id ? 'var(--brand)' : 'var(--surface-1)',
              color: activeCuisine === c.id ? '#fff' : 'var(--text-1)',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>{c.icon}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Restaurants confirmed open and deliverable at the selected location. */}
      {sortBy === 'recommendation' && !loading && recommendedOpenStores(filtered, hasPreciseLocation).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Restaurants accepting orders near you</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 700 }}>Based on verified availability</span>
          </div>

          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
            {recommendedOpenStores(filtered, hasPreciseLocation).slice(0, 4).map(r => (
              <div
                key={`pick_${r.id}`}
                role="button"
                tabIndex={0}
                aria-label={`Browse featured restaurant ${r.name}`}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectRestaurant?.(r)}}}
                onClick={() => onSelectRestaurant && onSelectRestaurant(r)}
                style={{
                  minWidth: 220,
                  maxWidth: 220,
                  background: 'var(--surface-1)',
                  borderRadius: 16,
                  border: '1px solid var(--border-color)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div style={{ height: 100, background: r.bannerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '3rem' }}>{r.emoji || '🏬'}</span>
                  <span style={{ position: 'absolute', top: 8, left: 8, background: '#24664f', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 800 }}>
                    Open for orders
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  <h4 style={{ margin: '0 0 2px', fontSize: '0.92rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </h4>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {restaurantRatingText(r)}{r.deliveryTime ? ` · ⏱️ ${r.deliveryTime}` : ''}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
                    📍 {Number.isFinite(r.distanceKm) ? `${r.distanceKm} km away` : 'Distance not available'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Restaurants List Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-1)' }}>
          {sortBy === 'fastest' ? 'Restaurants by preparation estimate' :
           sortBy === 'rating' ? '⭐ Highest Rated Restaurants' :
           sortBy === 'distance' ? '📍 Closest Outlets' :
           `Explore Restaurants (${filtered.length})`}
        </h3>
        <span className="gastrofood-result-count" aria-live="polite">{loading ? 'Updating…' : `${filtered.length} results`}</span>
      </div>

      {/* Restaurants Grid / Cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div className="spinner" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading real nearby restaurants...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="gastrofood-discovery-empty" role="status">
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🏪</div>
          <h4>{emptyState.title}</h4>
          <p>{emptyState.description}</p>
          {hasActiveFilters && <button type="button" onClick={() => {setSearch('');setActiveCuisine('all');setOpenOnly(false);setDeliveryOnly(false);}}>Clear filters</button>}
          {!hasActiveFilters && <button type="button" onClick={()=>fetchRestaurants()}>Try again</button>}
        </div>
      ) : (
        <div className="restaurants-result-grid stores-modern-grid" style={{ display: 'grid', gap: 18 }} aria-live="polite">
          {filtered.map(r => (
            <div
              key={r.id}
              className={`gastrofood-restaurant-card ${acceptsOnlineOrders(r) ? 'is-open' : 'is-closed'}`}
              role="button"
              tabIndex={0}
              aria-label={`Browse menu at ${r.name}. ${acceptsOnlineOrders(r) ? 'Accepting orders' : 'Currently closed'}.`}
              onKeyDown={e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectRestaurant?.(r);} }}
              onClick={() => onSelectRestaurant && onSelectRestaurant(r)}
              style={{
                background: 'var(--surface-1)',
                borderRadius: 16,
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)',
                cursor: 'pointer',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
            >
              {/* Banner Cover Image / Banner */}
              <div style={{ height: 130, background: r.bannerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '4rem' }}>{r.emoji || '🏬'}</span>

                {/* Top-left: Promo or Personalization Badge */}
                {r.promoVerified === true && r.promoBadge ? (
                  <span style={{ position: 'absolute', top: 10, left: 10, background: '#10b981', color: '#fff', padding: '3px 9px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800 }}>
                    🏷️ {r.promoBadge}
                  </span>
                ) : r.isNew ? (
                  <span style={{ position: 'absolute', top: 10, left: 10, background: '#6366f1', color: '#fff', padding: '3px 9px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800 }}>
                    🆕 New
                  </span>
                ) : null}

                {/* Bottom-left: Distance + Zone Badge */}
                {Number.isFinite(r.distanceKm) && (
                  <span style={{
                    position: 'absolute', bottom: 10, left: 10,
                    background: r.isDeliverable ? 'rgba(16,185,129,0.92)' : 'rgba(239,68,68,0.92)',
                    color: '#fff', padding: '3px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800, backdropFilter: 'blur(4px)'
                  }}>
                    📍 {r.distanceKm} km · {r.isDeliverable ? 'In Range' : 'Out of Zone'}
                  </span>
                )}

                {/* Top-right: Open/Closed + Rush Hour */}
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ background: r.isOpenNow ? 'rgba(0,0,0,0.65)' : 'rgba(239,68,68,0.9)', color: '#fff', padding: '3px 9px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700, backdropFilter: 'blur(4px)' }}>
                    {acceptsOnlineOrders(r) ? 'Accepting orders' : 'Closed · Browse menu'}
                  </span>
                  {r.feeBreakdown?.isRush && (
                    <span style={{ background: 'rgba(245,158,11,0.9)', color: '#fff', padding: '2px 8px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 800 }}>
                      ⏰ Peak
                    </span>
                  )}
                </div>
              </div>

              {/* Card Details */}
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <h4 className="gastrofood-store-name">{r.name}</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f59e0b15', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 800 }}>
                    <Star size={13} aria-hidden="true"/> {restaurantRatingText(r)}
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {r.cuisine}{r.location ? ` · 📍 ${r.location}` : ''}
                </div>

                {/* AI Score Badge */}
                {acceptsOnlineOrders(r) && hasPreciseLocation && r.isDeliverable === true && r.recommendationScore > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ height: 4, borderRadius: 2, background: 'var(--border-color)', flex: 1, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(r.recommendationScore, 100)}%`, background: r.recommendationScore > 70 ? '#10b981' : r.recommendationScore > 40 ? '#f59e0b' : '#ef4444', borderRadius: 2, transition: 'width 0.5s ease' }} />
                      </div>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {r.recommendationScore > 70 ? '🎯 Great Match' : r.recommendationScore > 40 ? '👍 Good' : '🔍 Explore'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Delivery Stats Bar */}
                <div style={{ display: 'flex', gap: 10, fontSize: '0.76rem', color: 'var(--text-1)', fontWeight: 600, borderTop: '1px solid var(--border-color)', paddingTop: 10, flexWrap: 'wrap' }}>
                  <span>⏱️ {r.deliveryTime || 'Confirm at checkout'}</span>
                  <span title={r.feeBreakdown ? `Base: LKR ${r.feeBreakdown.base} + Distance: LKR ${r.feeBreakdown.distFee}${r.feeBreakdown.isRush ? ' × 1.3 (Peak)' : ''}` : ''}>
                    🚚 {restaurantDeliveryText(r, hasPreciseLocation)}
                  </span>
                  {r.minOrder != null && <span style={{ color: 'var(--text-muted)' }}>Min order: LKR {r.minOrder}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Interactive Leaflet Drag & Drop Map Pin Picker Component ──
function InteractiveMapPicker({ userCoords, onPinLocationChange }) {
  const mapContainerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const initialLat = userCoords?.lat || 6.9147;
    const initialLng = userCoords?.lng || 79.8517;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 14,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: 'custom-pin-emoji',
      html: `<div style="font-size: 2.2rem; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5)); transform: translate(-50%, -100%);">📍</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });

    const marker = L.marker([initialLat, initialLng], { draggable: true, icon: pinIcon }).addTo(map);

    const updatePin = (lat, lng) => {
      onPinLocationChange && onPinLocationChange(lat, lng);
    };

    marker.on('dragend', (e) => {
      const { lat, lng } = e.target.getLatLng();
      updatePin(lat, lng);
    });

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      marker.setLatLng([lat, lng]);
      updatePin(lat, lng);
    });

    setTimeout(() => map.invalidateSize(), 250);

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div style={{ marginTop: 10, marginBottom: 10 }}>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 700, marginBottom: 6 }}>
        🗺️ Drag Pin or Tap Map to Set Exact Entrance:
      </div>
      <div
        ref={mapContainerRef}
        style={{
          height: 180,
          width: '100%',
          borderRadius: 12,
          border: '1px solid #374151',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          position: 'relative',
          zIndex: 1
        }}
      />
    </div>
  );
}
