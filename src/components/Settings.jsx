import React, { useState, useEffect } from 'react';
import { usePOS } from '../context/POSContext';

export default function Settings() {
  const {
    settings,
    updateSetting,
    menuItems,
    saveMenuItem,
    deleteMenuItem,
    categories,
    saveCategory,
    deleteCategory,
    exportDatabase,
    importDatabase,
    resetAllDatabase,
    showToast,
  } = usePOS();

  // Settings sub-tab selection: 'business' | 'menu' | 'database'
  const [subTab, setSubTab] = useState('business');

  // Business config states
  const [bizName, setBizName] = useState(settings.businessName || '');
  const [currency, setCurrency] = useState(settings.currencySymbol || '');
  const [tax, setTax] = useState(settings.taxRate || '');
  const [serviceCharge, setServiceCharge] = useState(settings.serviceChargeRate || '');
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');

  // Menu item modal states
  const [showItemModal, setShowItemModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCost, setItemCost] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemEmoji, setItemEmoji] = useState('🍕');
  const [itemStock, setItemStock] = useState('50');
  const [itemDesc, setItemDesc] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [itemDietaryTags, setItemDietaryTags] = useState('');
  const [itemAllergens, setItemAllergens] = useState('');
  const [itemIsAvailable, setItemIsAvailable] = useState(true);

  // Category modal states
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [catName, setCatName] = useState('');
  const [catEmoji, setCatEmoji] = useState('🍕');

  // Database tool file reader state
  const [importFile, setImportFile] = useState(null);

  const handleSaveBusiness = async (e) => {
    e.preventDefault();
    await updateSetting('businessName', bizName);
    await updateSetting('currencySymbol', currency);
    await updateSetting('taxRate', parseFloat(tax) || 0);
    await updateSetting('serviceChargeRate', parseFloat(serviceCharge) || 0);
    await updateSetting('address', address);
    await updateSetting('phone', phone);
    showToast('Business settings saved successfully!', 'success');
  };

  const handleOpenItemAdd = () => {
    setEditItem(null);
    setItemName('');
    setItemPrice('');
    setItemCost('');
    setItemCategory(categories[0]?.id || '');
    setItemEmoji('🍕');
    setItemStock('50');
    setItemMinStock('10');
    setItemDesc('');
    setItemImageUrl('');
    setItemDietaryTags('');
    setItemAllergens('');
    setItemIsAvailable(true);
    setShowItemModal(true);
  };

  const handleOpenItemEdit = (item) => {
    setEditItem(item);
    setItemName(item.name);
    setItemPrice(item.price.toString());
    setItemCost(item.cost ? item.cost.toString() : '');
    setItemCategory(item.category);
    setItemEmoji(item.emoji || '🍕');
    setItemStock(item.stock.toString());
    setItemMinStock(item.minStock.toString());
    setItemDesc(item.description || '');
    setItemImageUrl(item.imageUrl || '');
    setItemDietaryTags(item.dietaryTags || '');
    setItemAllergens(item.allergens || '');
    setItemIsAvailable(item.isAvailable !== 0);
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
      isAvailable: itemIsAvailable ? 1 : 0
    };

    await saveMenuItem(saved);
    setShowItemModal(false);
  };

  const handleDeleteItemClick = async (itemId) => {
    if (confirm('Are you sure you want to delete this menu item?')) {
      await deleteMenuItem(itemId);
    }
  };

  const handleOpenCatAdd = () => {
    setEditCat(null);
    setCatName('');
    setCatEmoji('🍕');
    setShowCatModal(true);
  };

  const handleSaveCat = async (e) => {
    e.preventDefault();
    if (!catName) return;

    const saved = {
      id: editCat ? editCat.id : `cat_${catName.toLowerCase().replace(/\s+/g, '_')}`,
      name: catName,
      emoji: catEmoji,
    };

    await saveCategory(saved);
    setShowCatModal(false);
  };

  const handleDeleteCatClick = async (catId) => {
    if (confirm('Are you sure you want to delete this category? Items in this category might become unclassified.')) {
      await deleteCategory(catId);
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
            <button
              className={`settings-nav-btn ${subTab === 'saas' ? 'active' : ''}`}
              onClick={() => setSubTab('saas')}
            >
              ☁️ SaaS Multi-Tenancy
            </button>
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

                  <div className="form-group">
                    <label>Restaurant Address (Printed on Receipts)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Contact Phone Number</label>
                    <input
                      type="text"
                      className="form-input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: '16px' }}>
                    Save Business Profile
                  </button>
                </form>
              </div>
            )}

            {/* 2. Menu and Categories CRUD Settings */}
            {subTab === 'menu' && (
              <div>
                <h2 className="settings-section-title">Menu Setup</h2>
                
                {/* Categories block */}
                <div style={{ marginBottom: '40px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '700' }}>Menu Categories</h3>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleOpenCatAdd}>
                      ＋ Add Category
                    </button>
                  </div>

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
                        <span>{cat.emoji}</span>
                        <span>{cat.name}</span>
                        <button
                          style={{ color: 'var(--color-danger)', marginLeft: '8px', fontSize: '16px', fontWeight: 'bold' }}
                          onClick={() => handleDeleteCatClick(cat.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Menu items block */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '700' }}>Dish & Drink Menu</h3>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleOpenItemAdd}>
                      ＋ Add New Dish
                    </button>
                  </div>

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
                            <td>${item.price.toFixed(2)}</td>
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
                          alert(`Store status updated! Closed: ${nextVal === 'false'}`);
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
                              alert(`📍 Store location set to ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
                            }, () => alert('Could not detect location. Please enter manually.'));
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
                          alert(next === 'true' ? '🌧️ Rainy Weather Mode ACTIVATED — rain surcharge will apply to all deliveries.' : '☀️ Rainy Weather Mode OFF — normal delivery pricing.');
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
                          alert(`Dispatch mode set to: ${opt.label}`);
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

                <div className="card glass" style={{ padding: '20px', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>Provision New SaaS Tenant Subdomain</h3>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.target;
                    const tenant = {
                      id: `t_${Date.now()}`,
                      name: form.tenantName.value,
                      subdomain: form.subdomain.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      ownerEmail: form.ownerEmail.value,
                      plan: form.plan.value
                    };
                    try {
                      const res = await fetch('/api/saas/tenants', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(tenant)
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Failed to provision tenant.');
                      alert(`🎉 SaaS Tenant "${tenant.name}" provisioned at ${tenant.subdomain}.gastroflow.lk!`);
                      form.reset();
                    } catch (err) {
                      alert('Provisioning error: ' + err.message);
                    }
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Restaurant Tenant Name</label>
                        <input name="tenantName" type="text" className="form-input" placeholder="e.g. Cinnamon Grill Colombo" required />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 600 }}>Subdomain Slug</label>
                        <input name="subdomain" type="text" className="form-input" placeholder="e.g. cinnamongrill" required />
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
                          <option value="pro">Pro ($49/mo)</option>
                          <option value="enterprise">Enterprise ($149/mo)</option>
                          <option value="basic">Basic ($29/mo)</option>
                        </select>
                      </div>
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ padding: '10px 20px', fontSize: '14px' }}>
                      🚀 Provision Tenant Instance
                    </button>
                  </form>
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
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>{editItem ? 'Edit Menu Dish' : 'Add New Menu Dish'}</h2>
              <button className="modal-close" onClick={() => setShowItemModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSaveItem}>
              <div className="form-row">
                <div className="form-group">
                  <label>Dish Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Pepperoni Pizza"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Dish Emoji / Icon</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 🍕"
                    value={itemEmoji}
                    onChange={(e) => setItemEmoji(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="form-select"
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value)}
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Selling Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="0.00"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Ingredients Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="0.00"
                    value={itemCost}
                    onChange={(e) => setItemCost(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Initial Stock Level</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="50"
                    value={itemStock}
                    onChange={(e) => setItemStock(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Minimum Stock Threshold (For warnings)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="10"
                  value={itemMinStock}
                  onChange={(e) => setItemMinStock(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Dish Description</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="Describe ingredients, allergens..."
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                />
              </div>

              <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Image URL</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="https://example.com/pizza.jpg"
                    value={itemImageUrl}
                    onChange={(e) => setItemImageUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Dietary Tags (comma-separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. veg, spicy, gf"
                    value={itemDietaryTags}
                    onChange={(e) => setItemDietaryTags(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Allergen Warnings (comma-separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. peanuts, dairy, gluten"
                    value={itemAllergens}
                    onChange={(e) => setItemAllergens(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <input
                  type="checkbox"
                  id="item-isAvailable-checkbox"
                  checked={itemIsAvailable}
                  onChange={(e) => setItemIsAvailable(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <label htmlFor="item-isAvailable-checkbox" style={{ margin: 0, cursor: 'pointer', fontWeight: 600 }}>Item is Available for Sale (POS & Online)</label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowItemModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Dish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4b. Category Add Modal */}
      {showCatModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Add Menu Category</h2>
              <button className="modal-close" onClick={() => setShowCatModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSaveCat}>
              <div className="form-group">
                <label>Category Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Appetizers"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Category Emoji Icon</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 🍟"
                  value={catEmoji}
                  onChange={(e) => setCatEmoji(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCatModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Category
                </button>
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
    if (!username || !role) return alert('Please enter username and role.');
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
      alert(`User ${username} created successfully!`);
      setUsername('');
      fetchUsers();
    } catch (err) {
      alert('Error creating user: ' + err.message);
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
      alert(`User ${name} deleted.`);
      fetchUsers();
    } catch (err) {
      alert('Error deleting user: ' + err.message);
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
