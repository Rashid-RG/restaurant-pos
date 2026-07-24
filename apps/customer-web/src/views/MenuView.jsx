import React, { useState, useEffect } from 'react';
import { useCart } from '../context/CartContext.jsx';
import { useCustomerAuth } from '../context/CustomerAuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { apiFetch } from '../utils/api.js';
import { withTenant } from '../utils/tenant.js';

// Render **bold** markdown in AI replies without injecting HTML (safe against XSS).
function renderChatText(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export default function MenuView({ onNavigate, toast }) {
  const { t, dict } = useLang();

  const [menu, setMenu] = useState({ categories: [], items: [], restaurantName: '', logo: null });
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedDiet, setSelectedDiet] = useState(null); // 'veg' | 'spicy' | 'gf' | 'halal' | 'nut-free' | 'vegan'
  const [sortBy, setSortBy] = useState('popular'); // 'popular' | 'price-asc' | 'price-desc' | 'prep'
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Personalized reorder recommendation list
  const [personalRecs, setPersonalRecs] = useState([]);

  // Modifiers Dialog State
  const [customizerItem, setCustomizerItem] = useState(null);
  const [customizerQty, setCustomizerQty] = useState(1);
  const [customizerNotes, setCustomizerNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState([]);
  const [showCustomizerModal, setShowCustomizerModal] = useState(false);

  // Group Order State
  const [groupId, setGroupId] = useState('');
  const [participantName, setParticipantName] = useState(localStorage.getItem('gastroflow_participant') || '');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupCartItems, setGroupCartItems] = useState([]);

  // AI Chat State (Pro Advanced Sommelier & Concierge)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([
    {
      sender: 'ai',
      text: "Hello! I am **GastroAI Sommelier & Concierge** 🤖✨\n\nHow can I help curate your meal today?",
      recommendedItems: [],
      suggestions: ["💡 Combo under LKR 3000", "🌶️ Fiery Spicy Dishes", "🌱 Best Veggie Choices", "🍹 Refreshing Drinks"]
    }
  ]);
  const [chatTyping, setChatTyping] = useState(false);

  const { items: cartItems, addItem, totalItems, setCartOpen } = useCart();
  const { customer, getToken } = useCustomerAuth();

  // Load Menu Data & Check URL parameters (Table bindings / Group carts)
  useEffect(() => {
    // 1. Fetch Menu
    apiFetch('/public/menu')
      .then(data => {
        setMenu({
          categories: data.categories || [],
          items: data.items || [],
          restaurantName: data.restaurantName || '',
          logo: data.logo || null,
          storeOpen: data.storeOpen !== undefined ? data.storeOpen : true
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // 2. Table QR Binding
    const params = new URLSearchParams(window.location.search);
    const tableParam = params.get('table');
    if (tableParam) {
      localStorage.setItem('gastroflow_dinein_table', tableParam);
      toast(`Bound to Dine-In Table ${tableParam.toUpperCase()}! 🪑`, 'success');
    }

    // 3. Group Cart Parameter
    const groupParam = params.get('group');
    if (groupParam) {
      setGroupId(groupParam);
      if (!participantName) {
        setShowGroupModal(true);
      }
    }
  }, []);

  // Poll Group Cart items if active
  useEffect(() => {
    if (!groupId) return;
    const interval = setInterval(() => {
      apiFetch(`/public/group-cart/${groupId}`)
        .then(data => {
          setGroupCartItems(data.items || []);
        })
        .catch(err => console.error('Error fetching group cart:', err));
    }, 3000);
    return () => clearInterval(interval);
  }, [groupId]);

  // Live store SSE — subscribes to /api/stream/store so the customer app reacts
  // instantly to: store open/closed toggle, 86-item, prep-time changes.
  // No page reload needed — the POS staff action propagates in < 1 second.
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const es = new EventSource(withTenant(`${API_BASE}/api/stream/store`));

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'store_init' || data.type === 'store_update') {
          setMenu(prev => ({
            ...prev,
            storeOpen: data.storeOpen,
            prepTime: data.prepTime ?? prev.prepTime
          }));
          if (data.type === 'store_update' && data.storeOpen === false) {
            toast('The store is now closed for online orders.', 'warning');
          } else if (data.type === 'store_update' && data.storeOpen === true) {
            toast('The store is now open! 🎉', 'success');
          }
        }

        if (data.type === 'item_availability') {
          setMenu(prev => ({
            ...prev,
            items: prev.items.map(it => it.id === data.itemId ? { ...it, isAvailable: data.isAvailable } : it)
          }));
          const label = data.isAvailable ? 'back in stock' : 'marked 86 (sold out)';
          toast(`Item ${data.itemId} is now ${label}.`, 'info');
        }

        if (data.type === 'group_cart_updated' && groupId) {
          apiFetch(`/public/group-cart/${groupId}`)
            .then(cartData => setGroupCartItems(cartData.items || []))
            .catch(err => console.error('SSE group cart update error:', err));
        }
      } catch (_) {}
    };

    es.onerror = () => {
      // EventSource auto-reconnects; no manual action needed.
    };

    return () => es.close();
  }, []);



  // Load personalized suggestions if customer is logged in
  useEffect(() => {
    const token = getToken();
    if (!customer || !token || menu.items.length === 0) {
      setPersonalRecs([]);
      return;
    }

    apiFetch('/customer/orders', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(pastOrders => {
        if (!pastOrders || pastOrders.length === 0) return;
        
        // Count item frequencies in past orders
        const frequencies = {};
        pastOrders.forEach(order => {
          if (order.items) {
            order.items.forEach(itm => {
              frequencies[itm.name] = (frequencies[itm.name] || 0) + itm.quantity;
            });
          }
        });

        // Map names back to menu items
        const sortedRecs = Object.keys(frequencies)
          .map(name => menu.items.find(i => i.name === name))
          .filter(Boolean)
          .filter(i => i.isAvailable !== 0 && (i.stock === undefined || i.stock > 0))
          .slice(0, 3); // top 3 favorites

        setPersonalRecs(sortedRecs);
      })
      .catch(() => {});
  }, [customer, menu.items]);

  const getQty = (id) => cartItems.find(i => i.id === id)?.qty || 0;

  // Advanced Multi-Dimensional Filter & Sort Items
  const filteredItems = (menu.items || [])
    .filter(item => {
      const matchCat = activeCategory === 'all' || item.category === activeCategory;
      const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || (item.description || '').toLowerCase().includes(search.toLowerCase());
      
      // Max price threshold
      let matchPrice = true;
      if (maxPriceFilter && !isNaN(parseFloat(maxPriceFilter))) {
        matchPrice = item.price <= parseFloat(maxPriceFilter);
      }

      // Dietary filter
      let matchDiet = true;
      if (selectedDiet) {
        const tags = (item.dietaryTags || '').split(',').map(tag => tag.trim().toLowerCase());
        matchDiet = tags.includes(selectedDiet.toLowerCase());
      }
      return matchCat && matchSearch && matchDiet && matchPrice;
    })
    .sort((a, b) => {
      if (sortBy === 'price-asc') return a.price - b.price;
      if (sortBy === 'price-desc') return b.price - a.price;
      if (sortBy === 'prep') return (a.prepTimeMinutes || 15) - (b.prepTimeMinutes || 15);
      return 0; // Default featured/popular order
    });

  // Open Customizer
  const handleItemAddClick = (item) => {
    if (item.modifiers && item.modifiers.length > 0) {
      setCustomizerItem(item);
      setCustomizerQty(1);
      setCustomizerNotes('');
      setSelectedModifiers([]);
      setShowCustomizerModal(true);
    } else {
      handleAddToCart(item, 1, [], '');
    }
  };

  // Handle Modifiers Selection
  const handleModifierToggle = (modifier, groupName, isMultiSelect) => {
    setSelectedModifiers(prev => {
      if (isMultiSelect) {
        const exists = prev.find(m => m.id === modifier.id);
        if (exists) return prev.filter(m => m.id !== modifier.id);
        return [...prev, modifier];
      } else {
        const filtered = prev.filter(m => m.groupName !== groupName);
        return [...filtered, modifier];
      }
    });
  };

  // Add customized item to cart (local or group)
  const handleAddToCart = async (item, qty, modifiers, notes) => {
    addItem(item, qty, modifiers, notes);
    
    if (groupId && participantName) {
      try {
        await apiFetch(`/public/group-cart/${groupId}/items`, {
          method: 'POST',
          body: JSON.stringify({
            participantName,
            itemId: item.id,
            quantity: qty,
            notes,
            selectedModifiers: modifiers
          })
        });
        toast(`${item.name} shared to group cart!`, 'success');
      } catch (err) {
        toast('Failed to update group cart: ' + err.message, 'error');
      }
    } else {
      toast(`${item.name} added to cart!`, 'success');
    }
    setShowCustomizerModal(false);
  };

  // Start Group Order
  const handleStartGroupOrder = () => {
    const randomId = `group_${Date.now()}`;
    setGroupId(randomId);
    window.history.pushState({}, '', `?group=${randomId}`);
    setShowGroupModal(true);
  };

  // Copy Group Link
  const handleCopyGroupLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?group=${groupId}`;
    navigator.clipboard.writeText(link);
    toast('Group link copied to clipboard! 📋', 'success');
  };

  // Submit AI Chat Query
  const sendChatMessage = async (msgText) => {
    if (!msgText.trim()) return;

    setChatHistory(prev => [...prev, { sender: 'user', text: msgText.trim() }]);
    setChatInput('');
    setChatTyping(true);

    try {
      const data = await apiFetch('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msgText.trim(), cartItems })
      });

      setChatHistory(prev => [...prev, {
        sender: 'ai',
        text: data.reply,
        recommendedItems: data.recommendedItems || [],
        suggestions: data.suggestions || []
      }]);

      // Conversational Order Adding Action
      if (data.action && data.action.type === 'add_to_cart') {
        const matched = menu.items.find(i => i.id === data.action.itemId);
        if (matched) {
          handleAddToCart(matched, data.action.quantity || 1, [], '');
        }
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { sender: 'ai', text: "Sorry, I am having trouble connecting right now. Please try again." }]);
    } finally {
      setChatTyping(false);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    await sendChatMessage(chatInput);
  };

  // Modifiers grouped by groupName
  const groupedModifiers = customizerItem
    ? customizerItem.modifiers.reduce((acc, curr) => {
        if (!acc[curr.groupName]) acc[curr.groupName] = [];
        acc[curr.groupName].push(curr);
        return acc;
      }, {})
    : {};

  // Compute live price delta in customizer
  const currentModifiersCost = selectedModifiers.reduce((acc, m) => acc + m.priceDelta, 0);
  const singleItemPrice = customizerItem ? customizerItem.price + currentModifiersCost : 0;
  const totalCustomizerPrice = singleItemPrice * customizerQty;

  return (
    <div className="fade-in" style={{ paddingBottom: '100px' }}>
      
      {/* Store Closed Banner */}
      {menu.storeOpen === false && (
        <div style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '14px 16px', margin: '16px', borderRadius: 12, textAlign: 'center', fontWeight: 700 }}>
          🛑 {t.storeClosed}
          <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', marginTop: 4 }}>
            {t.storeClosedDesc}
          </div>
        </div>
      )}
      
      {/* Group Order Button (language is switched globally from the header) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}>

        <div>
          {groupId ? (
            <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'var(--brand)' }} onClick={() => setShowGroupModal(true)}>
              👥 {t.activeGroup}
            </button>
          ) : (
            <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={handleStartGroupOrder}>
              👥 {t.groupOrder}
            </button>
          )}
        </div>
      </div>

      {/* Hero Banner */}
      <div className="hero-banner" style={{ textAlign: 'center', padding: '30px 16px', background: 'linear-gradient(135deg, rgba(255, 126, 41, 0.1) 0%, rgba(255, 61, 0, 0.05) 100%)' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, margin: 0, color: 'var(--brand)' }}>{menu.restaurantName || 'GastroFlow Bistro'}</h1>
        <p style={{ color: 'var(--text-2)', fontSize: '0.95rem', marginTop: 6 }}>
          {customer ? `👋 Welcome back, ${customer.name}! 🎉` : t.welcome}
        </p>
      </div>

      {/* Advanced Multi-Dimensional Filter Bar */}
      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        
        {/* Search & Sort Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '1rem' }}>🔍</span>
            <input
              className="form-control"
              style={{ paddingLeft: 38, paddingRight: search ? 32 : 12, fontSize: '0.88rem' }}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                ✕
              </button>
            )}
          </div>

          <select
            className="form-control"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ fontSize: '0.82rem', padding: '8px 10px', height: '100%' }}
          >
            <option value="popular">⭐ Popular</option>
            <option value="price-asc">💵 Price: Low → High</option>
            <option value="price-desc">💎 Price: High → Low</option>
            <option value="prep">⚡ Quickest Prep</option>
          </select>
        </div>

        {/* Dietary & Max Price Controls */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Filters:</span>
          
          <button 
            className={`cat-pill ${selectedDiet === null ? 'active' : ''}`}
            onClick={() => setSelectedDiet(null)}
            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
          >
            {t.all}
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'veg' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'veg' ? null : 'veg')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#4caf50' }}
          >
            🌱 Veg
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'vegan' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'vegan' ? null : 'vegan')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#2e7d32' }}
          >
            🌿 Vegan
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'spicy' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'spicy' ? null : 'spicy')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#f44336' }}
          >
            🌶️ Spicy
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'gf' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'gf' ? null : 'gf')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#ff9800' }}
          >
            🌾 Gluten-Free
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'halal' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'halal' ? null : 'halal')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#00bcd4' }}
          >
            🌙 Halal
          </button>
          <button 
            className={`cat-pill ${selectedDiet === 'nut-free' ? 'active' : ''}`}
            onClick={() => setSelectedDiet(prev => prev === 'nut-free' ? null : 'nut-free')}
            style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: '#e91e63' }}
          >
            🥜 Nut-Free
          </button>

          {/* Max Price Pill Input */}
          <input
            type="number"
            placeholder="Max LKR"
            value={maxPriceFilter}
            onChange={e => setMaxPriceFilter(e.target.value)}
            style={{
              width: 80,
              padding: '4px 8px',
              fontSize: '0.78rem',
              borderRadius: 20,
              border: maxPriceFilter ? '1px solid var(--brand)' : '1px solid var(--border-color)',
              background: 'var(--bg-surface)'
            }}
          />
        </div>

        {/* Active Filter Chips & Reset Bar */}
        {(selectedDiet || search || maxPriceFilter || sortBy !== 'popular' || activeCategory !== 'all') && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Showing {filteredItems.length} matching items</span>
            <button
              onClick={() => {
                setSelectedDiet(null);
                setSearch('');
                setMaxPriceFilter('');
                setSortBy('popular');
                setActiveCategory('all');
              }}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontWeight: 600 }}
            >
              Reset All Filters 🔄
            </button>
          </div>
        )}
      </div>

      {/* Personalized Menu suggestions based on history */}
      {customer && personalRecs.length > 0 && (
        <div style={{ padding: '16px 16px 0' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 10, color: 'var(--text-1)' }}>{t.personalizedTitle}</h3>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {personalRecs.map(item => (
              <div key={item.id} style={{ minWidth: 200, background: 'var(--bg-card)', padding: 12, borderRadius: 12, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.5rem' }}>{item.emoji}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand)' }}>Rs. {item.price}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 8 }}>{item.name}</div>
                </div>
                <button className="btn btn-brand" style={{ padding: '4px 8px', fontSize: '0.75rem', marginTop: 10 }} onClick={() => handleItemAddClick(item)}>
                  ＋ Quick Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Pills Strip */}
      <div className="category-strip" style={{ marginTop: 12 }}>
        <div className="category-scroll">
          <button
            className={`cat-pill ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            🍽️ {t.all}
          </button>
          {menu.categories.map(cat => (
            <button
              key={cat.id}
              className={`cat-pill ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Group Cart Consolidated Live View Panel */}
      {groupId && groupCartItems.length > 0 && (
        <div style={{ margin: '16px', padding: '16px', background: 'var(--bg-card)', border: '2px dashed var(--brand)', borderRadius: '12px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>👥 {t.activeGroup} ({groupId})</span>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={handleCopyGroupLink}>{t.shareLink}</button>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {groupCartItems.map((gi, idx) => (
              <div key={idx} style={{ fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
                <span><strong>{gi.participantName}</strong>: {gi.name} (x{gi.quantity})</span>
                <span>Rs. {(gi.price * gi.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu Grid */}
      <div className="menu-section" style={{ marginTop: 16 }}>
        {loading ? (
          <div className="menu-grid" aria-busy="true" aria-label="Loading menu">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: '40px 0', color: 'var(--text-muted)', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🥺</div>
            <p>No items match current filters.</p>
          </div>
        ) : (
          <div className="menu-grid">
            {filteredItems.map(item => {
              const qty = getQty(item.id);
              const isSoldOut = item.stock !== undefined && item.stock <= 0;
              const tags = (item.dietaryTags || '').split(',').map(tag => tag.trim()).filter(Boolean);

              return (
                <div key={item.id} className={`menu-card ${isSoldOut ? 'out-of-stock' : ''}`} style={{ background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-color)', opacity: isSoldOut ? 0.65 : 1 }}>
                  {item.imageUrl ? (
                    <div className="menu-card-emoji" style={{ padding: 0 }}>
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentNode.textContent = item.emoji || '🍽️'; }}
                      />
                    </div>
                  ) : (
                    <div className="menu-card-emoji">
                      {item.emoji || '🍽️'}
                    </div>
                  )}

                  <div className="menu-card-body" style={{ padding: 16 }}>
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                        {tags.map(tag => (
                          <span key={tag} style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: tag === 'veg' ? '#e8f5e9' : tag === 'spicy' ? '#ffebee' : '#fff3e0', color: tag === 'veg' ? '#2e7d32' : tag === 'spicy' ? '#c62828' : '#ef6c00' }}>
                            {tag.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="menu-card-name" style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-1)' }}>{item.name}</div>
                    {item.description && <div className="menu-card-desc" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '34px' }}>{item.description}</div>}
                    
                    {item.allergens && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 6, fontWeight: 700 }}>
                        ⚠️ Contains: {item.allergens}
                      </div>
                    )}
                    
                    <div className="menu-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                      <div className="menu-card-price" style={{ fontWeight: 800, color: 'var(--brand)' }}>Rs. {item.price.toFixed(0)}</div>
                      {isSoldOut ? (
                        <span style={{ fontSize: '0.72rem', color: 'var(--danger)', fontWeight: 800 }}>{t.soldOut}</span>
                      ) : (
                        <button
                          className="add-btn"
                          style={menu.storeOpen === false ? { background: 'var(--text-muted)', cursor: 'not-allowed', opacity: 0.5 } : undefined}
                          onClick={() => menu.storeOpen !== false && handleItemAddClick(item)}
                          disabled={menu.storeOpen === false}
                          aria-label={`Add ${item.name} to cart`}
                        >
                          +
                        </button>
                      )}
                    </div>

                    {!isSoldOut && item.stock > 0 && item.stock <= 5 && (
                      <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--warning)', fontWeight: 700 }}>
                        {t.onlyLeft.replace('{count}', item.stock)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customized Item Modifier Selection Modal */}
      {showCustomizerModal && customizerItem && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div className="glass" style={{ width: '100%', maxWidth: 480, background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90dvh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>{t.customizerTitle}</h3>
              <button style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-1)' }} onClick={() => setShowCustomizerModal(false)}>✕</button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: '3rem' }}>{customizerItem.emoji || '🍽️'}</span>
              <h4 style={{ margin: '8px 0 4px', fontSize: '1.05rem', fontWeight: 700 }}>{customizerItem.name}</h4>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>{customizerItem.description}</p>
            </div>

            {/* Modifier Groups */}
            {Object.keys(groupedModifiers).map(groupName => {
              const mods = groupedModifiers[groupName];
              const isMulti = mods[0].isMultiSelect === 1;
              const isRequired = mods[0].isRequired === 1;

              return (
                <div key={groupName} style={{ marginBottom: 16, padding: 12, background: 'rgba(0,0,0,0.02)', borderRadius: 10 }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '0.88rem', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{groupName}</span>
                    {isRequired && <span style={{ fontSize: '0.72rem', color: 'var(--brand)' }}>*Required</span>}
                  </h5>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {mods.map(mod => {
                      const isChecked = !!selectedModifiers.find(m => m.id === mod.id);
                      return (
                        <label key={mod.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input 
                              type={isMulti ? "checkbox" : "radio"} 
                              name={groupName} 
                              checked={isChecked}
                              onChange={() => handleModifierToggle(mod, groupName, isMulti)}
                              style={{ width: 16, height: 16, accentColor: 'var(--brand)' }}
                            />
                            <span>{mod.name}</span>
                          </div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            {mod.priceDelta > 0 ? `+ Rs. ${mod.priceDelta}` : 'Free'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Quantity Control */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0', padding: '12px 0', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t.quantity}</span>
              <div className="qty-control" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="dec" aria-label="Decrease quantity" onClick={() => setCustomizerQty(prev => Math.max(1, prev - 1))}>−</button>
                <span className="qty" style={{ fontWeight: 700 }}>{customizerQty}</span>
                <button className="inc" aria-label="Increase quantity" onClick={() => setCustomizerQty(prev => prev + 1)}>+</button>
              </div>
            </div>

            {/* Special Instructions Notes */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>{t.instructions}</label>
              <textarea 
                className="form-control" 
                rows="2"
                placeholder="E.g., No onions, extra spicy, etc."
                value={customizerNotes}
                onChange={e => setCustomizerNotes(e.target.value)}
                style={{ resize: 'none' }}
              />
            </div>

            {/* Submit */}
            <button 
              className="btn btn-brand" 
              style={{ width: '100%', padding: '12px' }}
              onClick={() => handleAddToCart(customizerItem, customizerQty, selectedModifiers, customizerNotes)}
            >
              {t.addToCart} · Rs. {totalCustomizerPrice.toFixed(0)}
            </button>
          </div>
        </div>
      )}

      {/* Group Cart Identity Modal */}
      {showGroupModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.55)', zIndex: 1010, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="glass" style={{ width: '100%', maxWidth: 380, background: 'var(--bg-card)', borderRadius: 16, padding: 24 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', fontWeight: 800 }}>👥 {t.groupOrder}</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.groupDesc}</p>
            
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6, display: 'block' }}>{t.enterParticipant}</label>
              <input 
                className="form-control"
                placeholder="E.g. Shanika"
                value={participantName}
                onChange={e => setParticipantName(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button 
                className="btn btn-brand" 
                style={{ flex: 1 }}
                onClick={() => {
                  if (participantName.trim()) {
                    localStorage.setItem('gastroflow_participant', participantName.trim());
                    setShowGroupModal(false);
                    toast('Group cart active! Add items to collaborate.', 'success');
                  }
                }}
                disabled={!participantName.trim()}
              >
                {t.join}
              </button>
              <button 
                className="btn btn-ghost"
                onClick={() => {
                  setGroupId('');
                  window.history.pushState({}, '', window.location.pathname);
                  setShowGroupModal(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Chat drawer sliding panel (Pro Advanced Sommelier & Concierge) */}
      {chatOpen && (
        <div style={{ position: 'fixed', bottom: 'var(--bottom-bar)', right: 16, width: 'calc(100% - 32px)', maxWidth: 380, height: 460, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px 16px 0 0', boxShadow: 'var(--shadow-lg)', zIndex: 900, display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: '#fff', padding: '12px 16px', borderRadius: '16px 16px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.3rem' }}>🤖</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>GastroAI Concierge</div>
                <div style={{ fontSize: '0.68rem', color: '#e0e7ff', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} /> Menu & Sommelier Expert
                </div>
              </div>
            </div>
            <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setChatOpen(false)}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', background: 'rgba(0,0,0,0.03)', padding: '6px 12px', borderRadius: 8 }}>
              Ask for pairings, budget combos, dietary advice, or track orders live!
            </p>

            {chatHistory.map((chat, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: chat.sender === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
                <div style={{ background: chat.sender === 'user' ? 'var(--brand)' : 'var(--surface-3)', color: chat.sender === 'user' ? '#fff' : 'var(--text)', padding: '10px 14px', borderRadius: 14, fontSize: '0.82rem', maxWidth: '88%', whiteSpace: 'pre-line', boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}>
                  {renderChatText(chat.text)}

                  {/* Recommendation Cards inside chat */}
                  {chat.recommendedItems && chat.recommendedItems.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {chat.recommendedItems.map(item => (
                        <div key={item.id} style={{ background: 'var(--bg-card)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '1.2rem' }}>{item.emoji || '🍕'}</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-1)' }}>{item.name}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--brand)', fontWeight: 600 }}>LKR {item.price.toFixed(2)}</div>
                            </div>
                          </div>
                          <button
                            className="btn btn-brand"
                            style={{ padding: '4px 10px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                            onClick={() => {
                              const matched = menu.items.find(i => i.id === item.id) || item;
                              handleItemAddClick(matched);
                            }}
                          >
                            ＋ Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Prompt Suggestion Chips */}
                {chat.suggestions && chat.suggestions.length > 0 && idx === chatHistory.length - 1 && !chatTyping && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {chat.suggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
                        onClick={() => sendChatMessage(sug)}
                        style={{
                          background: 'rgba(99, 102, 241, 0.1)',
                          color: 'var(--brand)',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          padding: '4px 10px',
                          borderRadius: 20,
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {chatTyping && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }} aria-live="polite">
                <div style={{ background: 'var(--surface-3)', color: 'var(--text-3)', padding: '10px 14px', borderRadius: 12, fontSize: '0.82rem' }}>
                  <span className="typing-dots"><span></span><span></span><span></span></span>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSendChat} style={{ padding: 10, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 6 }}>
            <input 
              className="form-control"
              placeholder="Ask GastroAI (e.g. Combo under 3000)..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              style={{ padding: '10px 14px', fontSize: '16px' }}
            />
            <button className="btn btn-brand" style={{ padding: '8px 16px', width: 'auto', fontWeight: 700 }} type="submit" disabled={chatTyping || !chatInput.trim()}>
              Send ✈️
            </button>
          </form>
        </div>
      )}

      {/* Floating AI Assistant Bubble & Invitation Pill */}
      {!chatOpen && (
        <div style={{ position: 'fixed', bottom: 'calc(var(--bottom-bar) + 18px)', right: 16, display: 'flex', alignItems: 'center', gap: 8, zIndex: 850 }}>
          <div 
            onClick={() => setChatOpen(true)}
            style={{ 
              background: 'var(--surface)', 
              color: 'var(--text-1)', 
              padding: '6px 12px', 
              borderRadius: 20, 
              fontSize: '0.78rem', 
              fontWeight: 700, 
              boxShadow: 'var(--shadow)', 
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>✨ Ask GastroAI</span>
          </div>

          <button 
            onClick={() => setChatOpen(true)}
            aria-label="Open GastroAI Concierge"
            style={{ 
              position: 'relative',
              width: 54, 
              height: 54, 
              borderRadius: '50%', 
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', 
              color: '#fff', 
              border: '2px solid rgba(255,255,255,0.8)', 
              boxShadow: '0 8px 25px rgba(99, 102, 241, 0.45), 0 0 15px rgba(168, 85, 247, 0.35)', 
              fontSize: '1.6rem', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              transition: 'transform 0.2s ease'
            }}
          >
            🤖
            <span style={{ position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: '50%', background: '#22c55e', border: '2px solid #fff' }} />
          </button>
        </div>
      )}

      {/* Sticky View Cart Button */}
      {totalItems > 0 && (
        <div style={{ position: 'fixed', bottom: 'calc(var(--bottom-bar) + 12px)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 448, zIndex: 150 }}>
          <button className="btn btn-brand" style={{ width: '100%', padding: '12px', fontWeight: 700 }} onClick={() => setCartOpen(true)}>
            🛒 {t.viewCart} ({totalItems} items)
          </button>
        </div>
      )}
    </div>
  );
}
