import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';
import { useLang } from '../context/LanguageContext.jsx';

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
  const { dict: t } = useLang();
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
  const [userAccuracy, setUserAccuracy] = useState(null);

  const CITY_COORDS = {
    'Colombo 03, Western': { lat: 6.9147, lng: 79.8517 },
    'Kandy City, Central': { lat: 7.2906, lng: 80.6337 },
    'Galle Fort, Southern': { lat: 6.0535, lng: 80.2210 },
    'Dehiwala, Western': { lat: 6.8511, lng: 79.8650 },
    'Nugegoda, Western': { lat: 6.8724, lng: 79.8872 },
    'Negombo, Western': { lat: 7.2083, lng: 79.8358 },
    'Jaffna City, Northern': { lat: 9.6615, lng: 80.0255 },
    'Battaramulla, Western': { lat: 6.8973, lng: 79.9220 }
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

  // Auto detect location on load if default
  useEffect(() => {
    const saved = localStorage.getItem('gastroflow_delivery_address');
    if (!saved || saved === 'Detecting Location...') {
      detectRealGpsLocation();
    }
  }, []);

  const detectRealGpsLocation = () => {
    if (!('geolocation' in navigator)) {
      setDeliveryLocation('Colombo 03, Western');
      toast('Geolocation not supported by browser', 'warning');
      return;
    }
    setIsDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy || 0);

          setUserCoords({ lat, lng });
          setUserAccuracy(accuracy);

          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const city = addr.suburb || addr.city || addr.town || addr.village || addr.county || 'Detected Pin';
            const country = addr.country || '';
            const state = addr.state || country || 'GPS Location';
            const resolvedStr = country ? `${city}, ${country}` : `${city}, ${state}`;
            setDeliveryLocation(resolvedStr);
            localStorage.setItem('gastroflow_delivery_address', resolvedStr);
          } else {
            const coordsStr = `GPS Pin (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
            setDeliveryLocation(coordsStr);
            localStorage.setItem('gastroflow_delivery_address', coordsStr);
          }

          processStoreProximity(lat, lng);
        } catch (e) {
          setDeliveryLocation('Colombo 03, Western');
        } finally {
          setIsDetectingGps(false);
        }
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setDeliveryLocation('Colombo 03, Western');
        setIsDetectingGps(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSelectPredefinedCity = (cityStr) => {
    setDeliveryLocation(cityStr);
    localStorage.setItem('gastroflow_delivery_address', cityStr);
    setShowLocationModal(false);

    const coords = CITY_COORDS[cityStr];
    if (coords) {
      setUserCoords(coords);
      processStoreProximity(coords.lat, coords.lng);
    }
  };

  const handleSaveCustomAddress = (e) => {
    e.preventDefault();
    if (!customAddressInput.trim()) return;
    setDeliveryLocation(customAddressInput);
    localStorage.setItem('gastroflow_delivery_address', customAddressInput);
    setShowLocationModal(false);
    setCustomAddressInput('');
    toast(`Delivery address saved: ${customAddressInput}`, 'success');
  };

  useEffect(() => {
    fetchRestaurants();
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
    if (!uLat || !uLng || rawStores.length === 0) return;

    const uniqueRaw = deduplicateStores(rawStores);
    const updated = uniqueRaw.map(r => {
      const storeLat = r.lat || 6.9147;
      const storeLng = r.lng || 79.8517;
      const dist = calculateHaversineKm(uLat, uLng, storeLat, storeLng);
      const radius = r.deliveryRadiusKm || 15;
      const inRange = dist <= radius;
      const fee = inRange ? Math.max(80, Math.round(100 + dist * 25)) : 250;
      const minEta = Math.round(15 + dist * 3);
      const maxEta = Math.round(25 + dist * 4);
      const recScore = Number(((100 - dist * 2) + (r.rating * 10) + (r.promoBadge ? 15 : 0)).toFixed(1));

      return {
        ...r,
        distanceKm: dist,
        isDeliverable: inRange,
        deliveryFee: fee,
        deliveryTime: `${minEta}-${maxEta} min`,
        recommendationScore: recScore
      };
    });

    setRestaurants(updated);

    const deliverableStores = updated.filter(s => s.isDeliverable);
    const sortedByDistance = [...updated].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    const closest = sortedByDistance[0];

    if (closest) {
      setNearestStore(closest);
      if (deliverableStores.length === 0) {
        setIsOutOfCoverage(true);
        setShowOutOfCoverageModal(true);
        toast(`⚠️ Nearest store ${closest.name} is ${closest.distanceKm} km away (outside 15 km delivery zone)`, 'warning', 8000);
      } else {
        setIsOutOfCoverage(false);
        toast(`📍 Nearest Store: ${closest.name} (${closest.distanceKm} km away)`, 'success');
      }
    }
  };

  const fetchRestaurants = async () => {
    try {
      const q = userCoords ? `?lat=${userCoords.lat}&lng=${userCoords.lng}` : '';
      const data = await apiFetch(`/public/restaurants${q}`);
      const storeList = deduplicateStores(data || []);
      setRestaurants(storeList);

      if (userCoords && userCoords.lat && userCoords.lng) {
        processStoreProximity(userCoords.lat, userCoords.lng, storeList);
      } else {
        const defaultCoords = CITY_COORDS['Colombo 03, Western'];
        processStoreProximity(defaultCoords.lat, defaultCoords.lng, storeList);
      }
    } catch (err) {
      console.error('Error fetching restaurants:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = deduplicateStores(
    restaurants.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) ||
                            r.cuisine.toLowerCase().includes(search.toLowerCase());
      const matchesCuisine = activeCuisine === 'all' || r.cuisineTag === activeCuisine;
      return matchesSearch && matchesCuisine;
    })
  ).sort((a, b) => {
    if (sortBy === 'fastest') {
      const getMinTime = s => parseInt(s.deliveryTime || '30', 10);
      return getMinTime(a) - getMinTime(b);
    }
    if (sortBy === 'rating') {
      return (b.rating || 0) - (a.rating || 0);
    }
    if (sortBy === 'distance') {
      return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
    }
    // Default AI Recommendation Score
    return (b.recommendationScore || 0) - (a.recommendationScore || 0);
  });

  return (
    <div style={{ padding: '16px', maxWidth: 600, margin: '0 auto', paddingBottom: 90, fontFamily: 'system-ui, sans-serif' }}>
      
      {/* Top Location & Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ cursor: 'pointer' }} onClick={() => setShowLocationModal(true)}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
            {t('deliveringTo') || 'Delivering to'}
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 4 }}>
            📍 {isDetectingGps ? (t('detectingGps') || 'Detecting GPS Location...') : deliveryLocation} <span style={{ fontSize: '0.8rem', color: 'var(--brand)' }}>▼</span>
          </div>
        </div>
        <div style={{ background: '#ff6b3515', color: '#ff6b35', padding: '6px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700 }}>
          🛵 15-35 Mins
        </div>
      </div>

      {/* Location Picker Modal */}
      {showLocationModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 16, padding: 24, maxWidth: 440, width: '100%', color: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>📍 {t('selectDeliveryLocation') || 'Select Delivery Location'}</h3>
              <button onClick={() => setShowLocationModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
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

            <div style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
              Select City Pin:
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
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

            {/* Manual Custom Address Form */}
            <form onSubmit={handleSaveCustomAddress} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 700 }}>Or Enter Custom Address / Landmark:</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. 45 Main Street, Kandy"
                  value={customAddressInput}
                  onChange={e => setCustomAddressInput(e.target.value)}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '0.88rem' }}
                />
                <button type="submit" style={{ padding: '10px 16px', borderRadius: 8, background: '#ff6b35', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                  {t('save') || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Super Premium Out of Coverage Modal */}
      {showOutOfCoverageModal && nearestStore && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'linear-gradient(145deg, #1f2937 0%, #111827 100%)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 24, padding: 28, maxWidth: 460, width: '100%', color: '#f8fafc', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '2.2rem' }}>📍</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#f59e0b' }}>{t('storeNotAvailableArea') || 'Store Not Available in Area'}</h3>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600 }}>{t('outsideDeliveryZone') || 'Outside 15 km Delivery Zone'}</span>
                </div>
              </div>
              <button onClick={() => setShowOutOfCoverageModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 14, padding: 14, marginBottom: 20 }}>
              <p style={{ margin: 0, fontSize: '0.86rem', color: '#fef3c7', lineHeight: 1.5 }}>
                Your current location is <strong>{nearestStore.distanceKm} km</strong> away from our nearest branch (<strong>{nearestStore.name}</strong>).
                Our maximum delivery radius is <strong>15 km</strong>.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => { setShowOutOfCoverageModal(false); onSelectRestaurant && onSelectRestaurant(nearestStore); }}
                style={{ width: '100%', padding: '14px', borderRadius: 14, background: 'linear-gradient(135deg, #ff6b35 0%, #f97316 100%)', color: '#fff', border: 'none', fontWeight: 800, fontSize: '0.92rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 14px rgba(255,107,53,0.4)' }}
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
        </div>
      )}

      {/* Hero Marketplace Banner Carousel */}
      <div style={{ background: 'linear-gradient(135deg, #ff6b35 0%, #f97316 50%, #e11d48 100%)', borderRadius: 16, padding: 18, color: '#fff', marginBottom: 20, boxShadow: '0 8px 24px rgba(255,107,53,0.3)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <span style={{ background: 'rgba(255,255,255,0.25)', padding: '3px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🎉 UberEats-Style Multi-Store Marketplace
          </span>
          <h2 style={{ margin: '8px 0 4px', fontSize: '1.4rem', fontWeight: 900, lineHeight: 1.2 }}>
            Craving something delicious?
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.9 }}>
            Order from top local Sri Lankan & International restaurants near you!
          </p>
        </div>
        <div style={{ position: 'absolute', right: -10, bottom: -10, fontSize: '5rem', opacity: 0.25, pointerEvents: 'none' }}>
          🍔
        </div>
      </div>

      {/* Nearest Store Proximity Live Badge */}
      {nearestStore && (
        <div
          onClick={() => isOutOfCoverage && setShowOutOfCoverageModal(true)}
          style={{
            background: isOutOfCoverage
              ? 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(245,158,11,0.12) 100%)'
              : 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(5,150,105,0.12) 100%)',
            border: `1px solid ${isOutOfCoverage ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
            padding: '12px 16px',
            borderRadius: 14,
            marginBottom: 16,
            cursor: isOutOfCoverage ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 800, color: isOutOfCoverage ? '#ef4444' : '#10b981' }}>
              {isOutOfCoverage ? '⚠️ Delivery Coverage Alert' : '🟢 Nearest Branch Found'}
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-1)', marginTop: 2 }}>
              {isOutOfCoverage
                ? `Nearest store (${nearestStore.name}) is ${nearestStore.distanceKm} km away`
                : `${nearestStore.name} is ${nearestStore.distanceKm} km away`
              }
            </div>
          </div>
          {isOutOfCoverage ? (
            <span style={{ background: '#ef4444', color: '#fff', padding: '6px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 800 }}>
              Options ➔
            </span>
          ) : (
            <span style={{ background: '#10b98120', color: '#10b981', padding: '4px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 800 }}>
              ⚡ In Range
            </span>
          )}
        </div>
      )}

      {/* Search Input */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '1.1rem', color: 'var(--text-muted)' }}>🔍</span>
          <input
            className="form-control"
            placeholder="Search restaurants or cuisines (Burgers, Pizza, Rice)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 42, height: 48, borderRadius: 24, fontSize: '16px' }}
          />
        </div>
      </div>

      {/* UberEats Smart Sort Filter Bar */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, scrollbarWidth: 'none' }}>
        {[
          { id: 'recommendation', label: '🎯 Top Picks', desc: 'AI Match' },
          { id: 'fastest', label: '⚡ Fastest', desc: '< 30 min' },
          { id: 'rating', label: '⭐ Top Rated', desc: '4.8+' },
          { id: 'distance', label: '📍 Nearest', desc: 'Proximity' }
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
              background: sortBy === tab.id ? 'linear-gradient(135deg, #ff6b35 0%, #d97706 100%)' : 'var(--surface-1)',
              color: sortBy === tab.id ? '#fff' : 'var(--text-1)',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              boxShadow: sortBy === tab.id ? '0 4px 12px rgba(255,107,53,0.3)' : 'none'
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

      {/* UberEats Featured Top Picks Horizontal Carousel */}
      {sortBy === 'recommendation' && !loading && filtered.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔥 Top Picks Near You</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 700 }}>Curated</span>
          </div>

          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
            {filtered.slice(0, 4).map(r => (
              <div
                key={`pick_${r.id}`}
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
                  <span style={{ position: 'absolute', top: 8, left: 8, background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 800 }}>
                    🔥 Top Rated
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  <h4 style={{ margin: '0 0 2px', fontSize: '0.92rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </h4>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    ⭐ {r.rating} · ⏱️ {r.deliveryTime || '20-30 min'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
                    📍 {r.distanceKm ? `${r.distanceKm} km away` : 'Near you'}
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
          {sortBy === 'fastest' ? '⚡ Fastest Outlets Near You' :
           sortBy === 'rating' ? '⭐ Highest Rated Restaurants' :
           sortBy === 'distance' ? '📍 Closest Outlets' :
           `Popular Outlets Near You (${filtered.length})`}
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--brand)', fontWeight: 700 }}>{filtered.length} Unique Outlets</span>
      </div>

      {/* Restaurants Grid / Cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div className="spinner" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading real nearby restaurants...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 32, background: 'var(--surface-1)', borderRadius: 16, border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🏪</div>
          <h4 style={{ margin: 0, color: 'var(--text-1)' }}>No restaurants found</h4>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Try searching for another dish or cuisine type.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {filtered.map(r => (
            <div
              key={r.id}
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
                
                {/* Promo Badge */}
                {r.promoBadge && (
                  <span style={{ position: 'absolute', top: 12, left: 12, background: '#10b981', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 800 }}>
                    🏷️ {r.promoBadge}
                  </span>
                )}

                {/* Distance Badge */}
                {r.distanceKm && (
                  <span style={{ position: 'absolute', bottom: 12, left: 12, background: r.isDeliverable ? 'rgba(16,185,129,0.9)' : 'rgba(245,158,11,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 800, backdropFilter: 'blur(4px)' }}>
                    📍 {r.distanceKm} km away {r.isDeliverable ? '· In Range' : '· Out of Zone'}
                  </span>
                )}

                {/* Store Open Pill */}
                <span style={{ position: 'absolute', top: 12, right: 12, background: r.isOpen ? 'rgba(0,0,0,0.65)' : 'rgba(239,68,68,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700, backdropFilter: 'blur(4px)' }}>
                  {r.isOpen ? '🟢 Open Now' : '🔴 Closed'}
                </span>
              </div>

              {/* Card Details */}
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-1)' }}>
                    {r.name}
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f59e0b15', color: '#f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 800 }}>
                    ⭐ {r.rating || '4.8'} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>({r.ratingCount || '120+'})</span>
                  </div>
                </div>

                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  {r.cuisine} · 📍 {r.location || 'Colombo'}
                </div>

                {/* Delivery Stats Bar */}
                <div style={{ display: 'flex', gap: 14, fontSize: '0.78rem', color: 'var(--text-1)', fontWeight: 600, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    ⏱️ {r.deliveryTime || '20-30 min'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    🚚 LKR {r.deliveryFee || 150} Fee
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
                    Min: LKR {r.minOrder || 1000}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
