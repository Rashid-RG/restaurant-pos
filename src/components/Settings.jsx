import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function Settings() {
  const {
    currentUser,
    settings,
    updateSetting,
    menuItems,
    saveMenuItem,
    deleteMenuItem,
    clearAllMenuItems,
    categories,
    saveCategory,
    deleteCategory,
    clearAllCategories,
    exportDatabase,
    importDatabase,
    resetAllDatabase,
    showToast,
  } = usePOS();

  const isMasterSuperAdmin = !currentUser?.tenant_id || currentUser?.tenant_id === 'default_tenant';

  // Settings sub-tab selection: 'business' | 'menu' | 'database'
  const [subTab, setSubTab] = useState('business');

  // Business config states
  const [bizName, setBizName] = useState(settings.businessName || settings.restaurantName || '');
  const [currency, setCurrency] = useState(settings.currencySymbol || 'Rs.');
  const [tax, setTax] = useState(settings.taxRate ?? '0');
  const [serviceCharge, setServiceCharge] = useState(settings.serviceChargeRate ?? '0');
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || settings.logo || settings.restaurantLogo || '');

  useEffect(() => {
    setBizName(settings.businessName || settings.restaurantName || '');
    setCurrency(settings.currencySymbol || 'Rs.');
    setTax(settings.taxRate ?? '0');
    setServiceCharge(settings.serviceChargeRate ?? '0');
    setAddress(settings.address || '');
    setPhone(settings.phone || '');
    setLogoUrl(settings.logoUrl || settings.logo || settings.restaurantLogo || '');
  }, [settings]);




  // Menu item modal states
  const [showItemModal, setShowItemModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCost, setItemCost] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemEmoji, setItemEmoji] = useState('🍛');
  const [itemStock, setItemStock] = useState('50');
  const [itemMinStock, setItemMinStock] = useState('10');
  const [itemDesc, setItemDesc] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [itemDietaryTags, setItemDietaryTags] = useState('');
  const [itemAllergens, setItemAllergens] = useState('');
  const [itemIsAvailable, setItemIsAvailable] = useState(true);
  const [itemSpiceLevel, setItemSpiceLevel] = useState(0);
  const [itemIsHalal, setItemIsHalal] = useState(false);
  const [itemPrepTime, setItemPrepTime] = useState('');
  const [itemPortionSize, setItemPortionSize] = useState('Regular');
  const [itemImagePreview, setItemImagePreview] = useState('');
  const [imageUploadMode, setImageUploadMode] = useState('url'); // 'url' | 'file'

  // Sri Lanka default categories for quick setup
  const SL_DEFAULT_CATEGORIES = [
    { emoji: '🍚', name: 'Rice & Curry' },
    { emoji: '🍖', name: 'BBQ & Grill' },
    { emoji: '🍜', name: 'Kottu & Roti' },
    { emoji: '🥘', name: 'Short Eats' },
    { emoji: '🍳', name: 'Hoppers & String Hoppers' },
    { emoji: '🐟', name: 'Seafood' },
    { emoji: '🍱', name: 'Biriyani & Rice Dishes' },
    { emoji: '🍕', name: 'Pizza & Burgers' },
    { emoji: '🥤', name: 'Beverages & Juice' },
    { emoji: '🍮', name: 'Desserts & Sweets' },
    { emoji: '🍦', name: 'Ice Cream & Shakes' },
    { emoji: '☕', name: 'Hot Drinks' },
  ];

  // Sri Lanka dietary quick tags
  const SL_DIETARY_TAGS = [
    { label: '☪️ Halal', value: 'halal' },
    { label: '🌱 Vegetarian', value: 'vegetarian' },
    { label: '🌿 Vegan', value: 'vegan' },
    { label: '🌶️ Spicy', value: 'spicy' },
    { label: '❄️ Non-Spicy', value: 'non-spicy' },
    { label: '🥛 Contains Dairy', value: 'dairy' },
    { label: '🥜 Contains Nuts', value: 'nuts' },
    { label: '🌾 Gluten Free', value: 'gluten-free' },
    { label: '🐟 Contains Fish', value: 'fish' },
    { label: '🥚 Contains Egg', value: 'egg' },
  ];

  const handleImageFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be under 2MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target.result;
      setItemImageUrl(dataUrl);
      setItemImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const toggleDietaryTag = (tagValue) => {
    const current = itemDietaryTags ? itemDietaryTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const idx = current.indexOf(tagValue);
    if (idx > -1) {
      setItemDietaryTags(current.filter(t => t !== tagValue).join(', '));
    } else {
      setItemDietaryTags([...current, tagValue].join(', '));
      if (tagValue === 'halal') setItemIsHalal(true);
    }
  };

  const isDietaryTagActive = (tagValue) => {
    const current = itemDietaryTags ? itemDietaryTags.split(',').map(t => t.trim()) : [];
    return current.includes(tagValue);
  };

  // Category modal states
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [catName, setCatName] = useState('');
  const [catEmoji, setCatEmoji] = useState('🍕');

  // Database tool file reader state
  const [importFile, setImportFile] = useState(null);

  // SaaS Tenants list & provisioned credentials state
  const [tenantsList, setTenantsList] = useState([]);
  const [lastProvisioned, setLastProvisioned] = useState(null);
  const [loadingTenants, setLoadingTenants] = useState(false);

  const fetchTenants = async () => {
    setLoadingTenants(true);
    try {
      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
      const res = await fetch('/api/saas/tenants', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTenantsList(data || []);
      }
    } catch (_) {}
    finally { setLoadingTenants(false); }
  };

  useEffect(() => {
    if (subTab === 'saas') {
      fetchTenants();
    }
  }, [subTab]);

  const handleDeleteTenant = async (tenant) => {
    if (tenant.id === 'default_tenant') {
      showToast('Cannot delete the main default tenant store.', 'error');
      return;
    }
    if (!window.confirm(`⚠️ CRITICAL WARNING:\nAre you sure you want to PERMANENTLY DELETE store "${tenant.name}" (${tenant.subdomain})?\n\nThis will wipe all orders, menu items, users, and customer data for this shop!`)) {
      return;
    }
    try {
      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
      const res = await fetch(`/api/saas/tenants/${tenant.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tenant store.');
      showToast(data.message || 'Store deleted successfully!', 'success');
      fetchTenants();
    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  };

  const handleToggleStatus = async (tenant) => {
    const newStatus = tenant.status === 'suspended' ? 'active' : 'suspended';
    try {
      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
      const res = await fetch(`/api/saas/tenants/${tenant.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update store status.');
      showToast(data.message || 'Store status updated!', 'success');
      fetchTenants();
    } catch (err) {
      showToast('Status update error: ' + err.message, 'error');
    }
  };

  const handleSaveBusiness = async (e) => {
    e.preventDefault();
    try {
      await updateSetting('businessName', bizName);
      await updateSetting('restaurantName', bizName);
      await updateSetting('currencySymbol', currency);
      await updateSetting('taxRate', parseFloat(tax) || 0);
      await updateSetting('serviceChargeRate', parseFloat(serviceCharge) || 0);
      await updateSetting('address', address);
      await updateSetting('phone', phone);
      await updateSetting('logoUrl', logoUrl);
      showToast('🎉 Business profile & shop logo updated successfully!', 'success');
    } catch (err) {
      showToast('Save error: ' + (err.message || 'Failed to save settings'), 'error');
    }
  };

  const handleClearAllMenu = async () => {
    if (!window.confirm('⚠️ CRITICAL CONFIRMATION:\nAre you sure you want to WIPE ALL menu items and categories for your store?\n\nThis will remove all current items so you can start creating your real menu from a 100% clean slate!')) {
      return;
    }
    try {
      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
      const res = await fetch('/api/menu/clear-store-menu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear store menu');
      showToast(data.message || '🧹 Store menu cleared successfully!', 'success');
      if (typeof loadAllData === 'function') loadAllData(false);
    } catch (err) {
      showToast('Clear menu error: ' + err.message, 'error');
    }
  };

  const handleOpenItemAdd = () => {
    setEditItem(null);
    setItemName('');
    setItemPrice('');
    setItemCost('');
    setItemCategory(categories[0]?.id || '');
    setItemEmoji('🍛');
    setItemStock('50');
    setItemMinStock('10');
    setItemDesc('');
    setItemImageUrl('');
    setItemImagePreview('');
    setItemDietaryTags('');
    setItemAllergens('');
    setItemIsAvailable(true);
    setItemSpiceLevel(0);
    setItemIsHalal(false);
    setItemPrepTime('');
    setItemPortionSize('Regular');
    setImageUploadMode('url');
    setShowItemModal(true);
  };

  const handleOpenItemEdit = (item) => {
    setEditItem(item);
    setItemName(item.name);
    setItemPrice(item.price.toString());
    setItemCost(item.cost ? item.cost.toString() : '');
    setItemCategory(item.category);
    setItemEmoji(item.emoji || '🍛');
    setItemStock(item.stock.toString());
    setItemMinStock((item.minStock ?? 10).toString());
    setItemDesc(item.description || '');
    setItemImageUrl(item.imageUrl || '');
    setItemImagePreview(item.imageUrl || '');
    setItemDietaryTags(item.dietaryTags || '');
    setItemAllergens(item.allergens || '');
    setItemIsAvailable(item.isAvailable !== 0);
    setItemSpiceLevel(item.spiceLevel || 0);
    setItemIsHalal(item.isHalal === 1 || item.isHalal === true);
    setItemPrepTime(item.preparationTime ? item.preparationTime.toString() : '');
    setItemPortionSize(item.portionSize || 'Regular');
    setImageUploadMode('url');
    setShowItemModal(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!itemName || !itemPrice) return;

    const saved = {
      id: editItem ? editItem.id : `item_${Date.now()}`,
      name: itemName,
      price: parseFloat(itemPrice) || 0,
      cost: parseFloat(itemCost) || 0,
      category: itemCategory,
      emoji: itemEmoji,
      stock: parseInt(itemStock) || 0,
      minStock: parseInt(itemMinStock) || 0,
      description: itemDesc,
      imageUrl: itemImageUrl,
      dietaryTags: itemDietaryTags,
      allergens: itemAllergens,
      isAvailable: itemIsAvailable ? 1 : 0,
      spiceLevel: parseInt(itemSpiceLevel) || 0,
      isHalal: itemIsHalal ? 1 : 0,
      preparationTime: parseInt(itemPrepTime) || 0,
      portionSize: itemPortionSize,
    };

    await saveMenuItem(saved);
    showToast(`✅ "${itemName}" saved to database!`, 'success');
    setShowItemModal(false);
  };

  const handleDeleteItemClick = async (itemId) => {
    const item = menuItems.find(i => i.id === itemId);
    const itemName = item ? item.name : 'this item';
    if (confirm(`🗑️ Are you sure you want to delete "${itemName}" from the database?`)) {
      try {
        await deleteMenuItem(itemId);
        showToast(`🗑️ "${itemName}" deleted successfully!`, 'info');
      } catch (err) {
        showToast('Error deleting menu item: ' + err.message, 'error');
      }
    }
  };

  const handleClearAllMenu = async () => {
    if (menuItems.length === 0) {
      showToast('Menu is already empty.', 'info');
      return;
    }
    if (confirm('⚠️ Are you sure you want to delete ALL menu items from the database? This will remove all old/demo items so you can start adding your real menu.')) {
      try {
        await clearAllMenuItems();
        showToast('🗑️ All menu items have been removed from the database.', 'success');
      } catch (err) {
        showToast('Failed to clear menu items: ' + err.message, 'error');
      }
    }
  };

  const handleOpenCatAdd = () => {
    setEditCat(null);
    setCatName('');
    setCatEmoji('🍕');
    setShowCatModal(true);
  };

  const handleOpenCatEdit = (cat) => {
    setEditCat(cat);
    setCatName(cat.name || '');
    setCatEmoji(cat.emoji || '🍛');
    setShowCatModal(true);
  };

  const handleSaveCat = async (e) => {
    e.preventDefault();
    if (!catName) return;

    const saved = {
      id: editCat ? editCat.id : `cat_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: catName.trim(),
      emoji: catEmoji || '🍛',
    };

    try {
      await saveCategory(saved);
      showToast(`✅ Category "${saved.name}" saved successfully!`, 'success');
      setShowCatModal(false);
    } catch (err) {
      showToast('Error saving category: ' + err.message, 'error');
    }
  };

  const handleDeleteCatClick = async (catId) => {
    const cat = categories.find(c => c.id === catId);
    const catNameStr = cat ? cat.name : 'this category';
    if (confirm(`🗑️ Are you sure you want to delete category "${catNameStr}"? Items in this category might become unclassified.`)) {
      try {
        await deleteCategory(catId);
        showToast(`🗑️ Category "${catNameStr}" deleted.`, 'info');
      } catch (err) {
        showToast('Error deleting category: ' + err.message, 'error');
      }
    }
  };

  const handleClearAllCategories = async () => {
    if (categories.length === 0) {
      showToast('Categories are already empty.', 'info');
      return;
    }
    if (confirm('⚠️ Are you sure you want to delete ALL categories from the database?')) {
      try {
        await clearAllCategories();
        showToast('🗑️ All categories have been removed from the database.', 'success');
      } catch (err) {
        showToast('Failed to clear categories: ' + err.message, 'error');
      }
    }
  };

  const handleImportBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const result = await importDatabase(evt.target.result);
      if (result.success) {
        showToast('Database restored successfully from backup!', 'success');
        window.location.reload();
      } else {
        showToast(`Failed to import backup: ${result.error}`, 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleResetClick = async () => {
    if (confirm('⚠️ WARNING: This will completely wipe all sales records, inventory stock, customers, and menu items. Are you sure you want to reset the database?')) {
      await resetAllDatabase();
      showToast('Database reset to defaults.', 'info');
      window.location.reload();
    }
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>System Settings</h1>
          <p>Configure business variables, customize restaurant menu, and manage database tools.</p>
        </div>
      </div>

      <div className="view-body">
        <div className="settings-layout">
          
          {/* Inner Left Nav */}
          <nav className="settings-nav">
            <button
              className={`settings-nav-btn ${subTab === 'business' ? 'active' : ''}`}
              onClick={() => setSubTab('business')}
            >
              🏢 Business Info
            </button>
            <button
              className={`settings-nav-btn ${subTab === 'menu' ? 'active' : ''}`}
              onClick={() => setSubTab('menu')}
            >
              🍕 Menu & Categories
            </button>
            <button
              className={`settings-nav-btn ${subTab === 'database' ? 'active' : ''}`}
              onClick={() => setSubTab('database')}
            >
              💾 Database & Backup
            </button>
            <button
              className={`settings-nav-btn ${subTab === 'users' ? 'active' : ''}`}
              onClick={() => setSubTab('users')}
            >
              👥 Staff & Users
            </button>
            <button
              className={`settings-nav-btn ${subTab === 'online' ? 'active' : ''}`}
              onClick={() => setSubTab('online')}
            >
              🌐 Online Store
            </button>
            {isMasterSuperAdmin && (
              <button
                className={`settings-nav-btn ${subTab === 'saas' ? 'active' : ''}`}
                onClick={() => setSubTab('saas')}
              >
                ☁️ SaaS Multi-Tenancy
              </button>
            )}
          </nav>

          {/* Inner Panel */}
          <div className="settings-panel">
            
            {/* 1. Business Info Settings */}
            {subTab === 'business' && (
              <div>
                <h2 className="settings-section-title">Business Settings</h2>
                <form onSubmit={handleSaveBusiness}>
                  <div className="form-group">
                    <label>Restaurant Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Currency Symbol</label>
                      <input
                        type="text"
                        className="form-input"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Tax Rate (%)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={tax}
                        onChange={(e) => setTax(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Service Charge (%)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={serviceCharge}
                        onChange={(e) => setServiceCharge(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>📞 Store Official Phone / Hotline Number</span>
                      <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>Customer Enquiries & WhatsApp</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 0752237947 or +94752237947"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '4px', display: 'block' }}>
                      This phone number is displayed on receipts, order tracking, and customer support for direct customer enquiries.
                    </small>
                  </div>

                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ fontWeight: 600 }}>Restaurant Address (Printed on Receipts & Customer App)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                      Shop Logo (Printed on Receipts & Customer App)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt="Shop Logo"
                          style={{
                            width: '70px',
                            height: '70px',
                            objectFit: 'contain',
                            borderRadius: '12px',
                            border: '2px solid var(--border-color)',
                            background: '#fff',
                            padding: '4px'
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '70px',
                          height: '70px',
                          borderRadius: '12px',
                          border: '2px dashed var(--border-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '24px',
                          background: 'rgba(255,255,255,0.05)'
                        }}>
                          🏪
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: '220px' }}>
                        <input
                          type="file"
                          accept="image/*"
                          className="form-input"
                          style={{ padding: '8px', marginBottom: '8px' }}
                          onChange={(e) => {
                            const file = e.target.files && e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (evt) => {
                                setLogoUrl(evt.target.result);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Or paste Logo Image URL (https://...)"
                          value={logoUrl}
                          onChange={(e) => setLogoUrl(e.target.value)}
                          style={{ fontSize: '13px' }}
                        />
                      </div>
                      {logoUrl && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setLogoUrl('')}
                          style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--color-danger)' }}
                        >
                          Remove Logo
                        </button>
                      )}
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: '16px', padding: '12px 24px', fontWeight: 700 }}>
                    💾 Save & Update Profile
                  </button>
                </form>
              </div>
            )}

            {/* 2. Menu and Categories CRUD Settings */}
            {subTab === 'menu' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                  <h2 className="settings-section-title" style={{ margin: 0 }}>Menu Setup</h2>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: '#ef4444', borderColor: '#ef444450', background: '#ef444410', padding: '6px 14px', fontSize: '12px', fontWeight: 800 }}
                    onClick={handleClearAllMenu}
                  >
                    🗑️ Reset / Clear All Menu Items
                  </button>
                </div>
                
                {/* Categories block */}
                <div style={{ marginBottom: '40px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: '700', margin: 0 }}>Menu Categories</h3>
                      <span className="badge badge-secondary" style={{ fontSize: '12px' }}>{categories.length} categories</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {categories.length > 0 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '5px 10px', fontSize: '12px', color: '#ef4444', background: '#ef444415', border: '1px solid #ef444430' }}
                          onClick={handleClearAllCategories}
                        >
                          🗑️ Clear All Categories
                        </button>
                      )}
                      <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleOpenCatAdd}>
                        ＋ Add Category
                      </button>
                    </div>
                  </div>

                  {categories.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-surface)', borderRadius: '10px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No categories yet. Click <strong>＋ Add Category</strong> to create your first category.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                      {categories.map((cat) => (
                        <div
                          key={cat.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            padding: '8px 16px',
                            borderRadius: '50px',
                            fontSize: '13px',
                            fontWeight: '600'
                          }}
                        >
                          <span style={{ cursor: 'pointer' }} onClick={() => handleOpenCatEdit(cat)} title="Click to edit category">{cat.emoji}</span>
                          <span style={{ cursor: 'pointer' }} onClick={() => handleOpenCatEdit(cat)} title="Click to edit category">{cat.name}</span>
                          <button
                            type="button"
                            style={{ color: 'var(--color-danger)', marginLeft: '8px', fontSize: '16px', fontWeight: 'bold', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                            title="Delete category from database"
                            onClick={() => handleDeleteCatClick(cat.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Menu items block */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '700' }}>Dish & Drink Menu</h3>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleOpenItemAdd}>
                      ＋ Add New Dish
                    </button>
                  </div>

                  {menuItems.length === 0 ? (
                    <div style={{ padding: '36px 20px', textAlign: 'center', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px dashed var(--border-color)', margin: '16px 0' }}>
                      <div style={{ fontSize: '36px', marginBottom: '8px' }}>🍽️</div>
                      <h4 style={{ margin: 0, fontWeight: 700, fontSize: '16px' }}>Your Store Menu is Empty</h4>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px', marginBottom: '18px' }}>
                        Start creating your restaurant menu! Add dish categories and menu items using the buttons above.
                      </p>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button className="btn btn-primary" style={{ padding: '8px 18px', fontWeight: 700 }} onClick={handleOpenItemAdd}>
                          ＋ Add Your First Dish
                        </button>
                        <button className="btn btn-outline" style={{ padding: '8px 18px', fontWeight: 600 }} onClick={handleOpenCatAdd}>
                          ＋ Add Category
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="data-table-container" style={{ border: 'none', margin: 0 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Item Name</th>
                            <th>Category</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {menuItems.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <span style={{ fontSize: '18px', marginRight: '8px' }}>{item.emoji}</span>
                                <span style={{ fontWeight: '600' }}>{item.name}</span>
                              </td>
                              <td>{categories.find((c) => c.id === item.category)?.name || item.category}</td>
                              <td>{currency || 'Rs.'} {item.price ? item.price.toFixed(2) : '0.00'}</td>
                              <td>{item.stock} units</td>
                              <td>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                    onClick={() => handleOpenItemEdit(item)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="btn"
                                    style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-light)' }}
                                    onClick={() => handleDeleteItemClick(item.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. Database Tools Settings */}
            {subTab === 'database' && (
              <div>
                <h2 className="settings-section-title">Database Maintenance</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Export block */}
                  <div style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Export Data Backup</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      Download all restaurant settings, sales receipts, customer records, and menu configurations as a local JSON file.
                    </p>
                    <button className="btn btn-primary" onClick={exportDatabase}>
                      📥 Export Backup File
                    </button>
                  </div>

                  {/* Import block */}
                  <div style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Restore Database Backup</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      Restore your POS data from an existing backup JSON file. Warning: This will overwrite current local database entries.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <input
                        type="file"
                        accept=".json"
                        id="backup-file-input"
                        style={{ display: 'none' }}
                        onChange={handleImportBackup}
                      />
                      <button className="btn btn-secondary" onClick={() => document.getElementById('backup-file-input').click()}>
                        📂 Upload JSON File
                      </button>
                    </div>
                  </div>

                  {/* Wipe block */}
                  <div style={{ padding: '20px', border: '1px solid var(--color-danger-light)', borderRadius: '12px', background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Danger Zone: Reset Database</h3>
                    <p style={{ fontSize: '13px', marginBottom: '16px', opacity: 0.9 }}>
                      Wipes all sales records, inventory adjustments, and resets the terminal to factory defaults. This action is irreversible!
                    </p>
                    <button className="btn btn-danger" onClick={handleResetClick}>
                      ⚠️ Wipe & Reset POS
                    </button>
                  </div>

                </div>
              </div>
            )}

            {/* 👥 Staff & User Management Sub-Tab */}
            {subTab === 'users' && (
              <div>
                <h2 className="settings-section-title">Staff & User Account Management</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Create and manage staff accounts, roles, access permissions, and quick-access POS PINs.
                </p>

                <UserManagementSection />
              </div>
            )}

            {/* 4. Online Store Admin Settings */}
            {subTab === 'online' && (
              <div>
                <h2 className="settings-section-title">Online Store Management</h2>
                
                <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    
                    <div style={{ flex: 1, minWidth: '200px', padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Store Status</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        Toggle the online store closed instantly if the kitchen is slammed.
                      </p>
                      <button 
                        className={`btn ${settings.find(s => s.key === 'storeOpen')?.value === 'true' ? 'btn-danger' : 'btn-primary'}`} 
                        onClick={async () => {
                          const currentVal = settings.find(s => s.key === 'storeOpen')?.value;
                          const nextVal = currentVal === 'true' ? 'false' : 'true';
                          await updateSetting('storeOpen', nextVal);
                          showToast(nextVal === 'true' ? '🟢 Online store is now OPEN' : '🔴 Online orders paused', nextVal === 'true' ? 'success' : 'info');
                        }}
                      >
                        {settings.find(s => s.key === 'storeOpen')?.value === 'true' ? '🔴 Pause Online Orders' : '🟢 Open Online Store'}
                      </button>
                    </div>

                    <div style={{ flex: 1, minWidth: '200px', padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Thermal Printer & Drawer</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Thermal Paper Width</label>
                        <select 
                          className="form-select"
                          value={settings.find(s => s.key === 'printerPaperWidth')?.value || '80mm'}
                          onChange={async (e) => {
                            await updateSetting('printerPaperWidth', e.target.value);
                          }}
                        >
                          <option value="80mm">80mm Standard Thermal Printer</option>
                          <option value="58mm">58mm Compact Thermal Printer</option>
                        </select>
                        <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginTop: '4px' }}>
                          <input 
                            type="checkbox"
                            checked={settings.find(s => s.key === 'autoKickDrawer')?.value === 'true'}
                            onChange={async (e) => {
                              await updateSetting('autoKickDrawer', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          Auto Kick Cash Drawer on Cash Settlement
                        </label>
                      </div>
                    </div>


                    <div style={{ flex: 1, minWidth: '200px', padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Prep Times (ETA)</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Preparation times shown to customers at online checkout (in minutes).
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: 600 }}>🪑 Dine-In Prep Time (mins)</label>
                          <input 
                            type="number" 
                            className="form-input" 
                            defaultValue={settings.find(s => s.key === 'dineInPrepTime')?.value || 15}
                            onBlur={async (e) => {
                              await updateSetting('dineInPrepTime', e.target.value);
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: 600 }}>🥡 Takeaway Prep Time (mins)</label>
                          <input 
                            type="number" 
                            className="form-input" 
                            defaultValue={settings.find(s => s.key === 'takeawayPrepTime')?.value || 20}
                            onBlur={async (e) => {
                              await updateSetting('takeawayPrepTime', e.target.value);
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: 600 }}>🚚 Delivery Prep & Travel Time (mins)</label>
                          <input 
                            type="number" 
                            className="form-input" 
                            defaultValue={settings.find(s => s.key === 'deliveryPrepTime')?.value || 35}
                            onBlur={async (e) => {
                              await updateSetting('deliveryPrepTime', e.target.value);
                            }}
                          />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ── Delivery Zone Strategy Panel ── */}
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>📍 Delivery Zone Strategy</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Dynamic distance-based delivery pricing optimized for Sri Lankan urban delivery economics. Fee = Base + (Distance × Per-km) + Surcharges.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🛵 Base Delivery Fee (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryBaseFee')?.value || 99}
                        onBlur={async (e) => await updateSetting('deliveryBaseFee', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Flat fee every delivery order</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>📏 Free Radius (km)</label>
                      <input 
                        type="number" step="0.5" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryFreeRadiusKm')?.value || 2}
                        onBlur={async (e) => await updateSetting('deliveryFreeRadiusKm', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>No per-km charge within this radius</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>💰 Per-Km Rate (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryPerKmRate')?.value || 50}
                        onBlur={async (e) => await updateSetting('deliveryPerKmRate', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Charge per km beyond free radius</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🚫 Max Delivery Radius (km)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryMaxRadiusKm')?.value || 15}
                        onBlur={async (e) => await updateSetting('deliveryMaxRadiusKm', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Reject orders beyond this distance</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🔥 Peak Hour Surcharge (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryPeakSurcharge')?.value || 50}
                        onBlur={async (e) => await updateSetting('deliveryPeakSurcharge', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Auto-applied during lunch & dinner rush</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🌧️ Rain Surcharge (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryRainSurcharge')?.value || 75}
                        onBlur={async (e) => await updateSetting('deliveryRainSurcharge', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Applied when rainy weather is toggled ON</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🎁 Free Delivery Threshold (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'deliveryFreeThreshold')?.value || 3000}
                        onBlur={async (e) => await updateSetting('deliveryFreeThreshold', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Orders above this get FREE delivery</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>📦 Min Order Value (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings.find(s => s.key === 'minimumOrder')?.value || 1000}
                        onBlur={async (e) => await updateSetting('minimumOrder', e.target.value)}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Minimum subtotal for delivery orders</span>
                    </div>
                  </div>

                  {/* Peak Hour Config */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕐 Lunch Peak Start</label>
                      <input type="time" className="form-input"
                        defaultValue={settings.find(s => s.key === 'peakLunchStart')?.value || '11:30'}
                        onBlur={async (e) => await updateSetting('peakLunchStart', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕑 Lunch Peak End</label>
                      <input type="time" className="form-input"
                        defaultValue={settings.find(s => s.key === 'peakLunchEnd')?.value || '14:00'}
                        onBlur={async (e) => await updateSetting('peakLunchEnd', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕕 Dinner Peak Start</label>
                      <input type="time" className="form-input"
                        defaultValue={settings.find(s => s.key === 'peakDinnerStart')?.value || '18:30'}
                        onBlur={async (e) => await updateSetting('peakDinnerStart', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕘 Dinner Peak End</label>
                      <input type="time" className="form-input"
                        defaultValue={settings.find(s => s.key === 'peakDinnerEnd')?.value || '21:30'}
                        onBlur={async (e) => await updateSetting('peakDinnerEnd', e.target.value)} />
                    </div>
                  </div>

                  {/* Store Location & Weather Controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>📍 Store GPS Location</h4>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '10px', fontWeight: 600 }}>Latitude</label>
                          <input type="number" step="0.0001" className="form-input"
                            defaultValue={settings.find(s => s.key === 'storeLat')?.value || '6.9271'}
                            onBlur={async (e) => await updateSetting('storeLat', e.target.value)} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '10px', fontWeight: 600 }}>Longitude</label>
                          <input type="number" step="0.0001" className="form-input"
                            defaultValue={settings.find(s => s.key === 'storeLng')?.value || '79.8612'}
                            onBlur={async (e) => await updateSetting('storeLng', e.target.value)} />
                        </div>
                      </div>
                      <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}
                        onClick={() => {
                          if ('geolocation' in navigator) {
                            navigator.geolocation.getCurrentPosition(async (pos) => {
                              await updateSetting('storeLat', pos.coords.latitude.toFixed(4));
                              await updateSetting('storeLng', pos.coords.longitude.toFixed(4));
                              showToast(`📍 Store location set to ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'success');
                            }, () => showToast('Could not detect location. Please enter manually.', 'warning'));
                          }
                        }}>📡 Use Current GPS Location</button>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>🌤️ Weather & Live Controls</h4>
                      <button
                        className={`btn ${settings.find(s => s.key === 'isRainyWeather')?.value === 'true' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '10px 16px', fontSize: '13px', width: '100%', marginBottom: '8px' }}
                        onClick={async () => {
                          const current = settings.find(s => s.key === 'isRainyWeather')?.value;
                          const next = current === 'true' ? 'false' : 'true';
                          await updateSetting('isRainyWeather', next);
                          showToast(next === 'true' ? '🌧️ Rainy Weather Mode ON — rain surcharge applies to deliveries.' : '☀️ Rainy Weather Mode OFF — normal delivery pricing.', 'info');
                        }}>
                        {settings.find(s => s.key === 'isRainyWeather')?.value === 'true' ? '🌧️ Rainy Weather ACTIVE (Click to Clear)' : '☀️ Normal Weather (Click for Rain Mode)'}
                      </button>
                      <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: 0 }}>
                        Activates rain surcharge on all delivery orders. Toggle during monsoon / heavy rain periods.
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Driver Dispatch Strategy Panel ── */}
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>🛵 Driver Dispatch Strategy</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Controls how delivery riders are assigned to orders.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    {[
                      { mode: 'auto', label: '🤖 Auto-Dispatch', desc: 'System auto-assigns nearest available driver using GPS distance.' },
                      { mode: 'hybrid', label: '⚡ Hybrid (Recommended)', desc: 'Auto-dispatch first → escalates to POS manager after timeout if no driver accepts.' },
                      { mode: 'manual', label: '👤 Manual', desc: 'Manager manually picks a driver from the fleet dropdown in POS.' }
                    ].map(opt => (
                      <div
                        key={opt.mode}
                        onClick={async () => {
                          await updateSetting('driverDispatchMode', opt.mode);
                          showToast(`Dispatch mode set to: ${opt.label}`, 'success');
                        }}
                        style={{
                          padding: '16px',
                          border: `2px solid ${settings.find(s => s.key === 'driverDispatchMode')?.value === opt.mode ? 'var(--color-primary)' : 'var(--border-color)'}`,
                          borderRadius: '12px',
                          background: settings.find(s => s.key === 'driverDispatchMode')?.value === opt.mode ? 'var(--color-primary-light, #6366f115)' : 'var(--bg-surface)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{opt.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                        {settings.find(s => s.key === 'driverDispatchMode')?.value === opt.mode && (
                          <div style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 700, marginTop: '6px' }}>✅ Active</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)', maxWidth: '300px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600 }}>⏱️ Auto-Dispatch Timeout (seconds)</label>
                    <input type="number" className="form-input"
                      defaultValue={settings.find(s => s.key === 'autoDispatchTimeoutSec')?.value || 180}
                      onBlur={async (e) => await updateSetting('autoDispatchTimeoutSec', e.target.value)} />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>In hybrid mode, escalates to manager after this timeout</span>
                  </div>
                </div>

                {/* ── Platform Commission (for partner stores) ── */}
                <div style={{ marginBottom: '32px', padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)', maxWidth: '320px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>💼 Platform Commission Rate</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Percentage charged to partner restaurants on every delivery order placed through the marketplace.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="number" step="0.5" min="0" max="50" className="form-input" style={{ maxWidth: '80px' }}
                      defaultValue={settings.find(s => s.key === 'platformCommissionRate')?.value || 15}
                      onBlur={async (e) => await updateSetting('platformCommissionRate', e.target.value)} />
                    <span style={{ fontSize: '14px', fontWeight: 700 }}>%</span>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px' }}>Live Availability List (86 Items)</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Quickly disable any menu item instantly. Disabled items will be hidden from the online menu.
                  </p>

                  <div className="data-table-container" style={{ border: 'none', margin: 0 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Category</th>
                          <th>Stock Level</th>
                          <th>Status</th>
                          <th>Quick Toggle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <span style={{ fontSize: '18px', marginRight: '8px' }}>{item.emoji}</span>
                              <span style={{ fontWeight: '600' }}>{item.name}</span>
                            </td>
                            <td>{categories.find((c) => c.id === item.category)?.name || item.category}</td>
                            <td>{item.stock} units</td>
                            <td>
                              <span className={`badge ${item.isAvailable !== 0 ? 'badge-success' : 'badge-danger'}`}>
                                {item.isAvailable !== 0 ? 'Active' : '86ed / Hidden'}
                              </span>
                            </td>
                            <td>
                              <button 
                                className={`btn ${item.isAvailable !== 0 ? 'btn-danger' : 'btn-primary'}`}
                                style={{ padding: '4px 12px', fontSize: '12px' }}
                                onClick={async () => {
                                  const updated = {
                                    ...item,
                                    isAvailable: item.isAvailable !== 0 ? 0 : 1
                                  };
                                  await saveMenuItem(updated);
                                }}
                              >
                                {item.isAvailable !== 0 ? '86 Item' : 'Activate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* 5. SaaS Multi-Tenancy Management */}
            {subTab === 'saas' && (
              <div>
                <h2 className="settings-section-title">☁️ SaaS Multi-Tenancy Platform</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Manage tenant organizations, provision isolated subdomains, and configure SaaS subscription tiers.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  <div className="card glass" style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tenant Isolation</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '4px' }}>Multi-Tenant (tenant_id)</div>
                  </div>
                  <div className="card glass" style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Database Adapter</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#22c55e', marginTop: '4px' }}>PostgreSQL / SQLite Dual</div>
                  </div>
                  <div className="card glass" style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Security Level</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#f59e0b', marginTop: '4px' }}>RLS Compatible</div>
                  </div>
                </div>

                <div className="card glass" style={{ padding: '20px', borderRadius: '12px', background: 'var(--bg-surface)', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>Provision New SaaS Tenant Subdomain</h3>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.target;
                    const tenant = {
                      name: form.tenantName.value,
                      subdomain: form.subdomain.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      ownerEmail: form.ownerEmail.value,
                      plan: form.plan.value
                    };
                    try {
                      const token = localStorage.getItem('gastroflow_token') || localStorage.getItem('token');
                      const res = await fetch('/api/saas/tenants', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(tenant)
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Failed to provision tenant.');
                      showToast(`🎉 Tenant "${tenant.name}" provisioned successfully!`, 'success');
                      setLastProvisioned(data.tenant);
                      fetchTenants();
                      form.reset();
                    } catch (err) {
                      showToast('Provisioning error: ' + err.message, 'error');
                    }
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Restaurant Tenant Name</label>
                        <input name="tenantName" type="text" className="form-input" placeholder="e.g. Twin BBQ Grill" required />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Subdomain Slug</label>
                        <input name="subdomain" type="text" className="form-input" placeholder="e.g. twinbbq" required />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Owner Contact Email</label>
                        <input name="ownerEmail" type="email" className="form-input" placeholder="owner@restaurant.lk" required />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Subscription Plan</label>
                        <select name="plan" className="form-input">
                          <option value="pro">Pro (Rs. 7,500/mo)</option>
                          <option value="enterprise">Enterprise (Rs. 15,000/mo)</option>
                          <option value="basic">Basic (Rs. 4,500/mo)</option>
                        </select>
                      </div>
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ padding: '10px 20px', fontSize: '14px' }}>
                      🚀 Provision Tenant Instance
                    </button>
                  </form>
                </div>

                {/* Newly Provisioned Credentials & Instant Links Card */}
                {lastProvisioned && (
                  <div className="card glass fade-in" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid #22c55e', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#22c55e', margin: 0 }}>
                        🎉 Store Provisioned Successfully: {lastProvisioned.name}
                      </h3>
                      <button className="btn btn-sm" onClick={() => setLastProvisioned(null)} style={{ fontSize: '11px' }}>✕ Close</button>
                    </div>

                    {/* Login Credentials Box */}
                    <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '10px', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>🔐 Owner POS Login Credentials:</div>
                      <div style={{ display: 'flex', gap: '24px', fontSize: '13px', fontFamily: 'monospace' }}>
                        <div><strong>Username:</strong> {lastProvisioned.staffUsername}</div>
                        <div><strong>Password:</strong> {lastProvisioned.temporaryPassword}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        style={{ marginTop: '10px', fontSize: '12px' }}
                        onClick={() => {
                          const creds = `Store: ${lastProvisioned.name}\nPOS URL: ${window.location.origin}/?tenant=${lastProvisioned.id}\nUsername: ${lastProvisioned.staffUsername}\nPassword: ${lastProvisioned.temporaryPassword}`;
                          navigator.clipboard.writeText(creds);
                          showToast('📋 Login credentials copied to clipboard!', 'success');
                        }}
                      >
                        📋 Copy Login Credentials
                      </button>
                    </div>

                    {/* Copyable URLs Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                      <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>🖥️ Cashier / Staff POS URL</div>
                        <div style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', margin: '4px 0 8px' }}>
                          {window.location.origin}/?tenant={lastProvisioned.id}
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/?tenant=${lastProvisioned.id}`);
                            showToast('📋 POS Link copied to clipboard!', 'success');
                          }}
                        >
                          📋 Copy POS URL
                        </button>
                      </div>

                      <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>📱 Customer Web App URL</div>
                        <div style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', margin: '4px 0 8px' }}>
                          {window.location.origin}/customer/?tenant={lastProvisioned.id}
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/customer/?tenant=${lastProvisioned.id}`);
                            showToast('📋 Customer Web Link copied!', 'success');
                          }}
                        >
                          📋 Copy Customer URL
                        </button>
                      </div>

                      <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>🛵 Driver Dispatch App URL</div>
                        <div style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', margin: '4px 0 8px' }}>
                          {window.location.origin}/driver-app/?tenant={lastProvisioned.id}
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/driver-app/?tenant=${lastProvisioned.id}`);
                            showToast('📋 Driver App Link copied!', 'success');
                          }}
                        >
                          📋 Copy Driver URL
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Provisioned Tenant Stores List Table */}
                <div className="card glass" style={{ padding: '20px', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>🏢 Active SaaS Tenant Stores ({tenantsList.length})</h3>
                    <button className="btn btn-sm btn-outline" onClick={fetchTenants} disabled={loadingTenants}>
                      🔄 {loadingTenants ? 'Refreshing...' : 'Refresh Stores'}
                    </button>
                  </div>

                  {tenantsList.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No custom tenant stores provisioned yet. Use the form above to provision your first store!
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                        <thead>
                          <tr>
                            <th>Store Name</th>
                            <th>Subdomain Slug</th>
                            <th>Owner Contact</th>
                            <th>Plan</th>
                            <th>Status</th>
                            <th>Actions & Copy Links</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tenantsList.map(t => (
                            <tr key={t.id}>
                              <td style={{ fontWeight: 700 }}>{t.name}</td>
                              <td style={{ fontFamily: 'monospace' }}>{t.subdomain}</td>
                              <td>{t.ownerEmail}</td>
                              <td><span className="badge badge-info">{t.plan?.toUpperCase() || 'PRO'}</span></td>
                              <td>
                                <span className={`badge ${t.status === 'suspended' ? 'badge-danger' : 'badge-success'}`}>
                                  {t.status?.toUpperCase() || 'ACTIVE'}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  <button
                                    className="btn btn-sm btn-outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(`${window.location.origin}/?tenant=${t.id}`);
                                      showToast(`📋 POS Link for ${t.name} copied!`, 'success');
                                    }}
                                  >
                                    📋 POS Link
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(`${window.location.origin}/customer/?tenant=${t.id}`);
                                      showToast(`📋 Customer App Link for ${t.name} copied!`, 'success');
                                    }}
                                  >
                                    📋 Customer Link
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(`${window.location.origin}/driver-app/?tenant=${t.id}`);
                                      showToast(`📋 Driver App Link for ${t.name} copied!`, 'success');
                                    }}
                                  >
                                    📋 Driver Link
                                  </button>
                                  <a
                                    href={`${window.location.origin}/?tenant=${t.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-sm btn-primary"
                                    style={{ textDecoration: 'none' }}
                                  >
                                    🔗 Open Store
                                  </a>
                                  {t.id !== 'default_tenant' && (
                                    <>
                                      <button
                                        type="button"
                                        className={`btn btn-sm ${t.status === 'suspended' ? 'btn-success' : 'btn-outline'}`}
                                        style={{ color: t.status === 'suspended' ? '#fff' : '#f59e0b', borderColor: '#f59e0b' }}
                                        onClick={() => handleToggleStatus(t)}
                                      >
                                        {t.status === 'suspended' ? '▶️ Activate' : '⏸️ Suspend'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-danger"
                                        onClick={() => handleDeleteTenant(t)}
                                      >
                                        🗑️ Delete Store
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        </div>
      </div>

      {/* 4. MODALS */}

      {/* 4a. Menu Item Add/Edit Modal */}
      {showItemModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>{editItem ? '✏️ Edit Menu Item' : '➕ Add New Menu Item'}</h2>
              <button className="modal-close" onClick={() => setShowItemModal(false)}>×</button>
            </div>

            <form onSubmit={handleSaveItem}>

              {/* ── IMAGE SECTION ── */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', display: 'block' }}>📷 Food Photo</label>

                {/* Image Preview */}
                {itemImagePreview && (
                  <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                    <img
                      src={itemImagePreview}
                      alt="Preview"
                      style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', borderRadius: '10px', border: '2px solid var(--border-color)' }}
                      onError={() => setItemImagePreview('')}
                    />
                  </div>
                )}

                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <button type="button"
                    onClick={() => setImageUploadMode('file')}
                    style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                      background: imageUploadMode === 'file' ? 'var(--color-primary)' : 'var(--bg-card)', color: imageUploadMode === 'file' ? '#fff' : 'var(--text-main)' }}>
                    📁 Upload from Device
                  </button>
                  <button type="button"
                    onClick={() => setImageUploadMode('url')}
                    style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                      background: imageUploadMode === 'url' ? 'var(--color-primary)' : 'var(--bg-card)', color: imageUploadMode === 'url' ? '#fff' : 'var(--text-main)' }}>
                    🔗 Paste Image URL
                  </button>
                </div>

                {imageUploadMode === 'file' ? (
                  <input
                    type="file"
                    accept="image/*"
                    className="form-input"
                    onChange={handleImageFileChange}
                    style={{ padding: '8px' }}
                  />
                ) : (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="https://example.com/rice-curry.jpg"
                    value={itemImageUrl}
                    onChange={(e) => {
                      setItemImageUrl(e.target.value);
                      setItemImagePreview(e.target.value);
                    }}
                  />
                )}
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>Max 2MB. JPG, PNG, WebP supported. Image saves directly to database.</p>
              </div>

              {/* ── BASIC INFO ── */}
              <div className="form-row">
                <div className="form-group">
                  <label>Dish Name *</label>
                  <input type="text" className="form-input"
                    placeholder="e.g. Chicken Rice & Curry"
                    value={itemName} onChange={(e) => setItemName(e.target.value)} required />
                </div>
                <div className="form-group" style={{ maxWidth: '80px' }}>
                  <label>Emoji / Icon</label>
                  <input type="text" className="form-input"
                    placeholder="🍛"
                    value={itemEmoji} onChange={(e) => setItemEmoji(e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  <select className="form-select" value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} required>
                    {categories.length === 0 ? (
                      <option value="">⚠️ No Categories Found (Click Add Category)</option>
                    ) : (
                      categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                      ))
                    )}
                  </select>
                  {categories.length === 0 && (
                    <div style={{ marginTop: '6px', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '12px' }}>
                      ⚠️ No menu categories exist yet.{' '}
                      <button type="button" onClick={() => { setShowItemModal(false); handleOpenCatAdd(); }} style={{ color: '#ef4444', fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Click here to create a category first
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Portion Size</label>
                  <select className="form-select" value={itemPortionSize} onChange={(e) => setItemPortionSize(e.target.value)}>
                    <option value="Small">🍽️ Small</option>
                    <option value="Regular">🍽️ Regular</option>
                    <option value="Large">🍽️ Large</option>
                    <option value="Family">👨‍👩‍👧‍👦 Family Pack</option>
                    <option value="Half">½ Half Portion</option>
                    <option value="Full">🍱 Full Portion</option>
                  </select>
                </div>
              </div>

              {/* ── PRICING ── */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', display: 'block' }}>💰 Pricing (LKR)</label>
                <div className="form-row">
                  <div className="form-group">
                    <label>Selling Price (LKR) *</label>
                    <input type="number" step="0.01" className="form-input"
                      placeholder="0.00" value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Ingredients Cost (LKR)</label>
                    <input type="number" step="0.01" className="form-input"
                      placeholder="0.00" value={itemCost}
                      onChange={(e) => setItemCost(e.target.value)} />
                  </div>
                  {itemPrice && itemCost && parseFloat(itemCost) > 0 && (
                    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <label>Profit Margin</label>
                      <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--color-success-light)', color: 'var(--color-success)', fontWeight: 700, textAlign: 'center' }}>
                        {Math.round(((parseFloat(itemPrice) - parseFloat(itemCost)) / parseFloat(itemPrice)) * 100)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── STOCK ── */}
              <div className="form-row">
                <div className="form-group">
                  <label>Stock Available</label>
                  <input type="number" className="form-input" placeholder="50"
                    value={itemStock} onChange={(e) => setItemStock(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Low Stock Warning Below</label>
                  <input type="number" className="form-input" placeholder="10"
                    value={itemMinStock} onChange={(e) => setItemMinStock(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>⏱️ Prep Time (mins)</label>
                  <input type="number" className="form-input" placeholder="15"
                    value={itemPrepTime} onChange={(e) => setItemPrepTime(e.target.value)} />
                </div>
              </div>

              {/* ── DESCRIPTION ── */}
              <div className="form-group">
                <label>Dish Description</label>
                <textarea className="form-textarea" rows={2}
                  placeholder="e.g. Fragrant basmati rice served with our special dhal curry, coconut sambol and papadam."
                  value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} />
              </div>

              {/* ── SPICE LEVEL ── */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', display: 'block' }}>🌶️ Spice Level</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {[0, 1, 2, 3, 4, 5].map((lvl) => (
                    <button key={lvl} type="button"
                      onClick={() => setItemSpiceLevel(lvl)}
                      style={{
                        padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                        fontWeight: 700, fontSize: '13px',
                        background: itemSpiceLevel === lvl ? '#ef4444' : 'var(--bg-card)',
                        color: itemSpiceLevel === lvl ? '#fff' : 'var(--text-main)',
                        transform: itemSpiceLevel === lvl ? 'scale(1.1)' : 'scale(1)',
                        transition: 'all 0.15s'
                      }}>
                      {lvl === 0 ? '❄️ None' : '🌶️'.repeat(lvl)}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>0 = Not spicy &nbsp;|&nbsp; 5 = Extra hot 🔥</p>
              </div>

              {/* ── DIETARY TAGS ── */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', display: 'block' }}>🏷️ Dietary Tags <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(click to toggle)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  {SL_DIETARY_TAGS.map((tag) => (
                    <button key={tag.value} type="button"
                      onClick={() => toggleDietaryTag(tag.value)}
                      style={{
                        padding: '6px 12px', borderRadius: '20px', border: '2px solid',
                        borderColor: isDietaryTagActive(tag.value) ? 'var(--color-primary)' : 'var(--border-color)',
                        background: isDietaryTagActive(tag.value) ? 'var(--color-primary)' : 'transparent',
                        color: isDietaryTagActive(tag.value) ? '#fff' : 'var(--text-main)',
                        cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                        transition: 'all 0.15s'
                      }}>
                      {tag.label}
                    </button>
                  ))}
                </div>
                <input type="text" className="form-input"
                  placeholder="Or type custom tags: halal, vegetarian, spicy..."
                  value={itemDietaryTags}
                  onChange={(e) => setItemDietaryTags(e.target.value)} />
              </div>

              {/* ── HALAL BADGE ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', padding: '12px 16px', borderRadius: '10px', background: itemIsHalal ? 'rgba(16,185,129,0.1)' : 'var(--bg-surface)', border: `2px solid ${itemIsHalal ? '#10b981' : 'var(--border-color)'}`, transition: 'all 0.2s' }}>
                <input type="checkbox" id="halal-toggle"
                  checked={itemIsHalal}
                  onChange={(e) => {
                    setItemIsHalal(e.target.checked);
                    if (e.target.checked) {
                      const current = itemDietaryTags ? itemDietaryTags.split(',').map(t => t.trim()).filter(Boolean) : [];
                      if (!current.includes('halal')) setItemDietaryTags([...current, 'halal'].join(', '));
                    }
                  }}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }} />
                <label htmlFor="halal-toggle" style={{ margin: 0, cursor: 'pointer', fontWeight: 700, fontSize: '15px' }}>
                  ☪️ This item is <span style={{ color: '#10b981' }}>Halal Certified</span>
                </label>
                {itemIsHalal && <span style={{ marginLeft: 'auto', background: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700 }}>✓ HALAL</span>}
              </div>

              {/* ── ALLERGENS ── */}
              <div className="form-group">
                <label>⚠️ Allergen Warnings (comma-separated)</label>
                <input type="text" className="form-input"
                  placeholder="e.g. peanuts, dairy, gluten, shellfish"
                  value={itemAllergens} onChange={(e) => setItemAllergens(e.target.value)} />
              </div>

              {/* ── AVAILABILITY ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                <input type="checkbox" id="item-isAvailable-checkbox"
                  checked={itemIsAvailable}
                  onChange={(e) => setItemIsAvailable(e.target.checked)}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }} />
                <label htmlFor="item-isAvailable-checkbox" style={{ margin: 0, cursor: 'pointer', fontWeight: 700 }}>
                  ✅ Item is Available for Sale <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(POS + Customer App)</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                {editItem ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: '#ef444415', color: '#ef4444', border: '1px solid #ef444440', fontWeight: 700, padding: '8px 16px' }}
                    onClick={async () => {
                      if (confirm(`🗑️ Are you sure you want to delete "${editItem.name}" from the database?`)) {
                        try {
                          await deleteMenuItem(editItem.id);
                          showToast(`🗑️ "${editItem.name}" deleted from database.`, 'info');
                          setShowItemModal(false);
                        } catch (err) {
                          showToast('Error deleting item: ' + err.message, 'error');
                        }
                      }
                    }}
                  >
                    🗑️ Delete Item
                  </button>
                ) : <div />}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowItemModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" style={{ minWidth: '160px' }}>💾 Save to Database</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4b. Category Add Modal */}
      {showCatModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>{editCat ? '✏️ Edit Menu Category' : '➕ Add Menu Category'}</h2>
              <button className="modal-close" onClick={() => setShowCatModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSaveCat}>
              {/* Quick Sri Lanka Category Presets */}
              <div style={{ marginBottom: '16px', background: 'var(--bg-surface)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                  🇱🇰 Quick Category Presets (Click to Auto-fill)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                  {SL_DEFAULT_CATEGORIES.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
                        setCatName(preset.name);
                        setCatEmoji(preset.emoji);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '20px',
                        border: '1px solid var(--border-color)',
                        background: catName === preset.name ? 'var(--color-primary)' : 'var(--bg-card)',
                        color: catName === preset.name ? '#fff' : 'var(--text-main)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        transition: 'all 0.15s'
                      }}
                    >
                      {preset.emoji} {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Kottu & Roti"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ maxWidth: '100px' }}>
                  <label>Emoji Icon</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 🍜"
                    value={catEmoji}
                    onChange={(e) => setCatEmoji(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                {editCat ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: '#ef444415', color: '#ef4444', border: '1px solid #ef444440', fontWeight: 700, padding: '8px 16px' }}
                    onClick={async () => {
                      if (confirm(`🗑️ Are you sure you want to delete category "${editCat.name}"?`)) {
                        try {
                          await deleteCategory(editCat.id);
                          showToast(`🗑️ Category "${editCat.name}" deleted.`, 'info');
                          setShowCatModal(false);
                        } catch (err) {
                          showToast('Error deleting category: ' + err.message, 'error');
                        }
                      }
                    }}
                  >
                    🗑️ Delete Category
                  </button>
                ) : <div />}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCatModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    💾 Save Category
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function UserManagementSection() {
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('cashier');
  const [pin, setPin] = useState('1234');
  const [password, setPassword] = useState('123456');

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUsersList(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!username || !role) return showToast('Please enter username and role.', 'warning');
    try {
      setLoading(true);
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, role, pin, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`User ${username} created successfully!`, 'success');
      setUsername('');
      fetchUsers();
    } catch (err) {
      showToast('Error creating user: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete staff account ${name}?`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete user');
      showToast(`User ${name} deleted.`, 'info');
      fetchUsers();
    } catch (err) {
      showToast('Error deleting user: ' + err.message, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <form onSubmit={handleCreateUser} style={{ background: 'var(--bg-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', alignItems: 'end' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700 }}>Username</label>
          <input className="form-input" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. cashier_john" required />
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700 }}>Role</label>
          <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
            <option value="owner">Owner (Full Admin Access)</option>
            <option value="manager">Manager (Reports & Inventory)</option>
            <option value="cashier">Cashier (POS & Checkout)</option>
            <option value="kitchen">Kitchen Staff (KDS Only)</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700 }}>4-Digit Quick PIN</label>
          <input className="form-input" type="text" maxLength={4} value={pin} onChange={e => setPin(e.target.value)} placeholder="1234" required />
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700 }}>Password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" required />
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', padding: '10px' }}>
            ➕ Create Staff User
          </button>
        </div>
      </form>

      <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: 'var(--bg-card)', textTransform: 'uppercase', fontSize: '11px', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Username</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Role</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>PIN</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersList.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>👤 {u.username}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className="badge badge-primary" style={{ textTransform: 'capitalize' }}>{u.role}</span>
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>🔑 {u.pin || '----'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button className="btn btn-danger" onClick={() => handleDeleteUser(u.id, u.username)} style={{ padding: '4px 10px', fontSize: '12px' }}>
                    🗑️ Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
