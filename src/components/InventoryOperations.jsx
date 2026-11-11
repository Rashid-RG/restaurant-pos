import React, { useEffect, useRef, useState } from "react";
import {
  PackagePlus,
  ClipboardCheck,
  Trash2,
  Truck,
  History,
  Plus,
  X,
  RefreshCw,
  Utensils,
} from "lucide-react";
import { usePOS } from "../context/POSContext";
import { dateAtRestaurant, formatRestaurantTime, restaurantTimeZone } from "../utils/restaurant-time";
import "./inventory-operations.css";

async function api(path, body) {
  const response = await fetch("/api/inventory/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("gastroflow_token")}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(Error(result.error || "Inventory request failed."), {
      status: response.status,
    });
  return result;
}
function Modal({ title, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="stock-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
const units = ["kg", "g", "L", "ml", "pcs"];
const emptyLine = () => ({
  ingredientId: "",
  quantity: 1,
  unit: "kg",
  unitCost: 0,
});
export default function InventoryOperations({
  onStockChange,
  initialSection = "purchases",
}) {
  const { settings, showToast, currentUser, menuItems, loadAllData } = usePOS(),
    currency = settings.currencySymbol || "Rs.";
  const [section, setSection] = useState(initialSection),
    [data, setData] = useState({
      suppliers: [],
      purchases: [],
      counts: [],
      activity: [],
      movements: [],
      ingredients: [],
    });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [countId, setCountId] = useState(null),
    [counts, setCounts] = useState({});
  const [supplier, setSupplier] = useState({
      name: "",
      phone: "",
      email: "",
      address: "",
    }),
    [po, setPo] = useState({
      supplierId: "",
      reference: "",
      notes: "",
      lines: [emptyLine()],
    }),
    [received, setReceived] = useState({}),
    [receiptReference, setReceiptReference] = useState(""),
    [waste, setWaste] = useState({ ingredientId: "", quantity: 1, reason: "" });
  const [recipeMenu, setRecipeMenu] = useState(""),
    [recipeData, setRecipeData] = useState(null),
    [recipeLines, setRecipeLines] = useState([]);
  const attemptKey = `gastroflow_stock_attempt:${currentUser.tenant_id}:${currentUser.id}`;
  const attempt = useRef(
    (() => {
      try {
        return JSON.parse(sessionStorage.getItem(attemptKey) || "null");
      } catch {
        return null;
      }
    })(),
  );
  const clearAttempt = () => {
    attempt.current = null;
    try {
      sessionStorage.removeItem(attemptKey);
    } catch {}
  };
  const money = (cents) =>
    `${currency}${(Number(cents || 0) / 100).toFixed(2)}`;
  const reload = async () => {
    const ingredientResponse = fetch("/api/ingredients", {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("gastroflow_token")}`,
      },
    }).then(async (r) => {
      if (!r.ok) throw Error("Could not load ingredients.");
      return r.json();
    });
    const [
      suppliers,
      purchases,
      stockCounts,
      activity,
      movements,
      ingredients,
    ] = await Promise.all([
      api("suppliers"),
      api("purchases"),
      api("counts"),
      api("activity"),
      api("movements"),
      ingredientResponse,
    ]);
    setData({
      suppliers,
      purchases,
      counts: stockCounts,
      activity,
      movements,
      ingredients,
    });
  };
  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const open = (name) => {
    if (attempt.current) {
      setError("Recover the saved stock update before entering another.");
      return;
    }
    setError("");
    setModal(name);
  };
  const close = () => {
    if (busy) return;
    if (
      attempt.current &&
      !window.confirm(
        "A stock update may already be saved. You can review its history before entering it again. Close this form?",
      )
    )
      return;
    setModal(null);
    clearAttempt();
  };
  const mutate = async (path, payload, success) => {
    if (busy) return;
    const { requestId: ignored, ...intent } = payload;
    if (attempt.current) {
      const { requestId: oldKey, ...oldIntent } = attempt.current.body;
      if (
        attempt.current.path !== path ||
        JSON.stringify(intent) !== JSON.stringify(oldIntent)
      ) {
        setError("Recover the saved stock update before entering another.");
        return;
      }
    }
    setBusy(true);
    setError("");
    // Freeze a submission across an unknown network result so retry cannot double receive/waste.
    if (!attempt.current)
      attempt.current = {
        path,
        body: { ...payload, requestId: crypto.randomUUID() },
      };
    try {
      sessionStorage.setItem(attemptKey, JSON.stringify(attempt.current));
      const result = await api(attempt.current.path, attempt.current.body);
      clearAttempt();
      setModal(null);
      showToast(success, "success");
      try {
        await reload();
        await onStockChange?.();
        await loadAllData?.();
      } catch (refreshError) {
        setError(
          "The operation was saved. Refresh to reload its latest stock.",
        );
      }
      return result;
    } catch (e) {
      setError(e.message);
      if (e.status && e.status < 500) clearAttempt();
    } finally {
      setBusy(false);
    }
  };
  const purchase = data.purchases.find((row) => row.id === selected),
    count = data.counts.find((row) => row.id === countId);
  const changeLine = (index, field, value) =>
    setPo((old) => ({
      ...old,
      lines: old.lines.map((line, i) => {
        if (i !== index) return line;
        if (field === "ingredientId") {
          const item = data.ingredients.find((row) => row.id === value);
          return {
            ...line,
            ingredientId: value,
            unit: item?.unit || "kg",
            unitCost: Math.round(Number(item?.costPerUnit || 0) * 100) / 100,
          };
        }
        if (field === "unit") {
          const sizes = { kg: 1000, g: 1, L: 1000, ml: 1, pcs: 1 };
          return {
            ...line,
            unit: value,
            unitCost:
              Math.round(
                ((Number(
                  data.ingredients.find((row) => row.id === line.ingredientId)
                    ?.costPerUnit || 0,
                ) *
                  sizes[value]) /
                  sizes[
                    data.ingredients.find((row) => row.id === line.ingredientId)
                      ?.unit || line.unit
                  ]) *
                  100,
              ) / 100,
          };
        }
        return { ...line, [field]: value };
      }),
    }));
  useEffect(() => {
    if (!recipeMenu) return;
    let live = true;
    api("recipes/" + encodeURIComponent(recipeMenu))
      .then((result) => {
        if (live) {
          setRecipeData(result);
          setRecipeLines(
            result.lines.map((line) => ({
              ingredientId: line.ingredientId,
              quantity: line.quantityRequired,
            })),
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [recipeMenu, data.ingredients]);
  const tabs = [
    ["purchases", "Purchases", PackagePlus],
    ["suppliers", "Suppliers", Truck],
    ["counts", "Stock counts", ClipboardCheck],
    ["waste", "Waste", Trash2],
    ["recipes", "Recipes", Utensils],
    ["activity", "Activity", History],
  ];
  return (
    <section className="stock-workbench" aria-label="Stock operations">
      <div className="stock-top">
        <div>
          <span className="stock-eyebrow">STOCK OPERATIONS</span>
          <h2>Purchases, counts and waste in one place.</h2>
          <p>
            Receive purchases, reconcile physical counts and record waste for
            this restaurant.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setLoading(true);
            reload()
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false));
          }}
          aria-label="Refresh stock operations"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="stock-metrics">
        <article>
          <span>Open purchases</span>
          <strong>
            {
              data.purchases.filter((p) =>
                ["ordered", "part_received"].includes(p.status),
              ).length
            }
          </strong>
        </article>
        <article>
          <span>Low ingredients</span>
          <strong>
            {data.ingredients.filter((i) => i.stock <= i.minStock).length}
          </strong>
        </article>
        <article>
          <span>Draft counts</span>
          <strong>
            {data.counts.filter((c) => c.status === "draft").length}
          </strong>
        </article>
        <article>
          <span>Recorded operations</span>
          <strong>{data.activity.length}</strong>
        </article>
      </div>
      <nav className="stock-tabs" aria-label="Stock operation pages">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            aria-current={section === id ? "page" : undefined}
            onClick={() => {
              setSection(id);
              setError("");
            }}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="stock-error" role="alert">
          {error}
        </p>
      )}
      {attempt.current && !modal && (
        <section className="stock-detail">
          <h3>Unconfirmed stock update</h3>
          <p>
            Check or retry the saved update before entering a replacement. Retry
            uses its original details.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              mutate(
                attempt.current.path,
                attempt.current.body,
                "Saved stock update confirmed.",
              )
            }
          >
            Retry saved update
          </button>
        </section>
      )}
      {loading ? (
        <p role="status">Loading stock operations…</p>
      ) : (
        <>
          {section === "suppliers" && (
            <>
              <div className="stock-section-title">
                <h3>Your suppliers</h3>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setSupplier({
                      name: "",
                      phone: "",
                      email: "",
                      address: "",
                    });
                    open("Add supplier");
                  }}
                >
                  <Plus size={16} />
                  Add supplier
                </button>
              </div>
              <div className="stock-cards">
                {data.suppliers.map((row) => (
                  <article key={row.id}>
                    <h3>{row.name}</h3>
                    <p>{row.phone || "No phone recorded"}</p>
                    <p>{row.email}</p>
                    <p>{row.address}</p>
                  </article>
                ))}
              </div>
              {!data.suppliers.length && (
                <p className="stock-empty">
                  Add your first supplier, then create a purchase order.
                </p>
              )}
            </>
          )}
          {section === "purchases" && (
            <>
              <div className="stock-section-title">
                <h3>Purchase orders</h3>
                <button
                  className="btn btn-primary"
                  disabled={!data.suppliers.length || !data.ingredients.length}
                  onClick={() => {
                    setPo({
                      supplierId: data.suppliers[0]?.id || "",
                      reference: "",
                      notes: "",
                      lines: [emptyLine()],
                    });
                    open("New purchase order");
                  }}
                >
                  <Plus size={16} />
                  New purchase
                </button>
              </div>
              {(!data.suppliers.length || !data.ingredients.length) && (
                <p className="stock-empty">
                  Add ingredients and a supplier before creating a purchase.
                </p>
              )}
              <div className="stock-purchase-layout">
                <div className="stock-list">
                  {data.purchases.map((row) => (
                    <button
                      key={row.id}
                      className={selected === row.id ? "selected" : ""}
                      onClick={() => setSelected(row.id)}
                    >
                      <strong>{row.supplierName}</strong>
                      <span>
                        {row.reference || "#" + row.id.slice(0, 8)} ·{" "}
                        {new Date(row.createdAt).toLocaleDateString()}
                      </span>
                      <span className="stock-status">
                        {row.status.replaceAll("_", " ")}
                      </span>
                      <b>{money(row.totalCents)}</b>
                    </button>
                  ))}
                </div>
                {purchase ? (
                  <article className="stock-detail">
                    <div className="stock-section-title">
                      <div>
                        <h3>{purchase.supplierName}</h3>
                        <p>
                          {purchase.reference ||
                            "Purchase #" + purchase.id.slice(0, 8)}
                        </p>
                      </div>
                      <span className="stock-status">
                        {purchase.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="data-table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Ingredient</th>
                            <th>Ordered</th>
                            <th>Received</th>
                            <th>Unit cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchase.lines.map((line) => (
                            <tr key={line.id}>
                              <td>{line.name}</td>
                              <td>
                                {line.quantity} {line.purchaseUnit}
                              </td>
                              <td>
                                {line.receivedQuantity} {line.purchaseUnit}
                              </td>
                              <td>{money(line.unitCostCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>{purchase.notes}</p>
                    {["ordered", "part_received"].includes(purchase.status) && (
                      <div className="stock-actions">
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            setReceived(
                              Object.fromEntries(
                                purchase.lines.map((line) => [line.id, 0]),
                              ),
                            );
                            setReceiptReference("");
                            open("Receive purchase");
                          }}
                        >
                          Receive delivery
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Cancel the unreceived quantities? Stock already received will remain.",
                              )
                            )
                              mutate(
                                `purchases/${purchase.id}/cancel`,
                                {},
                                "Remaining purchase quantities cancelled.",
                              );
                          }}
                        >
                          Cancel remainder
                        </button>
                      </div>
                    )}
                    <p className="stock-note">
                      Recording a purchase does not contact the supplier or make
                      a payment.
                    </p>
                  </article>
                ) : (
                  <p className="stock-empty">
                    Choose a purchase to review or receive a delivery.
                  </p>
                )}
              </div>
            </>
          )}
          {section === "counts" && (
            <>
              <div className="stock-section-title">
                <h3>Physical stock counts</h3>
                <button
                  className="btn btn-primary"
                  disabled={!data.ingredients.length || busy}
                  onClick={async () => {
                    const result = await mutate(
                      "counts",
                      {
                        items: data.ingredients.slice(0, 200).map((row) => ({
                          resourceType: "ingredient",
                          resourceId: row.id,
                        })),
                        notes: "Ingredient stock count",
                      },
                      "Stock count started. Enter the quantities you physically counted.",
                    );
                    if (result) {
                      setCountId(result.id);
                      setCounts({});
                    }
                  }}
                >
                  Start ingredient count
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={
                    busy ||
                    !menuItems.some(
                      (row) => Number.isFinite(row.stock) && row.stock >= 0,
                    )
                  }
                  onClick={async () => {
                    const result = await mutate(
                      "counts",
                      {
                        items: menuItems
                          .filter(
                            (row) =>
                              Number.isFinite(row.stock) && row.stock >= 0,
                          )
                          .slice(0, 200)
                          .map((row) => ({
                            resourceType: "menu",
                            resourceId: row.id,
                          })),
                        notes: "Menu stock count",
                      },
                      "Menu count started. Enter physically counted quantities.",
                    );
                    if (result) {
                      setCountId(result.id);
                      setCounts({});
                    }
                  }}
                >
                  Start menu count
                </button>
              </div>
              <p className="stock-note">
                Count in the displayed base units. If stock changes during a
                count, restart it to avoid overwriting sales or deliveries.
              </p>
              <div className="stock-list stock-count-list">
                {data.counts.map((row) => (
                  <button
                    key={row.id}
                    className={countId === row.id ? "selected" : ""}
                    onClick={() => {
                      setCountId(row.id);
                      setCounts({});
                    }}
                  >
                    <strong>Count #{row.id.slice(0, 8)}</strong>
                    <span>{new Date(row.createdAt).toLocaleString()}</span>
                    <span>{row.status}</span>
                  </button>
                ))}
              </div>
              {count && (
                <form
                  className="stock-detail"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await mutate(
                      `counts/${count.id}/complete`,
                      {
                        lines: count.lines.map((line) => ({
                          lineId: line.id,
                          quantity: Number(counts[line.id]),
                        })),
                      },
                      "Stock count reconciled.",
                    );
                  }}
                >
                  <h3>Count #{count.id.slice(0, 8)}</h3>
                  <div className="data-table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Stock item</th>
                          <th>Expected</th>
                          <th>Counted</th>
                          <th>Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {count.lines.map((line) => (
                          <tr key={line.id}>
                            <td>
                              {line.name}
                              <small> {line.unit}</small>
                            </td>
                            <td>{line.expectedQuantity}</td>
                            <td>
                              {count.status === "draft" ? (
                                <input
                                  aria-label={`Counted ${line.name}`}
                                  type="number"
                                  required
                                  min="0"
                                  max="1000000"
                                  step="0.000001"
                                  value={counts[line.id] ?? ""}
                                  disabled={busy || !!attempt.current}
                                  onChange={(e) =>
                                    setCounts((old) => ({
                                      ...old,
                                      [line.id]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                (line.countedQuantity ?? "—")
                              )}
                            </td>
                            <td>
                              {(
                                count.status === "draft"
                                  ? counts[line.id] !== undefined
                                  : Number.isFinite(line.countedQuantity)
                              )
                                ? (
                                    Number(
                                      count.status === "draft"
                                        ? counts[line.id]
                                        : line.countedQuantity,
                                    ) - line.expectedQuantity
                                  ).toFixed(3)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {count.status === "draft" && (
                    <div className="stock-actions">
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={busy}
                      >
                        {busy ? "Saving…" : "Complete count"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Cancel this count without changing stock?",
                            )
                          )
                            mutate(
                              `counts/${count.id}/cancel`,
                              {},
                              "Stock count cancelled.",
                            );
                        }}
                      >
                        Cancel count
                      </button>
                    </div>
                  )}
                </form>
              )}
            </>
          )}
          {section === "waste" && (
            <>
              <div className="stock-section-title">
                <h3>Waste and spoilage</h3>
                <button
                  className="btn btn-primary"
                  disabled={!data.ingredients.length}
                  onClick={() => {
                    setWaste({
                      ingredientId: data.ingredients[0]?.id || "",
                      quantity: 1,
                      reason: "",
                    });
                    open("Record waste");
                  }}
                >
                  Record waste
                </button>
              </div>
              <p className="stock-note">
                Waste deducts available stock and preserves its reason and cost.
                Quantities cannot exceed stock on hand.
              </p>
              <div className="stock-cards">
                {data.activity
                  .filter((row) => row.kind === "waste")
                  .map((row) => {
                    const result = JSON.parse(row.result);
                    return (
                      <article key={row.id}>
                        <h3>
                          {data.ingredients.find((i) => i.id === row.resourceId)
                            ?.name || "Stock item"}
                        </h3>
                        <p>{row.reason}</p>
                        <strong>
                          {result.quantity} {result.unit} ·{" "}
                          {money(result.costCents)}
                        </strong>
                        <small>
                          {new Date(row.createdAt).toLocaleString()}
                        </small>
                      </article>
                    );
                  })}
              </div>
            </>
          )}
          {section === "recipes" && (
            <section className="stock-detail">
              <h3>Recipes and ingredient cost</h3>
              <label className="stock-recipe-select">
                Menu item
                <select
                  aria-label="Recipe menu item"
                  value={recipeMenu}
                  onChange={(e) => {
                    setRecipeMenu(e.target.value);
                    setRecipeData(null);
                    setRecipeLines([]);
                  }}
                >
                  <option value="">Choose a menu item</option>
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {recipeData && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await mutate(
                      "recipes/" + recipeMenu,
                      { lines: recipeLines },
                      "Recipe saved. New orders use the updated ingredient quantities.",
                    );
                  }}
                >
                  <p className="stock-note">
                    Quantities are for one sold menu portion, in each
                    ingredient's base unit. Existing order reservations keep
                    their saved recipe.
                  </p>
                  {recipeLines.map((line, index) => (
                    <div className="stock-recipe-line" key={index}>
                      <label>
                        Ingredient
                        <select
                          aria-label={`Recipe ingredient ${index + 1}`}
                          required
                          disabled={busy || !!attempt.current}
                          value={line.ingredientId}
                          onChange={(e) =>
                            setRecipeLines((old) =>
                              old.map((row, i) =>
                                i === index
                                  ? { ...row, ingredientId: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="">Choose ingredient</option>
                          {data.ingredients.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name} ({row.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Quantity (
                        {data.ingredients.find(
                          (row) => row.id === line.ingredientId,
                        )?.unit || "base unit"}
                        )
                        <input
                          aria-label={`Recipe quantity ${index + 1}`}
                          type="number"
                          required
                          min="0.000001"
                          max="1000000"
                          step="0.000001"
                          disabled={busy || !!attempt.current}
                          value={line.quantity}
                          onChange={(e) =>
                            setRecipeLines((old) =>
                              old.map((row, i) =>
                                i === index
                                  ? { ...row, quantity: Number(e.target.value) }
                                  : row,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy || !!attempt.current}
                        onClick={() =>
                          setRecipeLines((old) =>
                            old.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="stock-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={
                        busy || !!attempt.current || recipeLines.length >= 100
                      }
                      onClick={() =>
                        setRecipeLines((old) => [
                          ...old,
                          { ingredientId: "", quantity: 1 },
                        ])
                      }
                    >
                      Add ingredient
                    </button>
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={busy || !recipeMenu}
                    >
                      {busy ? "Saving…" : "Save recipe"}
                    </button>
                  </div>
                  <div className="stock-metrics">
                    <article>
                      <span>Current ingredient cost / portion</span>
                      <strong>{money(recipeData.costCents)}</strong>
                    </article>
                    <article>
                      <span>Menu selling price</span>
                      <strong>
                        {money(Math.round(recipeData.menuItem.price * 100))}
                      </strong>
                    </article>
                  </div>
                  <p className="stock-note">
                    Ingredient cost excludes labor, packaging, fees and
                    overhead. Purchase receiving recalculates ingredient costs.
                  </p>
                </form>
              )}
            </section>
          )}
          {section === "activity" && (
            <>
              <h3>Stock movement history</h3>
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Item</th>
                      <th>Change</th>
                      <th>Operation</th>
                      <th>Staff ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movements.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.createdAt).toLocaleString()}</td>
                        <td>{row.resourceName}</td>
                        <td>
                          {row.delta > 0 ? "+" : ""}
                          {Number(row.delta).toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                        </td>
                        <td>{row.reason.replaceAll("_", " ")}</td>
                        <td>{row.actorId || "Customer order"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 style={{ marginTop: 24 }}>Manager action history</h3>
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Action</th>
                      <th>Reason / reference</th>
                      <th>Staff ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activity.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.createdAt).toLocaleString()}</td>
                        <td>{row.kind.replaceAll("_", " ")}</td>
                        <td>{row.reason}</td>
                        <td>{row.actorId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.movements.length && (
                <p className="stock-empty">
                  New order reservations, receiving, counts and waste will
                  appear here.
                </p>
              )}
            </>
          )}
        </>
      )}
      {modal && (
        <Modal title={modal} onClose={close} busy={busy}>
          {error && (
            <p className="stock-error" role="alert">
              {error}
            </p>
          )}
          {attempt.current && (
            <p className="stock-note">
              Retry uses the same submitted details. Review history before
              entering a replacement.
            </p>
          )}
          {modal === "Add supplier" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await mutate("suppliers", supplier, "Supplier added.");
              }}
            >
              <label>
                Supplier name
                <input
                  required
                  maxLength={120}
                  value={supplier.name}
                  onChange={(e) =>
                    setSupplier({ ...supplier, name: e.target.value })
                  }
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  maxLength={40}
                  value={supplier.phone}
                  onChange={(e) =>
                    setSupplier({ ...supplier, phone: e.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  maxLength={254}
                  value={supplier.email}
                  onChange={(e) =>
                    setSupplier({ ...supplier, email: e.target.value })
                  }
                />
              </label>
              <label>
                Address
                <textarea
                  maxLength={500}
                  value={supplier.address}
                  onChange={(e) =>
                    setSupplier({ ...supplier, address: e.target.value })
                  }
                />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                Save supplier
              </button>
            </form>
          )}
          {modal === "New purchase order" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await mutate(
                  "purchases",
                  po,
                  "Purchase recorded. Receive stock when the delivery arrives.",
                );
                if (result) setSelected(result.id);
              }}
            >
              <label>
                Supplier
                <select
                  required
                  value={po.supplierId}
                  onChange={(e) => setPo({ ...po, supplierId: e.target.value })}
                >
                  {data.suppliers.map((row) => (
                    <option value={row.id} key={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Order reference
                <input
                  maxLength={120}
                  value={po.reference}
                  onChange={(e) => setPo({ ...po, reference: e.target.value })}
                />
              </label>
              {po.lines.map((line, index) => (
                <fieldset
                  className="stock-purchase-line"
                  key={index}
                  disabled={busy || !!attempt.current}
                >
                  <legend>Line {index + 1}</legend>
                  <label>
                    Ingredient
                    <select
                      aria-label={`Purchase ingredient ${index + 1}`}
                      required
                      value={line.ingredientId}
                      onChange={(e) =>
                        changeLine(index, "ingredientId", e.target.value)
                      }
                    >
                      <option value="">Choose ingredient</option>
                      {data.ingredients.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name} ({row.unit})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="stock-form-row">
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="0.000001"
                        max="1000000"
                        step="0.000001"
                        required
                        value={line.quantity}
                        onChange={(e) =>
                          changeLine(index, "quantity", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      Purchase unit
                      <select
                        value={line.unit}
                        onChange={(e) =>
                          changeLine(index, "unit", e.target.value)
                        }
                      >
                        {units
                          .filter((unit) => {
                            const base = data.ingredients.find(
                              (row) => row.id === line.ingredientId,
                            )?.unit;
                            return (
                              !base ||
                              (["kg", "g"].includes(base)
                                ? ["kg", "g"].includes(unit)
                                : ["L", "ml"].includes(base)
                                  ? ["L", "ml"].includes(unit)
                                  : unit === base)
                            );
                          })
                          .map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Cost per purchase unit
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={line.unitCost}
                        onChange={(e) =>
                          changeLine(index, "unitCost", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  {po.lines.length > 1 && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() =>
                        setPo({
                          ...po,
                          lines: po.lines.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove line
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={po.lines.length >= 100 || busy}
                onClick={() =>
                  setPo({ ...po, lines: [...po.lines, emptyLine()] })
                }
              >
                Add line
              </button>
              <label>
                Notes
                <textarea
                  value={po.notes}
                  maxLength={1000}
                  onChange={(e) => setPo({ ...po, notes: e.target.value })}
                />
              </label>
              <p>
                Estimated order value:{" "}
                <strong>
                  {money(
                    po.lines.reduce(
                      (sum, line) =>
                        sum + Math.round(line.quantity * line.unitCost * 100),
                      0,
                    ),
                  )}
                </strong>
              </p>
              <button className="btn btn-primary" disabled={busy}>
                Create purchase order
              </button>
            </form>
          )}
          {modal === "Receive purchase" && purchase && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await mutate(
                  `purchases/${purchase.id}/receive`,
                  {
                    reference: receiptReference,
                    lines: purchase.lines
                      .filter((line) => Number(received[line.id]) > 0)
                      .map((line) => ({
                        lineId: line.id,
                        quantity: Number(received[line.id]),
                      })),
                  },
                  "Delivery received and ingredient stock updated.",
                );
              }}
            >
              <label>
                Delivery reference
                <input
                  maxLength={120}
                  value={receiptReference}
                  disabled={busy || !!attempt.current}
                  onChange={(e) => setReceiptReference(e.target.value)}
                />
              </label>
              {purchase.lines
                .filter((line) => line.quantity > line.receivedQuantity)
                .map((line) => (
                  <label key={line.id}>
                    Receive {line.name} ({line.purchaseUnit})
                    <small>
                      {(line.quantity - line.receivedQuantity).toFixed(3)}{" "}
                      remaining
                    </small>
                    <input
                      type="number"
                      min="0"
                      max={line.quantity - line.receivedQuantity}
                      step="0.000001"
                      value={received[line.id] ?? 0}
                      disabled={busy || !!attempt.current}
                      onChange={(e) =>
                        setReceived({ ...received, [line.id]: e.target.value })
                      }
                    />
                  </label>
                ))}
              <button className="btn btn-primary" disabled={busy}>
                {busy
                  ? "Saving receipt…"
                  : attempt.current
                    ? "Retry receipt"
                    : "Receive quantities"}
              </button>
            </form>
          )}
          {modal === "Record waste" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await mutate(
                  "waste",
                  waste,
                  "Waste recorded and stock deducted.",
                );
              }}
            >
              <fieldset disabled={busy || !!attempt.current}>
                <label>
                  Ingredient
                  <select
                    aria-label="Waste ingredient"
                    value={waste.ingredientId}
                    onChange={(e) =>
                      setWaste({ ...waste, ingredientId: e.target.value })
                    }
                  >
                    {data.ingredients.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · {row.stock} {row.unit} available
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Waste quantity (
                  {
                    data.ingredients.find((i) => i.id === waste.ingredientId)
                      ?.unit
                  }
                  )
                  <input
                    type="number"
                    required
                    min="0.000001"
                    step="0.000001"
                    value={waste.quantity}
                    onChange={(e) =>
                      setWaste({ ...waste, quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    value={waste.reason}
                    onChange={(e) =>
                      setWaste({ ...waste, reason: e.target.value })
                    }
                  />
                </label>
              </fieldset>
              <button className="btn btn-primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : attempt.current
                    ? "Retry waste record"
                    : "Record waste"}
              </button>
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}
