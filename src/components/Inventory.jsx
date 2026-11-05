import InventoryOperations from "./InventoryOperations.jsx";
import React, { useState } from "react";
import { usePOS } from "../context/POSContext";

export default function Inventory() {
  const { menuItems, categories, settings, showToast } = usePOS();

  const [tab, setTab] = useState("raw"); // 'raw' | 'items' | 'recipes'
  const [searchQuery, setSearchQuery] = useState("");

  // Raw ingredients state
  const [ingredients, setIngredients] = useState([]);
  const [showIngModal, setShowIngModal] = useState(false);
  const [ingName, setIngName] = useState("");
  const [ingredientAttempt, setIngredientAttempt] = useState(null);
  const [ingUnit, setIngUnit] = useState("kg");
  const [ingCost, setIngCost] = useState("");
  const [ingStock, setIngStock] = useState("");
  const [ingMinStock, setIngMinStock] = useState("10");
  const [ingSupplier, setIngSupplier] = useState("");

  const [operationsSection, setOperationsSection] = useState("purchases");

  const currencySymbol = settings.currencySymbol || "Rs.";

  const token = localStorage.getItem("gastroflow_token");

  // Load ingredients
  const loadIngredients = async () => {
    try {
      const res = await fetch("/api/ingredients", {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      const res = await fetch("/api/ingredients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: ingredientAttempt?.id,
          requestId: ingredientAttempt?.requestId,
          name: ingName,
          unit: ingUnit,
          costPerUnit: parseFloat(ingCost) || 0,
          stock: parseFloat(ingStock) || 0,
          minStock: parseFloat(ingMinStock) || 0,
          supplier: ingSupplier,
        }),
      });
      if (res.ok) {
        setShowIngModal(false);
        setIngName("");
        setIngCost("");
        setIngStock("");
        setIngSupplier("");
        loadIngredients();
        setIngredientAttempt(null);
      } else {
        const result = await res.json();
        showToast(result.error || "Could not save ingredient.", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Filter items
  const filteredItems = menuItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getCategoryName = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    return cat ? cat.name : catId;
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div className="view-title">
          <h1>Inventory & Recipe Management</h1>
          <p>
            Monitor raw ingredient stocks, supplier costs, and menu item
            margins.
          </p>
        </div>
        <div className="view-actions">
          {tab === "raw" && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setIngredientAttempt({
                  id: crypto.randomUUID(),
                  requestId: crypto.randomUUID(),
                });
                setShowIngModal(true);
              }}
            >
              ＋ Add Ingredient
            </button>
          )}
        </div>
      </div>

      <div className="view-body">
        {/* Navigation Sub-tabs */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "20px",
            flexWrap: "wrap",
          }}
        >
          <button
            className={`btn ${tab === "raw" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab("raw")}
          >
            🥦 Raw Ingredients & Suppliers
          </button>
          <button
            className={`btn ${tab === "items" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab("items")}
          >
            🍕 Menu Item Stock
          </button>
          <button
            className={`btn ${tab === "operations" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab("operations")}
          >
            Purchasing & stock operations
          </button>
        </div>

        {tab === "operations" ? (
          <InventoryOperations
            initialSection={operationsSection}
            onStockChange={loadIngredients}
          />
        ) : tab === "raw" ? (
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
                      <td>
                        {currencySymbol}
                        {ing.costPerUnit} / {ing.unit}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {ing.stock} {ing.unit}
                      </td>
                      <td>{ing.supplier || "—"}</td>
                      <td>
                        <span
                          className={`badge ${isLow ? "badge-danger" : "badge-success"}`}
                        >
                          {isLow ? "Low Stock" : "In Stock"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                          onClick={() => setTab("operations")}
                        >
                          Receive stock
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
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "24px",
                alignItems: "center",
              }}
            >
              <div
                className="search-bar"
                style={{ flexGrow: 1, maxWidth: "400px" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
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
                    const marginPercent =
                      price > 0 ? Math.round((profit / price) * 100) : 0;

                    return (
                      <tr key={item.id}>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "20px",
                                background: "var(--bg-surface)",
                                padding: "6px",
                                borderRadius: "8px",
                              }}
                            >
                              {item.emoji}
                            </span>
                            <div>
                              <div style={{ fontWeight: "600" }}>
                                {item.name}
                              </div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "var(--text-muted)",
                                }}
                              >
                                Threshold: {item.minStock} units
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{getCategoryName(item.category)}</td>
                        <td>
                          {currencySymbol}
                          {cost.toFixed(2)}
                        </td>
                        <td>
                          {currencySymbol}
                          {price.toFixed(2)}
                        </td>
                        <td
                          style={{
                            fontWeight: "600",
                            color:
                              marginPercent > 50
                                ? "var(--color-success)"
                                : "var(--text-main)",
                          }}
                        >
                          {marginPercent}%
                        </td>
                        <td style={{ fontWeight: "700" }}>
                          {item.stock} units
                        </td>
                        <td>
                          <span
                            className={`badge ${isOutOfStock ? "badge-danger" : isLowStock ? "badge-warning" : "badge-success"}`}
                          >
                            {isOutOfStock
                              ? "Out of Stock"
                              : isLowStock
                                ? "Low Stock"
                                : "Good Stock"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: "6px 12px", fontSize: "12px" }}
                            onClick={() => {
                              setOperationsSection("counts");
                              setTab("operations");
                            }}
                          >
                            Count stock
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

        {/* Add Raw Ingredient Modal */}
        {showIngModal && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "420px" }}>
              <div className="modal-header">
                <h2>Add Raw Ingredient</h2>
                <button
                  className="modal-close"
                  onClick={() => setShowIngModal(false)}
                >
                  ×
                </button>
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

                <div style={{ display: "flex", gap: "12px" }}>
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

                <div style={{ display: "flex", gap: "12px" }}>
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

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "12px",
                    marginTop: "24px",
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowIngModal(false)}
                  >
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
