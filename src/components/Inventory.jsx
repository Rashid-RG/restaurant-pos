import React, { useState } from 'react';
import { usePOS } from '../context/POSContext';

export default function Inventory() {
  const { menuItems, saveMenuItem, categories, settings } = usePOS();
  
  const [tab, setTab] = useState('raw'); // 'raw' | 'items' | 'recipes'
  const [searchQuery, setSearchQuery] = useState('');

  // Raw ingredients state
  const [ingredients, setIngredients] = useState([]);
  const [showIngModal, setShowIngModal] = useState(false);
  const [ingName, setIngName] = useState('');
  const [ingUnit, setIngUnit] = useState('kg');
  const [ingCost, setIngCost] = useState('');
  const [ingStock, setIngStock] = useState('');
  const [ingMinStock, setIngMinStock] = useState('10');
  const [ingSupplier, setIngSupplier] = useState('');

  // Recipes state
  const [selectedRecipeItem, setSelectedRecipeItem] = useState(null);
  const [recipeIngredients, setRecipeIngredients] = useState([]);

  // Item stock adjust state
  const [selectedItem, setSelectedItem] = useState(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustType, setAdjustType] = useState('add');

  const currencySymbol = settings.currencySymbol || 'Rs.';

  const token = localStorage.getItem('gastroflow_token');

  // Load ingredients
  const loadIngredients = async () => {
    try {
      const res = await fetch('/api/ingredients', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setIngredients(data || []);
      }
    } catch (_) {}
  };

  React.useEffect(() => {
    loadIngredients();
  }, []);

  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    if (!ingName || !ingCost) return;
    try {
      const res = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: ingName,
          unit: ingUnit,
          costPerUnit: parseFloat(ingCost) || 0,
          stock: parseFloat(ingStock) || 0,
          minStock: parseFloat(ingMinStock) || 0,
          supplier: ingSupplier
        })
      });
      if (res.ok) {
        setShowIngModal(false);
        setIngName('');
        setIngCost('');
        setIngStock('');
        setIngSupplier('');
        loadIngredients();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Filter items
  const filteredItems = menuItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCategoryName = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    return cat ? cat.name : catId;
  };

  const handleAdjustSubmit = async (e) => {
    e.preventDefault();
    if (!selectedItem || adjustQty === '') return;

    const quantity = parseInt(adjustQty) || 0;
    let nextStock = selectedItem.stock;

    if (adjustType === 'add') {
      nextStock += quantity;
    } else {
      nextStock = quantity;
    }

    const updatedItem = {
      ...selectedItem,
      stock: Math.max(0, nextStock),
    };

    await saveMenuItem(updatedItem);
    setAdjustQty('');
    setSelectedItem(null);
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>Inventory & Recipe Management</h1>
          <p>Monitor raw ingredient stocks, supplier costs, and menu item margins.</p>
        </div>
        <div className="view-actions">
          {tab === 'raw' && (
            <button className="btn btn-primary" onClick={() => setShowIngModal(true)}>
              ＋ Add Ingredient
            </button>
          )}
        </div>
      </div>

      <div className="view-body">
        {/* Navigation Sub-tabs */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <button 
            className={`btn ${tab === 'raw' ? 'btn-primary' : 'btn-secondary'}`} 
            onClick={() => setTab('raw')}
          >
            🥦 Raw Ingredients & Suppliers
          </button>
          <button 
            className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-secondary'}`} 
            onClick={() => setTab('items')}
          >
            🍕 Menu Item Stock
          </button>
        </div>

        {tab === 'raw' ? (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ingredient Name</th>
                  <th>Unit Cost</th>
                  <th>Current Stock</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.map((ing) => {
                  const isLow = ing.stock <= ing.minStock;
                  return (
                    <tr key={ing.id}>
                      <td style={{ fontWeight: 600 }}>{ing.name}</td>
                      <td>{currencySymbol}{ing.costPerUnit} / {ing.unit}</td>
                      <td style={{ fontWeight: 700 }}>{ing.stock} {ing.unit}</td>
                      <td>{ing.supplier || '—'}</td>
                      <td>
                        <span className={`badge ${isLow ? 'badge-danger' : 'badge-success'}`}>
                          {isLow ? 'Low Stock' : 'In Stock'}
                        </span>
                      </td>
                      <td>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={async () => {
                            const addVal = prompt(`Add stock for ${ing.name} (${ing.unit}):`, '10');
                            if (!addVal || isNaN(parseFloat(addVal))) return;
                            const newStock = ing.stock + parseFloat(addVal);
                            await fetch('/api/ingredients', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ ...ing, stock: newStock })
                            });
                            loadIngredients();
                          }}
                        >
                          ➕ Restock
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            {/* Top filter row */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center' }}>
              <div className="search-bar" style={{ flexGrow: 1, maxWidth: '400px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search inventory items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Data Table */}
            <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Unit Cost</th>
                <th>Selling Price</th>
                <th>Margin</th>
                <th>Stock Level</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isOutOfStock = item.stock <= 0;
                const isLowStock = item.stock <= item.minStock;
                
                // Margin calculation
                const cost = item.cost || 0;
                const price = item.price || 0;
                const profit = price - cost;
                const marginPercent = price > 0 ? Math.round((profit / price) * 100) : 0;

                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '20px', background: 'var(--bg-surface)', padding: '6px', borderRadius: '8px' }}>
                          {item.emoji}
                        </span>
                        <div>
                          <div style={{ fontWeight: '600' }}>{item.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Threshold: {item.minStock} units</div>
                        </div>
                      </div>
                    </td>
                    <td>{getCategoryName(item.category)}</td>
                    <td>{currencySymbol}{cost.toFixed(2)}</td>
                    <td>{currencySymbol}{price.toFixed(2)}</td>
                    <td style={{ fontWeight: '600', color: marginPercent > 50 ? 'var(--color-success)' : 'var(--text-main)' }}>
                      {marginPercent}%
                    </td>
                    <td style={{ fontWeight: '700' }}>{item.stock} units</td>
                    <td>
                      <span className={`badge ${isOutOfStock ? 'badge-danger' : (isLowStock ? 'badge-warning' : 'badge-success')}`}>
                        {isOutOfStock ? 'Out of Stock' : (isLowStock ? 'Low Stock' : 'Good Stock')}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => setSelectedItem(item)}
                      >
                        Adjust Stock
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}

      {/* Adjust Stock Modal */}
      {selectedItem && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Adjust Stock Level</h2>
              <button className="modal-close" onClick={() => setSelectedItem(null)}>×</button>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ fontSize: '32px' }}>{selectedItem.emoji}</span>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>{selectedItem.name}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Current Stock: {selectedItem.stock} units</p>
              </div>
            </div>

            <form onSubmit={handleAdjustSubmit}>
              <div className="form-group">
                <label>Operation Mode</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className={`btn ${adjustType === 'add' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flexGrow: 1 }}
                    onClick={() => setAdjustType('add')}
                  >
                    Add Stock (➕)
                  </button>
                  <button
                    type="button"
                    className={`btn ${adjustType === 'set' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flexGrow: 1 }}
                    onClick={() => setAdjustType('set')}
                  >
                    Set Fixed Level (✏️)
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>{adjustType === 'add' ? 'Quantity to Add' : 'New Absolute Quantity'}</label>
                <input
                  type="number"
                  className="form-input"
                  min={adjustType === 'add' ? '1' : '0'}
                  placeholder="e.g. 50"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedItem(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Raw Ingredient Modal */}
      {showIngModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h2>Add Raw Ingredient</h2>
              <button className="modal-close" onClick={() => setShowIngModal(false)}>×</button>
            </div>
            <form onSubmit={handleSaveIngredient}>
              <div className="form-group">
                <label>Ingredient Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Fresh Mozzarella"
                  value={ingName}
                  onChange={(e) => setIngName(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Unit of Measure</label>
                  <select
                    className="form-select"
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value)}
                  >
                    <option value="kg">kg (Kilograms)</option>
                    <option value="g">g (Grams)</option>
                    <option value="L">L (Liters)</option>
                    <option value="ml">ml (Milliliters)</option>
                    <option value="pcs">pcs (Units/Pieces)</option>
                  </select>
                </div>

                <div className="form-group" style={{ flex: 1 }}>
                  <label>Cost per Unit ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="e.g. 1500"
                    value={ingCost}
                    onChange={(e) => setIngCost(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Initial Stock</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="e.g. 50"
                    value={ingStock}
                    onChange={(e) => setIngStock(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ flex: 1 }}>
                  <label>Min Stock Threshold</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="e.g. 10"
                    value={ingMinStock}
                    onChange={(e) => setIngMinStock(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Supplier Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Lanka Dairies Ltd"
                  value={ingSupplier}
                  onChange={(e) => setIngSupplier(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowIngModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Ingredient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
