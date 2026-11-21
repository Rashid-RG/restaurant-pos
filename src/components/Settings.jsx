import { coordinatePair, restaurantPickupPin } from '../../lib/delivery/geo-distance.js';
import SubscriptionBilling from './SubscriptionBilling';
import React, { useState, useEffect } from 'react';
import PlatformAdmin from './PlatformAdmin';
import { usePOS } from '../context/POSContext';
import { testPrintReceipt } from '../utils/printer';
import SmartReceiptDesigner from './SmartReceiptDesigner.jsx';
import './receipt-workspace.css';
import { getNativePrinterConfig, saveNativePrinterConfig, listNativePrinters, nativePrintTestSlip } from '../utils/native-printer';
import { restaurantTimeZone, validTimeZone } from '../utils/restaurant-time';

const SETTINGS_SECTIONS = [
  { id: 'business', icon: '🏢', label: 'Business Info', detail: 'Restaurant identity, contact information, branding, taxes and timezone.', group: 'Restaurant' },
  { id: 'printer', icon: '🧾', label: 'Printer & Receipts', detail: 'Paper Saver, customer bill design, printer settings and cash drawer.', group: 'Operations' },
  { id: 'menu', icon: '🍽️', label: 'Menu & Categories', detail: 'Organize categories, dish images, pricing and availability.', group: 'Operations' },
  { id: 'users', icon: '👥', label: 'Staff & Users', detail: 'Manage accounts, roles, access and POS PINs.', group: 'People' },
  { id: 'online', icon: '🛍️', label: 'Online Store', detail: 'Store availability, delivery settings and customer ordering.', group: 'Operations' },
  { id: 'database', icon: '🛡️', label: 'Database & Backup', detail: 'Database administration, backup and recovery controls.', group: 'Administration' },
  { id: 'billing', icon: '💳', label: 'Plan and Billing', detail: 'Subscription plan and restaurant billing.', group: 'Administration', ownerOnly: true },
  { id: 'saas', icon: '🗂️', label: 'Platform Administration', detail: 'Platform-wide administration for authorized operators.', group: 'Administration', platformOnly: true }
];

const COMMON_TIME_ZONES = ['Asia/Colombo', 'Asia/Qatar', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
const TIME_ZONE_OPTIONS = [...new Set([...COMMON_TIME_ZONES, ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort();

function PickupPinEditor({ settings, savePickupPin }) {
  const saved = restaurantPickupPin(settings);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const point = draft ?? { lat: saved?.lat ?? '', lng: saved?.lng ?? '' };
  const pin = coordinatePair(point.lat, point.lng);

  function locate() {
    if (!navigator.geolocation) {
      setMessage('GPS is unavailable. Enter the coordinates of the pickup entrance.');
      return;
    }
    setBusy(true);
    setMessage('Finding your current location…');
    navigator.geolocation.getCurrentPosition(position => {
      setDraft({ lat: position.coords.latitude.toFixed(6), lng: position.coords.longitude.toFixed(6) });
      setMessage('GPS accuracy about ' + Math.round(position.coords.accuracy) + ' m. Check the entrance before saving.');
      setBusy(false);
    }, () => {
      setMessage('GPS could not locate the shop. Enter its entrance coordinates manually.');
      setBusy(false);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }

  async function save() {
    if (!pin || busy) return;
    setBusy(true);
    try {
      await savePickupPin(pin);
      setDraft(null);
      setMessage('Pickup entrance saved.');
    } catch (error) {
      setMessage(error.message || 'Could not save the pickup entrance. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ padding: 16, border: '1px solid var(--border-color)', borderRadius: 12 }}>
    <h4>Restaurant pickup entrance</h4>
    <p>{saved ? 'Saved pin: ' + saved.lat + ', ' + saved.lng : 'Save the pickup entrance to enable delivery distance checks.'}</p>
    <p>Use GPS while standing at the pickup entrance, or enter its coordinates.</p>
    <div style={{ display: 'flex', gap: 8 }}>
      {['lat','lng'].map(axis => <label key={axis}>{axis === 'lat' ? 'Latitude' : 'Longitude'}
        <input type="number" step="any" className="form-input" disabled={busy} value={point[axis]}
          onChange={event => { setDraft({ ...point, [axis]: event.target.value }); setMessage(''); }} />
      </label>)}
    </div>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={locate}>Use GPS at the shop</button>
    <button type="button" className="btn btn-primary" disabled={busy || !draft || !pin} onClick={save}>Confirm and save entrance</button>
    <p role="status">{message || (draft && !pin ? 'Enter a valid latitude and longitude.' : '')}</p>
  </div>;
}

export default function Settings({ initialSubTab = null } = {}) {
  const {
    currentUser,
    setActiveTab,
    settings,
    updateSetting,
    savePickupPin,
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
    resetStoreTestData,
    showToast,
  } = usePOS();

  const isMasterSuperAdmin = currentUser?.isPlatformAdmin === true;
  const availableSettingsSections = SETTINGS_SECTIONS.filter(section =>
    (!section.ownerOnly || currentUser?.role === 'owner') &&
    (!section.platformOnly || isMasterSuperAdmin)
  );

  // Direct printing is deliberately opt-in and stored per computer + tenant,
  // not in the restaurant-wide settings or in Turso.
  const nativeTenantId = currentUser?.tenant_id || currentUser?.tenantId || '';
  const [nativeConfig, setNativeConfig] = useState(() => getNativePrinterConfig(nativeTenantId));
  const [nativePrinters, setNativePrinters] = useState([]);
  const [nativePrinterName, setNativePrinterName] = useState(() => getNativePrinterConfig(nativeTenantId).printerName);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeStatus, setNativeStatus] = useState('');
  const [nativeTested, setNativeTested] = useState(false);
  const [printerWorkspaceView, setPrinterWorkspaceView] = useState('design');
  const onFeedLinesChange = (feedLines) => {
    try {
      const next = saveNativePrinterConfig(nativeTenantId, { ...nativeConfig, enabled: false, printerName: nativePrinterName, feedLines });
      setNativeConfig(next);
      setNativeTested(false);
      setNativeStatus('Feed setting saved for this workstation. Send a new test slip before using direct printing.');
    } catch (error) { showToast(error.message || 'Could not save feed setting.', 'error'); }
  };
  const discoverNativePrinters = async () => {
    setNativeBusy(true);
    setNativeStatus('Connecting to QZ Tray on this computer...');
    try {
      const found = await listNativePrinters();
      setNativePrinters(found);
      setNativeStatus(found.length ? found.length + ' local Windows printer(s) found.' : 'No printers were found. Check QZ Tray and Windows.');
      if (found.includes(nativePrinterName)) setNativeTested(false);
    } catch (error) {
      setNativeStatus(error.message || 'Unable to connect to QZ Tray.');
      showToast(error.message || 'QZ Tray is not running.', 'error');
    } finally { setNativeBusy(false); }
  };
  const testNativePrinter = async () => {
    if (!nativePrinters.includes(nativePrinterName)) return;
    setNativeBusy(true);
    setNativeStatus('Sending one short native test slip...');
    try {
      await nativePrintTestSlip(nativePrinterName, settings?.printerPaperWidth === '58mm' ? '58mm' : '80mm', true, nativeConfig.feedLines);
      setNativeTested(true);
      setNativeStatus('Test slip sent. Confirm the slip printed and cut correctly before enabling.');
    } catch (error) {
      setNativeTested(false);
      setNativeStatus(error.message || 'Native print test failed.');
      showToast(error.message || 'Native test failed. Browser receipts remain available.', 'error');
    } finally { setNativeBusy(false); }
  };
  const toggleNativePrinter = (enabled) => {
    if (enabled && (!nativePrinters.includes(nativePrinterName) || !nativeTested)) {
      showToast('Connect QZ Tray, choose the correct printer and send a test slip before enabling.', 'warning');
      return;
    }
    try {
      const next = saveNativePrinterConfig(nativeTenantId, { enabled, printerName: nativePrinterName, cut: true, feedLines: nativeConfig.feedLines });
      setNativeConfig(next);
      setNativeStatus(enabled ? 'Direct printing enabled for this computer only. Browser print is still available as a fallback.' : 'Direct printing disabled. Existing browser printing restored.');
    } catch (error) { showToast(error.message, 'error'); }
  };


  // Settings sub-tab selection: 'business' | 'menu' | 'database'
  const [subTab, setSubTab] = useState(()=>{
    const requested=sessionStorage.getItem('gastroflow_settings_tab');
    sessionStorage.removeItem('gastroflow_settings_tab');
    const allowed = ['online','business','printer','menu','database','users','billing','saas'];
    return allowed.includes(initialSubTab) ? initialSubTab : (allowed.includes(requested) ? requested : 'home');
  });

  // Business config states
  const [bizName, setBizName] = useState(settings.businessName || settings.restaurantName || '');
  const [currency, setCurrency] = useState(settings.currencySymbol || 'Rs.');
  const [timeZone, setTimeZone] = useState(restaurantTimeZone(settings));
  const [tax, setTax] = useState(settings.taxRate ?? '0');
  const [serviceCharge, setServiceCharge] = useState(settings.serviceChargeRate ?? '0');
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || settings.logo || settings.restaurantLogo || '');

  // Only initialize form fields once from settings when they first load,
  // preventing periodic 8s background syncs from resetting what the user is currently typing.
  const initializedRef = React.useRef(false);
  useEffect(() => {
    if (!initializedRef.current && Object.keys(settings || {}).length > 0) {
      setBizName(settings.businessName || settings.restaurantName || '');
      setCurrency(settings.currencySymbol || 'Rs.');
      setTimeZone(restaurantTimeZone(settings));
      setTax(settings.taxRate ?? '0');
      setServiceCharge(settings.serviceChargeRate ?? '0');
      setAddress(settings.address || '');
      setPhone(settings.phone || '');
      setLogoUrl(settings.logoUrl || settings.logo || settings.restaurantLogo || '');
      initializedRef.current = true;
    }
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

  // Curated High-Definition Food Photography Preset Library
  const PRESET_FOOD_PHOTOS = [
    { name: 'Rice & Curry', emoji: '🍛', url: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=600&auto=format&fit=crop&q=80' },
    { name: 'Biriyani', emoji: '🍗', url: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80' },
    { name: 'Kottu Roti', emoji: '🍜', url: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80' },
    { name: 'BBQ & Grill', emoji: '🍖', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80' },
    { name: 'Crispy Chicken', emoji: '🍗', url: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=600&auto=format&fit=crop&q=80' },
    { name: 'Burger', emoji: '🍔', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80' },
    { name: 'Pizza', emoji: '🍕', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80' },
    { name: 'Seafood Fish', emoji: '🐟', url: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=600&auto=format&fit=crop&q=80' },
    { name: 'Short Eats', emoji: '🥐', url: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=600&auto=format&fit=crop&q=80' },
    { name: 'Dessert Cake', emoji: '🍰', url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80' },
    { name: 'Juice / Shake', emoji: '🥤', url: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=600&auto=format&fit=crop&q=80' },
    { name: 'Hot Coffee', emoji: '☕', url: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&auto=format&fit=crop&q=80' },
  ];

  const compressImage = (file, maxWidth = 800, quality = 0.82) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target.result;
      setItemImageUrl(dataUrl);
      setItemImagePreview(dataUrl);
      showToast('📷 Photo selected! Click Save Changes to apply.', 'success');

      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxWidth = 800;
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.85);
            if (compressed && compressed.length > 50) {
              setItemImageUrl(compressed);
              setItemImagePreview(compressed);
            }
          } catch (_) {}
        };
        img.src = dataUrl;
      } catch (_) {}
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

  const handleLogoFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const rawDataUrl = evt.target.result;
      setLogoUrl(rawDataUrl);
      showToast('📷 Shop logo selected! Click "Save & Update Profile" to apply.', 'success');

      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 400;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.85);
            if (compressed && compressed.length > 50) {
              setLogoUrl(compressed);
            }
          } catch (_) {}
        };
        img.src = rawDataUrl;
      } catch (_) {}
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBusiness = async (e) => {
    e.preventDefault();
    try {
      if (!validTimeZone(timeZone)) throw new Error('Select a valid restaurant time zone.');
      const payload = {
        timeZone,
        businessName: bizName,
        restaurantName: bizName,
        currencySymbol: currency,
        taxRate: parseFloat(tax) || 0,
        serviceChargeRate: parseFloat(serviceCharge) || 0,
        address: address,
        phone: phone,
        logoUrl: logoUrl,
        logo: logoUrl,
        restaurantLogo: logoUrl
      };
      
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save settings');
      }

      Object.entries(payload).forEach(([k, v]) => {
        updateSetting(k, v);
      });

      showToast('🎉 Business profile & shop logo updated successfully!', 'success');
    } catch (err) {
      showToast('Save error: ' + (err.message || 'Failed to save settings'), 'error');
    }
  };

  const handleClearStoreMenu = async () => {
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
    setImageUploadMode('file');
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
    setImageUploadMode('file');
    setShowItemModal(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!itemName || !itemPrice) return;

    const finalImage = itemImageUrl || itemImagePreview || editItem?.imageUrl || '';

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
      imageUrl: finalImage,
      dietaryTags: itemDietaryTags,
      allergens: itemAllergens,
      isAvailable: itemIsAvailable ? 1 : 0,
      spiceLevel: parseInt(itemSpiceLevel) || 0,
      isHalal: itemIsHalal ? 1 : 0,
      preparationTime: parseInt(itemPrepTime) || 0,
      portionSize: itemPortionSize,
    };

    await saveMenuItem(saved);
    showToast(`✅ "${itemName}" saved successfully with photo!`, 'success');
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

  const handleClearOrdersAndExpenses = async () => {
    if (confirm("⚠️ Clear all test sales orders and expenses?\n\nThis will reset Today's Gross Sales to Rs. 0.00 and clear all test receipts. Your menu items will NOT be deleted.")) {
      try {
        await resetStoreTestData({ wipeOrders: true, wipeExpenses: true, wipeMenu: false });
        showToast("✅ All test sales and expenses cleared! Gross sales reset to Rs. 0.00.", 'success');
      } catch (err) {
        showToast("❌ Failed to clear test sales: " + err.message, 'error');
      }
    }
  };

  const handleFullStoreReset = async () => {
    if (confirm("🚨 DANGER: Full Reset!\n\nThis will wipe all test orders, test sales history, daily expenses, AND all demo menu items for this restaurant so you can start completely from scratch.\n\nAre you sure you want to proceed?")) {
      try {
        await resetStoreTestData({ wipeOrders: true, wipeExpenses: true, wipeMenu: true });
        showToast("✅ Store completely reset to clean state! Ready for your real data.", 'success');
      } catch (err) {
        showToast("❌ Failed to reset store: " + err.message, 'error');
      }
    }
  };

  const handleResetClick = async () => {
    await handleFullStoreReset();
  };

  return (
    <div className="main-content system-settings-page">
      <div className="view-header">
        <div className="view-title">
          <span className="settings-eyebrow">RESTAURANT CONTROL CENTER</span>
          <h1>System Settings</h1>
          <p>Your restaurant, your workflow. Configure the essentials in one place.</p>
        </div>
      </div>

      <div className="view-body">
        <div className="settings-full-layout">
          {subTab === 'home' ? (
            <section className="settings-home" aria-label="Settings Home">
              <div className="settings-home-hero">
                <span className="settings-home-kicker">YOUR RESTAURANT · ONE CONTROL CENTER</span>
                <h2>What would you like to configure?</h2>
                <p>Select a category below. Each section opens in its own full-width workspace, without a second sidebar taking up screen space.</p>
              </div>
              {['Restaurant', 'Operations', 'People', 'Administration'].map(group => {
                const groupSections = availableSettingsSections.filter(section => section.group === group);
                return groupSections.length > 0 && (
                  <section key={group} className="settings-home-group" aria-label={group + ' settings'}>
                    <div className="settings-home-group-heading"><h3>{group}</h3><span>{groupSections.length} {groupSections.length === 1 ? 'section' : 'sections'}</span></div>
                    <div className="settings-home-grid">
                      {groupSections.map(section => (
                        <button key={section.id} type="button" className="settings-home-card"
                          onClick={() => setSubTab(section.id)} aria-label={'Open ' + section.label}>
                          <span className="settings-home-card-icon" aria-hidden="true">{section.icon}</span>
                          <span className="settings-home-card-copy">
                            <strong>{section.label}</strong><small>{section.detail}</small>
                          </span>
                          <span className="settings-home-card-arrow" aria-hidden="true">↗</span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </section>
          ) : (
            <>
              <nav className="settings-page-toolbar" aria-label="Settings breadcrumb">
                <div className="settings-page-breadcrumb">
                  <button type="button" className="settings-back-link" onClick={() => setSubTab('home')}>← Settings Home</button>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">{availableSettingsSections.find(section => section.id === subTab)?.label || 'Settings'}</span>
                </div>
                <label className="settings-jump-label" htmlFor="settings-page-jump">
                  Switch section
                  <select id="settings-page-jump" className="form-select" value={subTab}
                    onChange={event => setSubTab(event.target.value)}>
                    {availableSettingsSections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
                  </select>
                </label>
              </nav>
              <div className="settings-panel settings-full-panel">
            
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

                  <div className="form-group">
                    <label htmlFor="restaurant-time-zone">Restaurant Time Zone</label>
                    <select id="restaurant-time-zone" className="form-input" value={timeZone} onChange={e => setTimeZone(e.target.value)}>
                      {!TIME_ZONE_OPTIONS.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
                      {TIME_ZONE_OPTIONS.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
                    </select>
                    <small>Restaurant-local sales dates and report periods use this time zone. Existing transaction timestamps are not changed.</small>
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
                          onChange={handleLogoFileChange}
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
                              <td style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <img
                                  src={item.imageUrl || item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'}
                                  alt={item.name}
                                  style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--border-color)', flexShrink: 0 }}
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80';
                                  }}
                                />
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

                  {/* Danger Zone: Test Data & Reset Tools */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '2px dashed var(--border-color)', paddingTop: '20px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: 'var(--color-danger)' }}>
                      ⚠️ Restaurant Test Data & Reset Tools
                    </h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                      Prepare your restaurant for live production by clearing demo data, wiping test orders, or starting fresh from scratch.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginTop: '8px' }}>
                      {/* Card 1: Clear Sales Orders & Expenses */}
                      <div style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <h4 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            🧾 Clear Test Orders & Sales
                          </h4>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                            Wipes all test sales receipts, KOT tickets, and test daily expenses. Sets <strong>Today's Gross Sales back to Rs. 0.00</strong>. Your menu items and business info remain safe.
                          </p>
                        </div>
                        <button 
                          className="btn btn-outline" 
                          style={{ color: '#f59e0b', borderColor: '#f59e0b', fontWeight: 700, fontSize: '12px' }}
                          onClick={handleClearOrdersAndExpenses}
                        >
                          🧹 Clear Sales & Expenses (Reset to Rs. 0)
                        </button>
                      </div>

                      {/* Card 2: Clear All Menu Items */}
                      <div style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <h4 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            🍕 Delete All Menu Items
                          </h4>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                            Removes all demo dishes and drinks from the database ({menuItems.length} items currently). Gives you a blank menu so you can add your real dishes from scratch.
                          </p>
                        </div>
                        <button 
                          className="btn btn-outline" 
                          style={{ color: '#ef4444', borderColor: '#ef4444', fontWeight: 700, fontSize: '12px' }}
                          onClick={handleClearAllMenu}
                        >
                          🗑️ Delete All Menu Items ({menuItems.length})
                        </button>
                      </div>

                      {/* Card 3: Full Store Reset */}
                      <div style={{ padding: '18px', border: '1px solid #ef4444', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <h4 style={{ fontSize: '14px', fontWeight: '800', margin: '0 0 6px 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            🚨 Full Store Reset (Clean Slate)
                          </h4>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                            Completely cleans this restaurant by wiping all test orders, test expenses, and demo menu items simultaneously. Keeps your login and store address intact.
                          </p>
                        </div>
                        <button 
                          className="btn" 
                          style={{ background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '12px' }}
                          onClick={handleFullStoreReset}
                        >
                          ⚠️ Full Reset (Start From Scratch)
                        </button>
                      </div>
                    </div>
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

                <UserManagementSection showToast={showToast} currentUser={currentUser} />
              </div>
            )}

            {/* Restaurant point-of-sale workstation printer configuration.
                Unlike storefront delivery settings, this belongs under POS Settings. */}
            {subTab === 'printer' && (
              <div className="receipt-workspace">
                <header className="receipt-workspace-header">
                  <span className="receipt-workspace-kicker">GastroFlow · Restaurant workspace</span>
                  <h2>Receipt & Printer Studio</h2>
                  <p>Make every bill look professional and save thermal paper. Design once for your restaurant, then calibrate the local printer safely.</p>
                </header>
                <div className="receipt-workspace-tabs" role="tablist" aria-label="Printer workspace sections">
                  <button role="tab" aria-selected={printerWorkspaceView==='design'} type="button"
                    className={`receipt-workspace-tab ${printerWorkspaceView==='design'?'active':''}`} onClick={()=>setPrinterWorkspaceView('design')}>✨ Receipt Designer</button>
                  <button role="tab" aria-selected={printerWorkspaceView==='hardware'} type="button"
                    className={`receipt-workspace-tab ${printerWorkspaceView==='hardware'?'active':''}`} onClick={()=>setPrinterWorkspaceView('hardware')}>🖨️ Printer & Hardware</button>
                </div>
                {printerWorkspaceView==='design' ? (
                  <SmartReceiptDesigner settings={settings} updateSetting={updateSetting} showToast={showToast}
                    nativeConfig={nativeConfig} onFeedLinesChange={onFeedLinesChange}/>
                ) : (
                  <div className="receipt-hardware-card">
                    <div className="receipt-card-head">
                      <div><h3>Printer setup</h3><p style={{fontSize:12,color:'var(--text-muted)',margin:'5px 0 0'}}>Choose paper width and run a quick print test before cashier operations.</p></div>
                      <span className="receipt-pill">Windows · 58mm / 80mm</span>
                    </div>
                    <div className="receipt-hardware-subcard">
                      <label className="receipt-field" htmlFor="gastroflow-printer-paper">Printer paper size
                        <select id="gastroflow-printer-paper" className="form-select"
                          value={settings?.printerPaperWidth || 'auto'}
                          onChange={async e=>{await updateSetting('printerPaperWidth',e.target.value);try{localStorage.setItem('gastroflow_printer_paper',e.target.value);}catch(_){}}}>
                          <option value="auto">Auto-detect · 58mm handheld / 80mm counter</option>
                          <option value="80mm">80mm · Standard POS-80</option>
                          <option value="58mm">58mm · Compact thermal</option>
                          <option value="a4">A4 · Full-size invoice</option>
                        </select>
                      </label>
                      <div className="receipt-hardware-row">
                        <button type="button" className="btn btn-outline"
                          onClick={()=>testPrintReceipt({...settings},settings?.currencySymbol||'Rs.')}>🧾 Print alignment slip</button>
                        <small style={{fontSize:11,color:'var(--text-muted)'}}>This does not create a sale.</small>
                      </div>
                    </div>
                    <div className="receipt-hardware-subcard">
                      <div className="receipt-card-head">
                        <div><h3>Direct thermal printing</h3><p style={{fontSize:12,color:'var(--text-muted)',margin:'6px 0 0'}}>Optional QZ Tray integration for ESC/POS printers on this workstation.</p></div>
                        <span className="receipt-pill">{nativeConfig.enabled?'Enabled locally':'Optional pilot'}</span>
                      </div>
                      <a href="https://qz.io/download/" target="_blank" rel="noopener noreferrer" style={{fontSize:12}}>Download QZ Tray for Windows</a>
                      <button type="button" className="btn btn-outline" disabled={nativeBusy} onClick={discoverNativePrinters}>
                        {nativeBusy?'Connecting…':'1 · Find connected printers'}
                      </button>
                      <label className="receipt-field" htmlFor="gastroflow-native-printer-select">2 · Select Windows printer
                        <select id="gastroflow-native-printer-select" className="form-select" value={nativePrinterName}
                          onChange={e=>{setNativePrinterName(e.target.value);setNativeTested(false);if(nativeConfig.enabled)toggleNativePrinter(false);}}>
                          <option value="">Choose a detected printer</option>
                          {nativePrinters.map(printer=><option key={printer} value={printer}>{printer}</option>)}
                        </select>
                      </label>
                      <button type="button" className="btn btn-outline"
                        disabled={nativeBusy||!nativePrinters.includes(nativePrinterName)||nativeConfig.enabled}
                        onClick={testNativePrinter}>3 · Print native test + cut</button>
                      <label className="receipt-toggle">
                        <input type="checkbox" checked={nativeConfig.enabled} onChange={e=>toggleNativePrinter(e.target.checked)}
                          disabled={nativeBusy||(!nativeConfig.enabled&&!nativeTested)}/>
                        <span><strong>Enable direct cashier printing on this computer</strong>
                          <small>Only activate after confirming the test printed and cut correctly.</small></span>
                      </label>
                      {nativeStatus && <p role="status" style={{fontSize:12,color:'var(--text-muted)',margin:0}}>{nativeStatus}</p>}
                      <p style={{fontSize:11,color:'var(--text-muted)',margin:0,lineHeight:1.5}}>A successful QZ request only confirms that the job was sent to Windows. A failure will not trigger an automatic duplicate; use browser Print manually.</p>
                    </div>
                    <label className="receipt-toggle">
                      <input type="checkbox" checked={settings?.autoKickDrawer === 'true'}
                        onChange={async e=>await updateSetting('autoKickDrawer',e.target.checked?'true':'false')}/>
                      <span><strong>Auto-open cash drawer on cash settlement</strong><small>Uses the configured cashier hardware.</small></span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* 4. Online Store Admin Settings */}
            {subTab === 'online' && (
              <div>
                <div style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:14}}>
                  <h2 className="settings-section-title" style={{margin:0}}>Online Store Settings</h2>
                  <button type="button" className="btn btn-outline" onClick={()=>setActiveTab('online-store')}>← Online Store dashboard</button>
                </div>
                <section className="online-store-launch-panel" aria-label="Customer store setup and preview" style={{background:'var(--bg-surface)',border:'1px solid var(--border-color)',borderRadius:18,padding:20,marginBottom:24}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
                    <div>
                      <p style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',color:'var(--color-primary)',marginBottom:6}}>YOUR ONLINE STOREFRONT</p>
                      <h3 style={{fontSize:19,fontWeight:800,margin:'0 0 7px'}}>Set up your customer ordering experience</h3>
                      <p style={{color:'var(--text-muted)',fontSize:13,lineHeight:1.6,maxWidth:570}}>Configure your shop identity, items, delivery fees and opening status, then preview what customers see. Changes here apply only to your restaurant.</p>
                    </div>
                    <a className="btn btn-primary" target="_blank" rel="noopener noreferrer"
                      href={`/customer/?tenant=${encodeURIComponent(currentUser?.tenant_id || currentUser?.tenantId || 'default_tenant')}&view=menu`}
                      style={{display:'inline-flex',alignItems:'center',gap:7,textDecoration:'none'}}>↗ Preview my customer store</a>
                  </div>
                  <div className="online-store-checklist" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,210px),1fr))',gap:12,marginTop:18}}>
                    {[
                      {title:'Business profile',help:'Shop name, phone, logo and address',action:()=>setSubTab('business')},
                      {title:'Online menu',help:'Categories, food photos, stock and prices',action:()=>setSubTab('menu')},
                      {title:'Online availability',help:'Open or pause incoming orders',action:()=>document.getElementById('online-store-controls')?.scrollIntoView({behavior:'smooth',block:'start'})},
                      {title:'Delivery settings',help:'Radius, charges and preparation times',action:()=>document.getElementById('online-store-delivery')?.scrollIntoView({behavior:'smooth',block:'start'})}
                    ].map(item=><button type="button" key={item.title} onClick={item.action}
                      style={{background:'var(--bg-card)',textAlign:'left',border:'1px solid var(--border-color)',borderRadius:12,padding:14,cursor:'pointer',display:'grid',gap:6}}>
                      <strong style={{fontSize:13}}>{item.title} ↗</strong><small style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.4}}>{item.help}</small>
                    </button>)}
                  </div>
                </section>
                
                <div id="online-store-controls" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    
                    <div style={{ flex: 1, minWidth: '200px', padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Store Status</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        Toggle the online store closed instantly if the kitchen is slammed.
                      </p>
                      <button 
                        className={`btn ${settings?.storeOpen === 'true' ? 'btn-danger' : 'btn-primary'}`} 
                        onClick={async () => {
                          const currentVal = settings?.storeOpen;
                          const nextVal = currentVal === 'true' ? 'false' : 'true';
                          await updateSetting('storeOpen', nextVal);
                          showToast(nextVal === 'true' ? '🟢 Online store is now OPEN' : '🔴 Online orders paused', nextVal === 'true' ? 'success' : 'info');
                        }}
                      >
                        {settings?.storeOpen === 'true' ? '🔴 Pause Online Orders' : '🟢 Open Online Store'}
                      </button>
                      <fieldset style={{marginTop:16, display:'grid', gap:8}}>
                        <legend>Online ordering</legend>
                        <label>Daily hours in restaurant time
                          <input key={settings?.onlineOrderHours || 'always'} placeholder="09:00-22:00" defaultValue={settings?.onlineOrderHours || ''}
                            onBlur={event => {
                              const hours = event.target.value.trim();
                              if (hours !== (settings?.onlineOrderHours || '')) {
                                const input = event.target;
                                updateSetting('onlineOrderHours', hours).catch(error => {
                                  input.value = settings?.onlineOrderHours || '';
                                  showToast(error.message, 'error');
                                });
                              }
                            }} />
                          <small>Leave empty for all hours. Overnight hours are supported.</small>
                        </label>
                        <label>Restaurant cover photo URL
                          <input type="url" placeholder="https://…" defaultValue={settings?.onlineCoverPhoto || ''}
                            key={settings?.onlineCoverPhoto || 'no-photo'} onBlur={event => {
                              const url = event.target.value.trim();
                              if (url !== (settings?.onlineCoverPhoto || '')) updateSetting('onlineCoverPhoto', url).catch(error => showToast(error.message, 'error'));
                            }} />
                        </label>
                        <label>Pickup instructions
                          <input placeholder="e.g. Collect at the front counter" defaultValue={settings?.pickupInstructions || ''}
                            key={settings?.pickupInstructions || 'empty'} maxLength={200}
                            onBlur={event => updateSetting('pickupInstructions', event.target.value.trim())} />
                        </label>
                        {[['onlinePickupEnabled','Accept pickup'],['onlineDeliveryEnabled','Accept delivery']].map(([key,label]) => (
                          <label key={key}><input type="checkbox" checked={settings?.[key] !== 'false'}
                            onChange={event => updateSetting(key, String(event.target.checked))} /> {label}</label>
                        ))}
                      </fieldset>
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
                            defaultValue={settings?.dineInPrepTime || 15}
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
                            defaultValue={settings?.takeawayPrepTime || 20}
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
                            defaultValue={settings?.deliveryPrepTime || 35}
                            onBlur={async (e) => {
                              await updateSetting('deliveryPrepTime', e.target.value);
                            }}
                          />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <div id="online-store-delivery" />
                <section className="online-schedule-settings" style={{padding:20,border:'1px solid var(--border-color)',borderRadius:16,background:'var(--bg-surface)',marginBottom:24}}>
                  <h3 style={{fontSize:16,fontWeight:800,marginBottom:8}}>Scheduled order capacity</h3>
                  <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:14}}>Limit how many customer orders can reserve each 15-minute pickup, dine-in or delivery slot. A full slot disappears from the customer checkout. Changes save when you leave the field.</p>
                  <label style={{display:'grid',gap:8,maxWidth:260,fontSize:13,fontWeight:700}}>
                    Orders per 15-minute slot
                    <input className="form-input" type="number" min="1" max="100" step="1" key={settings?.scheduledOrdersPerSlot||'6'}
                      defaultValue={settings?.scheduledOrdersPerSlot||'6'}
                      onBlur={async e=>{const n=Number(e.target.value);if(!Number.isSafeInteger(n)||n<1||n>100){showToast('Choose a capacity from 1 to 100 orders.','error');return;}await updateSetting('scheduledOrdersPerSlot',String(n));}} />
                  </label>
                  <small style={{display:'block',color:'var(--text-muted)',marginTop:9}}>Default: 6. Capacity is checked again when the customer submits an order.</small>
                </section>

                {/* ── Delivery Zone Strategy Panel ── */}
                <div style={{ marginBottom: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>📍 Delivery Zone Strategy</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Restaurant-specific pricing: base fee + chargeable distance beyond the free radius + optional surcharges. Set a fee or surcharge to 0 to disable it. Free delivery above the order threshold overrides charges.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🛵 Base Delivery Fee (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryBaseFee ?? 99}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value < 0 || value > 1000000) { showToast('Enter a valid non-negative delivery setting.', 'error'); e.target.value = String(settings?.deliveryBaseFee ?? 99); return; } await updateSetting('deliveryBaseFee', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Flat fee every delivery order</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>📏 Free Radius (km)</label>
                      <input 
                        type="number" step="0.5" className="form-input" 
                        defaultValue={settings?.deliveryFreeRadiusKm ?? 2}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value < 0 || value > 100) { showToast('Enter a valid non-negative delivery setting.', 'error'); e.target.value = String(settings?.deliveryFreeRadiusKm ?? 2); return; } await updateSetting('deliveryFreeRadiusKm', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>No per-km charge within this radius</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>💰 Per-Km Rate (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryPerKmRate ?? 50}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value < 0 || value > 1000000) { showToast('Enter a valid non-negative delivery setting.', 'error'); e.target.value = String(settings?.deliveryPerKmRate ?? 50); return; } await updateSetting('deliveryPerKmRate', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Charge per km beyond free radius</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🚫 Max Delivery Radius (km)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryMaxRadiusKm ?? 15}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value <= 0 || value > 100) { showToast('Enter a valid non-negative greater-than-zero delivery setting.', 'error'); e.target.value = String(settings?.deliveryMaxRadiusKm ?? 15); return; } await updateSetting('deliveryMaxRadiusKm', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Reject orders beyond this distance</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🔥 Peak Hour Surcharge (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryPeakSurcharge ?? 50}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value < 0 || value > 1000000) { showToast('Enter a valid non-negative delivery setting.', 'error'); e.target.value = String(settings?.deliveryPeakSurcharge ?? 50); return; } await updateSetting('deliveryPeakSurcharge', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Auto-applied during lunch & dinner rush</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🌧️ Rain Surcharge (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryRainSurcharge ?? 75}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value < 0 || value > 1000000) { showToast('Enter a valid non-negative delivery setting.', 'error'); e.target.value = String(settings?.deliveryRainSurcharge ?? 75); return; } await updateSetting('deliveryRainSurcharge', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Applied when rainy weather is toggled ON</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🎁 Free Delivery Threshold (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.deliveryFreeThreshold ?? 3000}
                        onBlur={async (e) => { const value = Number(e.target.value); if (!e.target.value.trim() || !Number.isFinite(value) || value <= 0 || value > 1000000) { showToast('Enter a valid non-negative greater-than-zero delivery setting.', 'error'); e.target.value = String(settings?.deliveryFreeThreshold ?? 3000); return; } await updateSetting('deliveryFreeThreshold', String(value)); }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Orders above this get FREE delivery</span>
                    </div>

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>📦 Min Order Value (Rs.)</label>
                      <input 
                        type="number" className="form-input" 
                        defaultValue={settings?.minimumOrder || 1000}
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
                        defaultValue={settings?.peakLunchStart || '11:30'}
                        onBlur={async (e) => await updateSetting('peakLunchStart', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕑 Lunch Peak End</label>
                      <input type="time" className="form-input"
                        defaultValue={settings?.peakLunchEnd || '14:00'}
                        onBlur={async (e) => await updateSetting('peakLunchEnd', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕕 Dinner Peak Start</label>
                      <input type="time" className="form-input"
                        defaultValue={settings?.peakDinnerStart || '18:30'}
                        onBlur={async (e) => await updateSetting('peakDinnerStart', e.target.value)} />
                    </div>
                    <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600 }}>🕘 Dinner Peak End</label>
                      <input type="time" className="form-input"
                        defaultValue={settings?.peakDinnerEnd || '21:30'}
                        onBlur={async (e) => await updateSetting('peakDinnerEnd', e.target.value)} />
                    </div>
                  </div>

                  {/* Store Location & Weather Controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <PickupPinEditor key={currentUser?.tenant_id} settings={settings} savePickupPin={savePickupPin} />

                    <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>🌤️ Weather & Live Controls</h4>
                      <button
                        className={`btn ${settings?.isRainyWeather === 'true' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '10px 16px', fontSize: '13px', width: '100%', marginBottom: '8px' }}
                        onClick={async () => {
                          const current = settings?.isRainyWeather;
                          const next = current === 'true' ? 'false' : 'true';
                          await updateSetting('isRainyWeather', next);
                          showToast(next === 'true' ? '🌧️ Rainy Weather Mode ON — rain surcharge applies to deliveries.' : '☀️ Rainy Weather Mode OFF — normal delivery pricing.', 'info');
                        }}>
                        {settings?.isRainyWeather === 'true' ? '🌧️ Rainy Weather ACTIVE (Click to Clear)' : '☀️ Normal Weather (Click for Rain Mode)'}
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
                          border: `2px solid ${settings?.driverDispatchMode === opt.mode ? 'var(--color-primary)' : 'var(--border-color)'}`,
                          borderRadius: '12px',
                          background: settings?.driverDispatchMode === opt.mode ? 'var(--color-primary-light, #6366f115)' : 'var(--bg-surface)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{opt.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                        {settings?.driverDispatchMode === opt.mode && (
                          <div style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 700, marginTop: '6px' }}>✅ Active</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)', maxWidth: '300px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600 }}>⏱️ Auto-Dispatch Timeout (seconds)</label>
                    <input type="number" className="form-input"
                      defaultValue={settings?.autoDispatchTimeoutSec || 180}
                      onBlur={async (e) => await updateSetting('autoDispatchTimeoutSec', e.target.value)} />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>In hybrid mode, escalates to manager after this timeout</span>
                  </div>
                </div>

                <div style={{ marginBottom: '32px', padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Marketplace fees and driver earnings</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Delivery prices above are charged to customers. Driver compensation is approved separately in Delivery Management; collected order cash is not driver earnings. Platform commission is managed only by the platform owner and must not be changed from restaurant settings.
                  </p>
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
            {subTab === 'billing' && currentUser?.role === 'owner' && <SubscriptionBilling />}
            {subTab === 'saas' && isMasterSuperAdmin && <PlatformAdmin embedded />}

              </div>
            </>
          )}
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

              {/* ── PREMIUM FOOD PHOTO SECTION ── */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '18px', marginBottom: '20px', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label style={{ fontWeight: 800, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📷 Food Photo</span>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: itemImageUrl ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)', color: itemImageUrl ? '#10b981' : '#6366f1', fontWeight: 600 }}>
                      {itemImageUrl ? '✓ Photo Attached' : 'Optional'}
                    </span>
                  </label>
                  {itemImageUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setItemImageUrl('');
                        setItemImagePreview('');
                      }}
                      style={{ fontSize: '12px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      🗑️ Remove Photo
                    </button>
                  )}
                </div>

                {/* Live Food Preview Card */}
                {itemImagePreview ? (
                  <div style={{ position: 'relative', width: '100%', height: '170px', borderRadius: '12px', overflow: 'hidden', marginBottom: '14px', border: '2px solid rgba(99, 102, 241, 0.3)', boxShadow: '0 8px 20px rgba(0,0,0,0.2)' }}>
                    <img
                      src={itemImagePreview}
                      alt="Food Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 12px', background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', color: '#fff', fontSize: '12px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{itemName || 'Dish Preview'}</span>
                      <span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px' }}>Live POS Banner</span>
                    </div>
                  </div>
                ) : null}

                {/* Tab selector */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  <button
                    type="button"
                    onClick={() => setImageUploadMode('file')}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid ' + (imageUploadMode === 'file' ? 'var(--color-primary)' : 'var(--border-color)'),
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '12px',
                      background: imageUploadMode === 'file' ? 'var(--color-primary)' : 'var(--bg-card)',
                      color: imageUploadMode === 'file' ? '#fff' : 'var(--text-main)',
                      transition: 'all 0.2s'
                    }}
                  >
                    📁 Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUploadMode('preset')}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid ' + (imageUploadMode === 'preset' ? 'var(--color-primary)' : 'var(--border-color)'),
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '12px',
                      background: imageUploadMode === 'preset' ? 'var(--color-primary)' : 'var(--bg-card)',
                      color: imageUploadMode === 'preset' ? '#fff' : 'var(--text-main)',
                      transition: 'all 0.2s'
                    }}
                  >
                    ✨ Photo Presets
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUploadMode('url')}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid ' + (imageUploadMode === 'url' ? 'var(--color-primary)' : 'var(--border-color)'),
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '12px',
                      background: imageUploadMode === 'url' ? 'var(--color-primary)' : 'var(--bg-card)',
                      color: imageUploadMode === 'url' ? '#fff' : 'var(--text-main)',
                      transition: 'all 0.2s'
                    }}
                  >
                    🔗 Paste Link
                  </button>
                </div>

                {/* Tab 1: Device File Upload */}
                {imageUploadMode === 'file' && (
                  <div style={{
                    border: '2px dashed var(--color-primary)',
                    borderRadius: '10px',
                    padding: '24px 20px',
                    textAlign: 'center',
                    background: 'rgba(99, 102, 241, 0.05)',
                    cursor: 'pointer',
                    position: 'relative'
                  }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageFileChange}
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        opacity: 0, cursor: 'pointer', zIndex: 5
                      }}
                    />
                    <div style={{ fontSize: '36px', marginBottom: '8px' }}>📸</div>
                    <p style={{ margin: '0 0 6px 0', fontWeight: 700, fontSize: '14px' }}>Click or Drop dish photo here</p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ pointerEvents: 'none', padding: '6px 16px', fontSize: '12px', fontWeight: 700, margin: '4px 0 8px 0' }}
                    >
                      📁 Browse Photo from Device
                    </button>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>Supports JPG, PNG, WebP, Camera uploads</p>
                  </div>
                )}

                {/* Tab 2: High-Definition Preset Gallery */}
                {imageUploadMode === 'preset' && (
                  <div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Choose a professional food photo preset to instantly apply to this dish:
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px', maxHeight: '160px', overflowY: 'auto', padding: '4px' }}>
                      {PRESET_FOOD_PHOTOS.map((preset, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setItemImageUrl(preset.url);
                            setItemImagePreview(preset.url);
                            setItemEmoji(preset.emoji);
                            showToast('✨ Preset ' + preset.name + ' applied!', 'success');
                          }}
                          style={{
                            borderRadius: '8px',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            border: itemImageUrl === preset.url ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                            background: 'var(--bg-card)',
                            textAlign: 'center',
                            transition: 'all 0.2s',
                            boxShadow: itemImageUrl === preset.url ? '0 0 8px rgba(99, 102, 241, 0.5)' : 'none'
                          }}
                        >
                          <img
                            src={preset.url}
                            alt={preset.name}
                            style={{ width: '100%', height: '56px', objectFit: 'cover' }}
                            loading="lazy"
                          />
                          <div style={{ fontSize: '10px', fontWeight: 700, padding: '4px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {preset.emoji} {preset.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab 3: Paste Image URL */}
                {imageUploadMode === 'url' && (
                  <div>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="https://images.unsplash.com/photo-..."
                      value={itemImageUrl}
                      onChange={(e) => {
                        setItemImageUrl(e.target.value);
                        setItemImagePreview(e.target.value);
                      }}
                      style={{ fontSize: '13px' }}
                    />
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>Paste any direct web image link (HTTPS).</p>
                  </div>
                )}
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

function UserManagementSection({ showToast, currentUser }) {
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('cashier');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [resetAccount, setResetAccount] = useState(null);
  const [resetPin, setResetPin] = useState('');
  const [showResetPin, setShowResetPin] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const fetchUsers = async () => {
    try {
      setListError('');
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to load staff accounts.');
      if (!Array.isArray(data)) throw new Error('Unexpected response loading staff accounts.');
      setUsersList(data);
    } catch (err) {
      setListError(err.message || 'Unable to load staff accounts.');
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (loading) return;
    const cleanUsername = username.trim();
    const message = !cleanUsername ? 'Enter a username.' :
      !/^[a-zA-Z0-9_.-]{3,50}$/.test(cleanUsername) ? 'Username must have 3–50 letters, numbers, underscores, dots or hyphens.' :
      password.length < 12 ? 'Set a password with at least 12 characters.' :
      !/^\d{4,8}$/.test(pin) ? 'Enter a private PIN of 4–8 digits.' :
      role === 'owner' && currentUser?.role !== 'owner' ? 'Only owners can create another owner.' : '';
    if (message) { setFormError(message); return; }
    try {
      setLoading(true);
      setFormError('');
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: cleanUsername, role, pin, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.error || data.message || (res.status === 402 ? 'Staff limit reached for this plan.' : 'Unable to create staff member.');
        throw new Error(detail);
      }
      setUsername('');
      setPin('');
      setPassword('');
      setShowCreate(false);
      setShowPin(false);
      setShowPassword(false);
      await fetchUsers();
      showToast(`Staff account ${cleanUsername} created successfully.`, 'success');
    } catch (err) {
      setFormError(err.message || 'Unable to create staff member.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id, name) => {
    if (!window.confirm(`Delete staff account ${name}? This removes their access to this restaurant.`)) return;
    try {
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to delete staff account.');
      showToast(`Account ${name} deleted.`, 'info');
      await fetchUsers();
    } catch (err) {
      setListError(err.message || 'Unable to delete staff account.');
    }
  };

  const handleResetPin = async (e) => {
    e.preventDefault();
    if (!resetAccount || resetBusy) return;
    if (!/^\d{4,8}$/.test(resetPin)) {
      setResetError('PIN must contain 4 to 8 digits.');
      return;
    }
    try {
      setResetBusy(true);
      setResetError('');
      const token = localStorage.getItem('gastroflow_token');
      const res = await fetch(`/api/users/${encodeURIComponent(resetAccount.id)}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: resetPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reset staff PIN.');
      setResetAccount(null);
      setResetPin('');
      setShowResetPin(false);
      showToast(`PIN updated for ${resetAccount.username}. Share the new PIN privately.`, 'success');
    } catch (err) {
      setResetError(err.message || 'Could not reset staff PIN.');
    } finally {
      setResetBusy(false);
    }
  };

  const visibleUsers = usersList.filter(user =>
    (roleFilter === 'all' || user.role === roleFilter) &&
    user.username.toLowerCase().includes(staffSearch.trim().toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Staff & Users</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Manage employee logins and private POS PINs for this restaurant.</span>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => { setShowCreate(value => !value); setFormError(''); }} aria-expanded={showCreate}>
          {showCreate ? 'Close form' : '+ Add staff'}
        </button>
      </div>
      {showCreate && <form onSubmit={handleCreateUser} style={{ background: 'var(--bg-surface)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
        <h3 style={{ margin: '0 0 8px' }}>Add a staff member</h3>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 20px', fontSize: '13px' }}>Give each employee their own login and private POS PIN. No default credentials are used.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 600 }}>Username
            <input className="form-input" type="text" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. cashier_nimal" minLength={3} maxLength={50} required />
          </label>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 600 }}>Staff role
            <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="cashier">Cashier — POS & checkout</option>
              <option value="manager">Manager — management & reports</option>
              <option value="kitchen">Kitchen — kitchen display</option>
              {currentUser?.role === 'owner' && <option value="owner">Owner — full restaurant access</option>}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 600 }}>Private POS PIN (4–8 digits)
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', minWidth: 0 }}>
              <input className="form-input" style={{ flex: 1, minWidth: 0 }} type={showPin ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Choose a unique PIN" required />
              <button className="btn" type="button" onClick={() => setShowPin(value => !value)} aria-label={showPin ? 'Hide new PIN' : 'Show new PIN'}>{showPin ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 600 }}>Login password (12+ characters)
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', minWidth: 0 }}>
              <input className="form-input" style={{ minWidth: 0, flex: 1 }} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} placeholder="Choose a strong password" required />
              <button className="btn" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
          </label>
        </div>
        {formError && <p role="alert" style={{ color: 'var(--danger, #b91c1c)', marginTop: '16px', fontWeight: 600 }}>{formError}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ minWidth: '190px', padding: '12px 18px' }}>{loading ? 'Creating account…' : '+ Create staff account'}</button>
        </div>
      </form>}

      {listError && <div role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{listError} <button className="btn" onClick={fetchUsers}>Retry</button></div>}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Team directory</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{usersList.length} account{usersList.length === 1 ? '' : 's'} for this restaurant</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <input className="form-input" type="search" aria-label="Search staff by username" placeholder="Search staff…" value={staffSearch} onChange={e => setStaffSearch(e.target.value)} style={{ minWidth: '180px', maxWidth: '260px', flex: '1 1 180px' }} />
          <select className="form-input" style={{ width: '160px', flex: '0 1 160px' }} aria-label="Filter staff by role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
            <option value="kitchen">Kitchen</option>
            <option value="staff">Staff</option>
          </select>
        </div>
      </div>
      <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '560px', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: 'var(--bg-card)', textTransform: 'uppercase', fontSize: '11px', color: 'var(--text-muted)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Username</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Role</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>POS PIN</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length === 0 && <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>{usersList.length === 0 ? 'No staff accounts to display.' : 'No staff match your search or filter.'}</td></tr>}
            {visibleUsers.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>👤 {u.username}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className="badge badge-primary" style={{ textTransform: 'capitalize' }}>{u.role}</span>
                </td>
                <td style={{ padding: '12px 16px' }}><button className="btn" type="button" disabled={u.role === 'owner' && currentUser?.role !== 'owner'} onClick={() => { setResetAccount(u); setResetPin(''); setShowResetPin(false); setResetError(''); }} aria-label={`Manage PIN for ${u.username}`} style={{ padding: '6px 10px', fontSize: '12px' }}>🔒 Manage PIN</button></td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn btn-danger" type="button" disabled={u.id === currentUser?.id || (u.role === 'owner' && currentUser?.role !== 'owner')} onClick={() => handleDeleteUser(u.id, u.username)} style={{ padding: '6px 10px', fontSize: '12px' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resetAccount && (
        <div role="dialog" aria-modal="true" aria-label={`Manage PIN for ${resetAccount.username}`} style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: '20px', background: 'rgba(12, 25, 20, 0.6)' }}>
          <form onSubmit={handleResetPin} style={{ width: '100%', maxWidth: '440px', padding: '24px', background: 'var(--bg-card, #fff)', borderRadius: '16px', boxShadow: '0 15px 50px rgba(0,0,0,.18)', display: 'grid', gap: '14px' }}>
            <h3 style={{ margin: 0 }}>Manage POS PIN</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>Set a new PIN for <strong>{resetAccount.username}</strong>. Existing PINs cannot be recovered because they are securely hashed. You can view the new PIN as you type it before saving. Keep it private.</p>
            <label style={{ display: 'grid', gap: '8px', fontWeight: 600 }}>
              New PIN (4–8 digits)
              <div style={{ display: 'flex', gap: '8px', minWidth: 0 }}>
                <input className="form-input" style={{ flex: 1, minWidth: 0 }} autoFocus type={showResetPin ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required value={resetPin} onChange={e => setResetPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Enter new private PIN" />
                <button className="btn" type="button" onClick={() => setShowResetPin(value => !value)}>{showResetPin ? 'Hide' : 'Show'}</button>
              </div>
            </label>
            {resetError && <p role="alert" style={{ color: 'var(--danger, #b91c1c)', margin: 0 }}>{resetError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn" type="button" disabled={resetBusy} onClick={() => { setResetAccount(null); setResetPin(''); }}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={resetBusy}>{resetBusy ? 'Saving…' : 'Save new PIN'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
