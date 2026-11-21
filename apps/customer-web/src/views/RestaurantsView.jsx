import React, { useState, useEffect, useRef } from 'react';
import './restaurants-mobile.css';
import {deliveryState, locationKey} from '../utils/restaurant-fulfilment.js';
import { createPortal } from 'react-dom';
import { MapPin, Search, SlidersHorizontal, ArrowUpRight, RefreshCw, Star, Clock3, Bike, CheckCircle2, AlertCircle, ShoppingBag } from 'lucide-react';
import L from 'leaflet';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';
import { calculateHaversineDistanceKm, resolveAddressToCoords, evaluateStoreProximity } from '../utils/geo.js';
import { acceptsOnlineOrders, recommendationScore, recommendedOpenStores } from '../utils/marketplace-availability.js';
import { restaurantRatingText, restaurantDeliveryText, restaurantEmptyState, sortRestaurants } from '../utils/discovery-display.js';
import {matchesRestaurantQuery} from '../utils/discovery-search.js';
import {acquireBestLocation,permissionAllowsAutomaticLocation} from '../utils/location-acquisition.js';
import {createAddressSearchGate} from '../utils/address-search-gate.js';
import {isCurrentLocationSelection} from '../utils/location-selection-guard.js';


const CUISINE_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🍽️' },
  { id: 'srilankan', label: 'Sri Lankan', icon: '🍛' },
  { id: 'burgers', label: 'Burgers', icon: '🍔' },
  { id: 'pizza', label: 'Pizza', icon: '🍕' },
  { id: 'asian', label: 'Asian', icon: '🍜' },
  { id: 'healthy', label: 'Healthy', icon: '🥗' },
  { id: 'desserts', label: 'Desserts', icon: '🍰' }
];

function RestaurantCover({restaurant}) {
  return <>
    <span aria-hidden="true" style={{fontSize:'3rem'}}>{restaurant.emoji || '🍽️'}</span>
    {restaurant.coverPhoto && <img key={restaurant.coverPhoto} src={restaurant.coverPhoto} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}
      onError={event => { event.currentTarget.hidden = true; }} />}
  </>;
}

export default function RestaurantsView({ onSelectRestaurant, toast = () => {} }) {
  const { t, dict } = useLang();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('all');

  const [deliveryLocation, setDeliveryLocation] = useState(
    localStorage.getItem('gastroflow_delivery_address') || 'Choose delivery location'
  );
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showMoreCities, setShowMoreCities] = useState(false);
  const [locationPickerMessage, setLocationPickerMessage] = useState('');
  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [customAddressInput, setCustomAddressInput] = useState('');

  const [userCoords, setUserCoords] = useState(null);
  const [nearestStore, setNearestStore] = useState(null);
  const [isOutOfCoverage, setIsOutOfCoverage] = useState(false);
  const [showOutOfCoverageModal, setShowOutOfCoverageModal] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [selectedMode, setSelectedMode] = useState(null);
  const [quotedLocation, setQuotedLocation] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dismissedCoverage, setDismissedCoverage] = useState(false);
  const [userAccuracy, setUserAccuracy] = useState(null);
  const locationRequestRef = useRef(0);
  const addressSearchGateRef = useRef(createAddressSearchGate());
  const restaurantsFetchRef = useRef(0);
  const hasLoadedRestaurantsRef = useRef(false);

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

  const detectRealGpsLocation = async ({silent=false}={}) => {
    const requestId=++locationRequestRef.current;
    setIsDetectingGps(true);
    try {
      const fix=await acquireBestLocation();
      if(requestId!==locationRequestRef.current)return;
      const {lat,lng,accuracy}=fix;
      // Keep the confirmed GPS pin even when the address provider is unavailable.
      setUserCoords({lat,lng});
      setUserAccuracy(accuracy);
      localStorage.setItem('gastroflow_user_coords',JSON.stringify({lat,lng,accuracy,source:'gps',recordedAt:Date.now()}));
      const fallback=`GPS pin (${lat.toFixed(5)}, ${lng.toFixed(5)}) · accuracy ~${accuracy}m`;
      setDeliveryLocation(fallback);
      localStorage.setItem('gastroflow_delivery_address',fallback);
      fetchRestaurants({lat,lng});
      try {
        // Reuse the server's geocoder instead of directly querying the public Nominatim API.
        const result=await apiFetch(`/public/reverse-geocode?lat=${lat}&lng=${lng}`);
        if(requestId!==locationRequestRef.current)return;
        if(typeof result?.label==='string'&&result.label.trim()){
          setDeliveryLocation(result.label.trim());
          localStorage.setItem('gastroflow_delivery_address',result.label.trim());
        }
      } catch {
        // A reverse-geocode outage cannot discard a valid device GPS location.
      }
      setShowLocationModal(false);
      setLocationPickerMessage('');
      if(!silent)toast(`Location found (accuracy approximately ${accuracy} metres). Check the map pin before ordering.`,'success');
    }catch(err){
      if(requestId===locationRequestRef.current && !silent) {
        setLocationPickerMessage(err.message||'Location unavailable. Search for an address or select a map pin.');
        toast(err.message||'Location unavailable. Choose a map pin.','warning');
      }
    }finally{
      if(requestId===locationRequestRef.current)setIsDetectingGps(false);
    }
  };

  const handleSelectPredefinedCity = (cityStr) => {
    addressSearchGateRef.current.invalidate();
    locationRequestRef.current++;
    setDeliveryLocation(cityStr);
    localStorage.setItem('gastroflow_delivery_address', cityStr);
    setShowLocationModal(false);

    const coords = CITY_COORDS[cityStr] || resolveCoordsForAddress(cityStr);
    if (coords) {
      setUserCoords(coords);
      localStorage.setItem('gastroflow_user_coords', JSON.stringify({...coords,source:'city-approximation'}));
      fetchRestaurants(coords);
    }
  };

  const [addressSearchResults, setAddressSearchResults] = useState([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const mapContainerRef = useRef(null);

  // Autocomplete is last-query-wins. Ignore older searches after a query
  // change, modal close, selection, or component unmount.
  useEffect(() => {
    addressSearchGateRef.current.invalidate();
    setAddressSearchResults([]);
    setIsSearchingAddress(false);
    if (!showLocationModal || customAddressInput.trim().length < 3) return;

    const timer = setTimeout(async () => {
      const request = addressSearchGateRef.current.start();
      setIsSearchingAddress(true);
      try {
        const query = encodeURIComponent(customAddressInput.trim());
        const data = await apiFetch(`/public/geocode?q=${query}`);
        if (addressSearchGateRef.current.isCurrent(request))
          setAddressSearchResults(Array.isArray(data) ? data : []);
      } catch {
        // A stale or failed autocomplete search must not change a saved pin.
      } finally {
        if (addressSearchGateRef.current.isCurrent(request)) setIsSearchingAddress(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      addressSearchGateRef.current.invalidate();
    };
  }, [customAddressInput, showLocationModal]);


  const handleSelectAddressSuggestion = (item) => {
    addressSearchGateRef.current.invalidate();
    locationRequestRef.current++;
    const lat = parseFloat(item.lat);
    const lng = Number(item.lng ?? item.lon);
    const displayParts = String(item.label || item.display_name || '').split(',');
    const shortAddr = displayParts.slice(0, 3).join(', ').trim() || 'Custom Pin';

    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    setUserCoords({ lat, lng });
    setDeliveryLocation(shortAddr);
    localStorage.setItem('gastroflow_delivery_address', shortAddr);
    localStorage.setItem('gastroflow_user_coords', JSON.stringify({ lat, lng,source:'geocoded-address' }));

    fetchRestaurants({lat,lng});
    setShowLocationModal(false);
    setCustomAddressInput('');
    setAddressSearchResults([]);
    toast(`📍 Delivery location set: ${shortAddr}`, 'success');
  };

  const handleSaveCustomAddress = async (e) => {
    e.preventDefault();
    const manualAddr = customAddressInput.trim();
    if (!manualAddr) return;
    const requestId = ++locationRequestRef.current;
    // A manual save supersedes pending autocomplete. Never commit an old
    // geocoder result after a new query, GPS/pin selection, or dialog close.
    addressSearchGateRef.current.invalidate();
    setIsSearchingAddress(true);
    try {
      const query = encodeURIComponent(manualAddr);
      const data = await apiFetch(`/public/geocode?q=${query}`);
      if (!isCurrentLocationSelection(requestId,locationRequestRef.current)) return;
      if (Array.isArray(data) && data.length > 0) {
        handleSelectAddressSuggestion(data[0]);
        return;
      }
    } catch {
      // Manual fallback may proceed only if this is still the latest selection.
    } finally {
      if (isCurrentLocationSelection(requestId,locationRequestRef.current)) setIsSearchingAddress(false);
    }
    if (!isCurrentLocationSelection(requestId,locationRequestRef.current)) return;

    // Fuzzy match against Sri Lanka city dictionary
    const matchedCoords = resolveCoordsForAddress(manualAddr);
    if (matchedCoords) {
      setUserCoords(matchedCoords);
      localStorage.setItem('gastroflow_user_coords', JSON.stringify({...matchedCoords,source:'city-approximation'}));
      fetchRestaurants(matchedCoords);
    } else {
      // A textual address cannot inherit GPS coordinates from an earlier address.
      setUserCoords(null);
      setNearestStore(null);
      setIsOutOfCoverage(false);
      localStorage.removeItem('gastroflow_user_coords');
      fetchRestaurants(null);
    }

    setDeliveryLocation(manualAddr);
    localStorage.setItem('gastroflow_delivery_address', manualAddr);
    setShowLocationModal(false);
    setCustomAddressInput('');
    toast(`Delivery address saved: ${manualAddr}`, 'success');
  };

  const handlePinLocationChange = async (lat, lng) => {
    const requestId=++locationRequestRef.current;
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    setUserCoords({ lat, lng });
    localStorage.setItem('gastroflow_user_coords', JSON.stringify({ lat, lng,source:'manual-pin' }));
    fetchRestaurants({lat,lng});
    const fallback=`Selected pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    setDeliveryLocation(fallback);
    localStorage.setItem('gastroflow_delivery_address',fallback);
    try {
      const data=await apiFetch(`/public/reverse-geocode?lat=${lat}&lng=${lng}`);
      if(requestId!==locationRequestRef.current)return;
      if(typeof data?.label==='string'&&data.label.trim()){
        setDeliveryLocation(data.label.trim());
        localStorage.setItem('gastroflow_delivery_address',data.label.trim());
      }
    } catch (_) { /* Keep the selected pin without an address label. */ }
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
    // Reacquire only when the customer previously granted location permission.
    // Never trigger a surprise browser location prompt merely by browsing.
    let cancelled=false;
    permissionAllowsAutomaticLocation().then(granted=>{
      if(cancelled||!granted)return;
      let saved=null;
      try{saved=JSON.parse(localStorage.getItem('gastroflow_user_coords')||'null')}catch{}
      // Refresh old GPS fixes automatically when permission has already been granted.
      // Never silently replace a customer-selected city, search result or manual pin.
      const expiredGps=saved?.source==='gps' && Date.now()-Number(saved.recordedAt||0)>10*60*1000;
      if(!saved || saved.source===undefined || expiredGps)detectRealGpsLocation({silent:true});
    });
    return ()=>{cancelled=true;locationRequestRef.current++;};
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
      const address = localStorage.getItem('gastroflow_delivery_address');
      const coords = lastCoords || resolveCoordsForAddress(address);
      setDeliveryLocation(address || 'Choose delivery location');
      setUserCoords(coords);
      fetchRestaurants(coords);
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

  const processStoreProximity = (uLat, uLng, rawStores = restaurants) => {
    if (!Number.isFinite(uLat) || !Number.isFinite(uLng) || rawStores.length === 0) return;

    const uniqueRaw = deduplicateStores(rawStores);
    const distances = uniqueRaw.map(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) ? calculateHaversineKm(uLat,uLng,r.lat,r.lng) : null);
    const maxDist = Math.max(...distances.filter(Number.isFinite), 1);

    const updated = uniqueRaw.map((r, idx) => {
      const dist = distances[idx];
      const fee = r.deliveryFee;
      // ETA is supplied by the restaurant; never infer a fake driving time.
      const isOpenNow = acceptsOnlineOrders(r); // missing state must not be shown as open
      const isNew = r.isNew || false;
      const recScore = recommendationScore({ distanceKm: dist, maxDistanceKm: maxDist, rating: r.rating, ratingCount: r.ratingCount, orderCount: (() => { try { return JSON.parse(localStorage.getItem('gastroflow_order_history') || '[]').filter(o => o.restaurantId === r.id).length; } catch { return 0; } })(), hasVerifiedPromotion: Boolean(r.promoVerified === true), isNew, isOpen: isOpenNow });

      return {
        ...r,
        distanceKm: Number.isFinite(dist) ? dist : null,
        isDeliverable: r.isDeliverable,
        deliveryFee: fee,
        feeBreakdown: null,
        deliveryTime: r.deliveryTime,
        recommendationScore: recScore,
        isOpenNow
      };
    });

    setRestaurants(updated);

    const knownStores = updated.filter(store => Number.isFinite(store.distanceKm));
    const closest = [...knownStores].sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
    setNearestStore(closest);
    const outsideAllKnownZones = updated.length > 0 && updated.every(store => store.isDeliverable === false);
    setIsOutOfCoverage(outsideAllKnownZones);
    // Non-blocking alert: never automatically open a full-screen modal on load.
    setShowOutOfCoverageModal(false);
    setDismissedCoverage(false);
  };

  const fetchRestaurants = async (overrideCoords = userCoords) => {
    const requestId=++restaurantsFetchRef.current;
    // Background polling/focus/GPS updates must not replace populated cards with a spinner.
    if (!hasLoadedRestaurantsRef.current) setLoading(true);
    try {
      const coords = overrideCoords;
      const q = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      const data = await apiFetch(`/public/restaurants${q}`);
      if(requestId!==restaurantsFetchRef.current)return;
      const storeList = deduplicateStores(data || []).map(store => ({ ...store, isOpen: acceptsOnlineOrders(store), isOpenNow: acceptsOnlineOrders(store) }));
      setLoadError('');
      setQuotedLocation(locationKey(coords));
      setRestaurants(storeList);
      hasLoadedRestaurantsRef.current = true;

      if (locationKey(coords) && storeList.length) {
        processStoreProximity(coords.lat, coords.lng, storeList);
      } else {
        setNearestStore(null);
        setIsOutOfCoverage(false);
      }

    } catch (err) {
      console.error('Error fetching restaurants:', err);
      if(requestId===restaurantsFetchRef.current)setLoadError('Unable to load restaurants. Check your connection and retry.');
    } finally {
      if(requestId===restaurantsFetchRef.current)setLoading(false);
    }
  };

  const savedLocationSource = (() => { try { return JSON.parse(localStorage.getItem('gastroflow_user_coords'))?.source; } catch { return null; } })();
  const key = locationKey(userCoords);
  const hasPreciseLocation = Boolean(key && ['gps','geocoded-address','manual-pin'].includes(savedLocationSource));
  const current = !loadError && quotedLocation === key;
  const mode = selectedMode || (hasPreciseLocation ? 'delivery' : 'pickup');
  const deliveryOnly = mode === 'delivery';
  function openStore(restaurant, selected = mode) {
    const orderType = selected === 'delivery' ? 'delivery' : selected === 'pickup' ? 'takeaway' : null;
    onSelectRestaurant?.(restaurant, null, orderType);
  }
  const serviceLabels = restaurant => {
    const state = deliveryState(restaurant, hasPreciseLocation, current);
    return <div className="store-services">
      <span data-available={state === 'available'}>{t({available:'deliveryAvailableHere',outside:'deliveryOutside',address:'deliveryNeedsPin',unknown:'deliveryUnconfirmed',closed:'deliveryPaused'}[state])}</span>
      <span data-available={restaurant.isOpen && restaurant.pickupEnabled !== false && !loadError}>{t(loadError ? 'pickupUnconfirmed' : restaurant.isOpen && restaurant.pickupEnabled !== false ? 'pickupAvailableHere' : 'pickupPaused')}</span>
    </div>;
  };
  const filtered = sortRestaurants(deduplicateStores(
    restaurants.filter(r => {
      const matchesSearch = matchesRestaurantQuery(r, search);
      const matchesCuisine = activeCuisine === 'all' || r.cuisineTag === activeCuisine;
      const matchesOpen = !openOnly || acceptsOnlineOrders(r);
      const matchesDelivery = mode === 'all' || (!loadError && (deliveryOnly
        ? deliveryState(r, hasPreciseLocation, current) === 'available' : acceptsOnlineOrders(r) && r.pickupEnabled !== false));
      return matchesSearch && matchesCuisine && matchesOpen && matchesDelivery;
    })
  ), sortBy === 'recommendation' && mode === 'pickup' && key ? 'distance' : sortBy);

  const emptyState = restaurantEmptyState({loading, failed:Boolean(loadError), total:restaurants.length, search, cuisine:activeCuisine, openOnly, deliveryOnly});
  const hasActiveFilters = Boolean(search.trim() || activeCuisine !== 'all' || openOnly);

  const openCount = restaurants.filter(acceptsOnlineOrders).length;
  const deliverableCount = restaurants.filter(r => acceptsOnlineOrders(r) && r.isDeliverable === true).length;


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

      </div>

      {/* Location Picker Modal */}
      {showLocationModal && createPortal(
        <div className="customer-location-backdrop gf-location-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="restaurants-location-dialog gf-location-sheet" role="dialog" aria-modal="true" aria-label="Select delivery location" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 24, maxWidth: 440, width: '100%', maxHeight:'calc(100dvh - 32px)', overflowY:'auto', color: 'var(--text-1)' }}>
            <div className="gf-location-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div><span className="gf-location-eyebrow">DELIVERY ADDRESS</span><h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>📍 {t('selectDeliveryLocation') || 'Select Delivery Location'}</h3><p>Search, use GPS, or tap the map for your exact entrance.</p></div>
              <button type="button" aria-label="Close location picker" onClick={() => {
                  locationRequestRef.current++;
                  addressSearchGateRef.current.invalidate();
                  setShowLocationModal(false);
                }} style={{ background: 'none', border: 'none', color: 'var(--text-1)', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
            </div>

            {/* GPS Auto-detect button */}
            <button
              onClick={() => { setLocationPickerMessage(''); void detectRealGpsLocation(); }}
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

            {locationPickerMessage && <p role="alert" className="gf-location-error">{locationPickerMessage}</p>}
            <div className="gf-location-current" role="status"><span>Selected location</span><strong>{deliveryLocation}</strong>{userAccuracy != null && <small>Last GPS accuracy: approximately {Math.round(userAccuracy)} m</small>}</div>

            {/* Live Search & Autocomplete Form */}
            <form className="gf-location-search" onSubmit={handleSaveCustomAddress} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, position: 'relative' }}>
              <label style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700 }}>🔍 Search Address or Landmark (Live Autocomplete):</label>
              <div className="gf-location-search-row" style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. 45 Main Street, Kandy or Galle Road"
                  value={customAddressInput}
                  onChange={e => {
                    locationRequestRef.current++;
                    setCustomAddressInput(e.target.value);
                  }}
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
                    <button type="button"
                      key={idx}
                      onClick={() => handleSelectAddressSuggestion(item)}
                      style={{ width:'100%',background:'transparent',textAlign:'left', padding: '10px 12px', border:'none', borderBottom: '1px solid #374151', cursor: 'pointer', fontSize: '0.82rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>📍</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label || item.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* Map pin is a genuine coordinate choice, not a city approximation. */}
            <div className="gf-location-map-heading"><strong>Pinpoint your entrance</strong><span>Tap the map or drag its marker</span></div>
            <div className="gf-location-map-frame"><InteractiveMapPicker userCoords={userCoords} onPinLocationChange={handlePinLocationChange} /></div>
            <button type="button" className="gf-location-confirm" disabled={!userCoords || !Number.isFinite(userCoords.lat) || !Number.isFinite(userCoords.lng)} onClick={() => setShowLocationModal(false)}>Confirm selected location</button>

            <button type="button" className="gf-location-cities-toggle" aria-expanded={showMoreCities} onClick={() => setShowMoreCities(value => !value)}>{showMoreCities ? 'Hide city shortcuts −' : 'Browse city shortcuts +'}</button>

            {showMoreCities && <div className="gf-location-city-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
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
            </div>}
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
                disabled={!nearestStore.isOpen || nearestStore.pickupEnabled === false}
                onClick={() => { setShowOutOfCoverageModal(false); openStore(nearestStore, 'pickup'); }}
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

      <header className="discovery-heading">
        <h1>Nearby restaurants</h1>
        {!loading && !loadError && <p>{openCount} accepting orders{hasPreciseLocation && current && ` · ${deliverableCount} in delivery range`}</p>}
      </header>

      {loadError && <div className="stores-error" role="alert"><AlertCircle size={18}/>{loadError}<button type="button" onClick={()=>fetchRestaurants()}><RefreshCw size={15}/> Retry</button></div>}

      {deliveryOnly && current && hasPreciseLocation && nearestStore && isOutOfCoverage && !dismissedCoverage && (
        <div className="stores-coverage-inline" role="status">
          <AlertCircle size={21}/>
          <div><strong>Delivery not available at this address</strong><span>Explore restaurants for pickup, or choose another delivery pin.</span></div>
          <button type="button" onClick={()=>{setShowLocationModal(true);setDismissedCoverage(true)}}>Change address</button>
          <button type="button" className="stores-dismiss" onClick={()=>setDismissedCoverage(true)} aria-label="Dismiss delivery notice">×</button>
        </div>
      )}

      <div className="stores-modern-search" role="search">
        <Search size={20}/>
        <input type="search" enterKeyHint="search" autoComplete="off" aria-label="Search restaurants, cuisines or areas" placeholder="Search restaurants, cuisines or areas…" value={search} onChange={e=>setSearch(e.target.value)}/>
        {search && <button type="button" aria-label="Clear search" onClick={()=>setSearch('')}>×</button>}
      </div>
      <div className="store-mode-switch" role="group" aria-label="Restaurant order mode">
        {['delivery','pickup','all'].map(value => <button key={value} type="button" aria-pressed={mode === value}
          onClick={() => {setSelectedMode(value); if (value === 'delivery' && !hasPreciseLocation) setShowLocationModal(true);}}>
          {t({delivery:'modeDelivery',pickup:'modePickup',all:'modeAllStores'}[value])}
        </button>)}
      </div>
      <details className="discovery-filters">
        <summary><SlidersHorizontal size={17}/> Filters and sort
          {(openOnly || activeCuisine !== 'all' || sortBy !== 'recommendation') && <small>Applied</small>}
        </summary>
      <div className="stores-quick-filters" role="group" aria-label="Availability filters">
        <button type="button" aria-pressed={openOnly} className={openOnly?'active':''} onClick={()=>setOpenOnly(v=>!v)}><CheckCircle2 size={17}/> Open now</button>

        {(hasActiveFilters || sortBy !== 'recommendation') && <button type="button" className="gastrofood-clear-filters" onClick={() => {setSearch('');setActiveCuisine('all');setOpenOnly(false);setSortBy('recommendation');}} aria-label="Clear all restaurant filters">Clear all</button>}
      </div>

      {/* Discovery sorting — available restaurants always appear first. */}
      <div className="gf-mobile-sort-tabs" role="group" aria-label="Sort restaurants" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, scrollbarWidth: 'none' }}>
        {[
          { id: 'recommendation', label: 'Browse', desc: 'Available restaurants first' },
          { id: 'fastest', label: 'Prep estimate', desc: 'Restaurant-supplied' },
          { id: 'rating', label: 'Ratings', desc: 'Verified reviews only' },
          { id: 'distance', label: 'Nearest', desc: 'Proximity' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={sortBy === tab.id}
            title={tab.desc}
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
      <div className="gf-mobile-cuisine-tabs" role="group" aria-label="Cuisine filters" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, marginBottom: 16, scrollbarWidth: 'none' }}>
        {CUISINE_CATEGORIES.map(c => (
          <button
            key={c.id}
            type="button"
            aria-pressed={activeCuisine === c.id}
            className="gf-mobile-cuisine-tab"
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
            <span className="gf-mobile-cuisine-icon" aria-hidden="true">{c.icon}</span>
            <span className="gf-mobile-cuisine-label">{c.label}</span>
          </button>
        ))}
      </div>

      </details>

      {/* Restaurants confirmed open and deliverable at the selected location. */}
      {deliveryOnly && current && sortBy === 'recommendation' && !loading && recommendedOpenStores(filtered, hasPreciseLocation).length > 0 && (
        <div className="discovery-featured" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Open restaurants near your location</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 700 }}>Open status from restaurant · proximity estimated</span>
          </div>

          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
            {recommendedOpenStores(filtered, hasPreciseLocation).slice(0, 4).map(r => (
              <div
                key={`pick_${r.id}`}
                role="button"
                tabIndex={0}
                aria-label={`Browse featured restaurant ${r.name}`}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openStore(r)}}}
                onClick={() => openStore(r)}
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
                  <RestaurantCover restaurant={r} />
                  <span style={{ position: 'absolute', top: 8, left: 8, background: '#24664f', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 800 }}>
                    Open for orders
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  {serviceLabels(r)}
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
      <div className="discovery-list-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
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
          <h4>{!loadError && deliveryOnly && !hasActiveFilters ? t(!hasPreciseLocation ? 'deliveryNeedsPin' : !current ? 'checkingDelivery' : 'noDeliveryHere') : emptyState.title}</h4>
          {deliveryOnly && !loadError && !hasActiveFilters ? <button type="button" onClick={() => setSelectedMode('pickup')}>{t('showPickup')}</button> : <p>{emptyState.description}</p>}
          {(hasActiveFilters || sortBy !== 'recommendation') && <button type="button" onClick={() => {setSearch('');setActiveCuisine('all');setOpenOnly(false);}}>Clear filters</button>}
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
              onKeyDown={e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();openStore(r);} }}
              onClick={() => openStore(r)}
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
              <div className="gf-mobile-restaurant-banner" style={{ height: 130, background: r.bannerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RestaurantCover restaurant={r} />

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
                    background: 'rgba(15,23,42,0.88)',
                    color: '#fff', padding: '3px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 800, backdropFilter: 'blur(4px)'
                  }}>
                    📍 {r.distanceKm.toFixed(1)} km straight-line
                  </span>
                )}

                {/* Top-right: Open/Closed + Rush Hour */}
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ background: r.isOpenNow ? 'rgba(0,0,0,0.65)' : 'rgba(239,68,68,0.9)', color: '#fff', padding: '3px 9px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700, backdropFilter: 'blur(4px)' }}>
                    {acceptsOnlineOrders(r) ? 'Accepting orders' : r.opensAt ? 'Opens at ' + r.opensAt + ' · ' + r.timeZone : 'Closed · Browse menu'}
                  </span>
                  {r.feeBreakdown?.isRush && (
                    <span style={{ background: 'rgba(245,158,11,0.9)', color: '#fff', padding: '2px 8px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 800 }}>
                      ⏰ Peak
                    </span>
                  )}
                </div>
              </div>

              {/* Card Details */}
              <div className="gf-mobile-restaurant-details" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <h4 className="gastrofood-store-name">{r.name}</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f59e0b15', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 800 }}>
                    <Star size={13} aria-hidden="true"/> {restaurantRatingText(r)}
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {r.cuisine}{r.location ? ` · 📍 ${r.location}` : ''}
                </div>

                {serviceLabels(r)}
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
                  {deliveryState(r,hasPreciseLocation,current)==='available' && <span title={r.feeBreakdown ? `Base: LKR ${r.feeBreakdown.base} + Distance: LKR ${r.feeBreakdown.distFee}${r.feeBreakdown.isRush ? ' × 1.3 (Peak)' : ''}` : ''}>
                    🚚 {restaurantDeliveryText(r, hasPreciseLocation)}
                  </span>}
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
