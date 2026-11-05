import express from "express";
import crypto from "node:crypto";
import { amountInCents } from "../lib/tenders.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const round = (value) => Math.round(value * 1e6) / 1e6;
const number = (value, label, allowZero = false) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < (allowZero ? 0 : 0.000001) ||
    value > 1e6 ||
    Math.abs(value - round(value)) > 1e-9
  )
    throw fail(
      400,
      `${label} must be a ${allowZero ? "non-negative" : "positive"} number with up to six decimals.`,
    );
  return value;
};
const text = (value, label, min = 1, max = 500) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw fail(400, `Enter ${label} (${min}–${max} characters).`);
  return value.trim();
};
const units = {
  kg: ["mass", 1000],
  g: ["mass", 1],
  L: ["volume", 1000],
  ml: ["volume", 1],
  pcs: ["count", 1],
};
export function convertStock(quantity, from, to) {
  if (!units[from] || !units[to] || units[from][0] !== units[to][0])
    throw fail(
      400,
      "Purchase and ingredient units must measure the same thing.",
    );
  return round((quantity * units[from][1]) / units[to][1]);
}
const fingerprint = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requestId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw fail(400, "A private operation ID is required for safe retries.");
  return value;
};

export async function initInventoryOperations(dbRun) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,supplierId TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,notes TEXT,actorId TEXT NOT NULL,createdAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS purchase_order_lines (id TEXT PRIMARY KEY,orderId TEXT NOT NULL REFERENCES purchase_orders(id),tenant_id TEXT NOT NULL,ingredientId TEXT NOT NULL,name TEXT NOT NULL,baseUnit TEXT NOT NULL,purchaseUnit TEXT NOT NULL,quantity REAL NOT NULL,receivedQuantity REAL NOT NULL DEFAULT 0,unitCostCents INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS inventory_operations (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,requestId TEXT NOT NULL,payloadHash TEXT NOT NULL,kind TEXT NOT NULL,resourceId TEXT,reason TEXT NOT NULL,result TEXT NOT NULL,actorId TEXT NOT NULL,createdAt BIGINT NOT NULL,UNIQUE(tenant_id,requestId))`,
    `CREATE TABLE IF NOT EXISTS stock_counts (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL,notes TEXT,actorId TEXT NOT NULL,createdAt BIGINT NOT NULL,completedAt BIGINT)`,
    `CREATE TABLE IF NOT EXISTS stock_count_lines (id TEXT PRIMARY KEY,countId TEXT NOT NULL REFERENCES stock_counts(id),tenant_id TEXT NOT NULL,resourceType TEXT NOT NULL,resourceId TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL,expectedQuantity REAL NOT NULL,countedQuantity REAL,costPerUnit REAL NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS purchase_tenant_date ON purchase_orders(tenant_id,createdAt)",
    "CREATE INDEX IF NOT EXISTS stock_operation_tenant_date ON inventory_operations(tenant_id,createdAt)",
  ])
    await dbRun(sql);
  for (const table of ["inventory_operations", "inventory_movements"])
    for (const action of ["UPDATE", "DELETE"])
      await dbRun(
        `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Stock history is append-only'); END`,
      );
}

export function createInventoryOperations({
  dbGet,
  dbAll,
  dbRun,
  authenticateToken,
  requireRole,
  notifyPOS,
}) {
  const router = express.Router();
  router.use(
    "/inventory",
    authenticateToken,
    requireRole(["owner", "manager"]),
  );
  const transaction = (handler) => async (req, res) => {
    let open = false;
    try {
      await dbRun("BEGIN TRANSACTION");
      open = true;
      const value = await handler(req);
      await dbRun("COMMIT");
      open = false;
      notifyPOS({ type: "inventory_updated" }, req.tenantId);
      res.set("Cache-Control", "no-store").json(value);
    } catch (error) {
      if (open) await dbRun("ROLLBACK");
      if (!error.status) console.error("[inventory]", error.message);
      res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : "Inventory operation failed. Check its history before retrying.",
      });
    }
  };
  const read = (handler) => async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await handler(req));
    } catch (error) {
      error.status
        ? res.status(error.status).json({ error: error.message })
        : next(error);
    }
  };
  const purchase = async (id, tenant) => {
    const order = await dbGet(
      "SELECT p.*,s.name AS supplierName FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplierId AND s.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=?",
      [id, tenant],
    );
    if (!order) throw fail(404, "Purchase order not found.");
    order.lines = await dbAll(
      "SELECT * FROM purchase_order_lines WHERE orderId=? AND tenant_id=? ORDER BY id",
      [id, tenant],
    );
    order.totalCents = order.lines.reduce(
      (sum, line) => sum + Math.round(line.quantity * line.unitCostCents),
      0,
    );
    return order;
  };
  const prior = async (req, kind, payload) => {
    const key = requestId(req.body.requestId);
    const row = await dbGet(
      "SELECT * FROM inventory_operations WHERE tenant_id=? AND requestId=?",
      [req.tenantId, key],
    );
    if (!row) return null;
    if (row.kind !== kind || row.payloadHash !== fingerprint(payload))
      throw fail(
        409,
        "This operation ID already belongs to different details. Review stock history.",
      );
    return JSON.parse(row.result);
  };
  const record = async (req, kind, payload, result, resourceId, reason) => {
    const id = result.operationId || crypto.randomUUID();
    result.operationId = id;
    await dbRun(
      "INSERT INTO inventory_operations (id,tenant_id,requestId,payloadHash,kind,resourceId,reason,result,actorId,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        req.tenantId,
        requestId(req.body.requestId),
        fingerprint(payload),
        kind,
        resourceId,
        reason,
        JSON.stringify(result),
        req.user.id,
        Date.now(),
      ],
    );
    return result;
  };
  const movement = (req, operationId, type, id, delta, reason) =>
    dbRun(
      "INSERT INTO inventory_movements (id,tenant_id,orderId,revision,resourceType,resourceId,delta,reason,actorId,createdAt) VALUES (?,?,?,1,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        req.tenantId,
        operationId,
        type,
        id,
        delta,
        reason,
        req.user.id,
        Date.now(),
      ],
    );

  router.post(
    "/ingredients",
    authenticateToken,
    requireRole(["owner", "manager"]),
    transaction(async (req) => {
      const body = req.body || {},
        id = body.id || crypto.randomUUID();
      const previous = await dbGet("SELECT * FROM ingredients WHERE id=?", [
        id,
      ]);
      if (previous && previous.tenant_id !== req.tenantId)
        throw fail(404, "Ingredient not found.");
      const name = text(body.name, "ingredient name", 1, 160),
        unit = body.unit;
      if (!units[unit])
        throw fail(400, "Choose kg, g, L, ml or pcs as the stock unit.");
      const stock = number(body.stock ?? previous?.stock ?? 0, "Stock", true),
        minStock = number(
          body.minStock ?? previous?.minStock ?? 0,
          "Minimum stock",
          true,
        ),
        cost = body.costPerUnit;
      if (
        typeof cost !== "number" ||
        !Number.isFinite(cost) ||
        cost < 0 ||
        cost > 1e8
      )
        throw fail(400, "Set a valid non-negative ingredient unit cost.");
      const supplier =
        body.supplier == null ? "" : text(body.supplier, "supplier", 0, 160);
      req.body.requestId = req.body.requestId || crypto.randomUUID();
      const payload = { id, name, unit, cost, stock, minStock, supplier };
      const replay = await prior(req, "ingredient_save", payload);
      if (replay) return replay;
      if (
        previous &&
        previous.unit !== unit &&
        (previous.stock !== 0 ||
          (await dbGet("SELECT id FROM recipes WHERE ingredientId=? LIMIT 1", [
            id,
          ])))
      )
        throw fail(
          409,
          "Reconcile existing stock and recipes before changing its base unit.",
        );
      if (previous)
        await dbRun(
          "UPDATE ingredients SET name=?,unit=?,costPerUnit=?,stock=?,minStock=?,supplier=? WHERE id=? AND tenant_id=?",
          [name, unit, cost, stock, minStock, supplier, id, req.tenantId],
        );
      else
        await dbRun(
          "INSERT INTO ingredients (id,name,unit,costPerUnit,stock,minStock,supplier,tenant_id) VALUES (?,?,?,?,?,?,?,?)",
          [id, name, unit, cost, stock, minStock, supplier, req.tenantId],
        );
      const operationId = crypto.randomUUID(),
        delta = round(stock - (previous?.stock || 0));
      req.body.requestId = req.body.requestId || crypto.randomUUID();
      if (delta)
        await movement(
          req,
          operationId,
          "ingredient",
          id,
          delta,
          previous ? "manager_adjustment" : "opening_stock",
        );
      await record(
        req,
        "ingredient_save",
        payload,
        {
          operationId,
          id,
          name,
          unit,
          costPerUnit: cost,
          stock,
          minStock,
          supplier,
          delta,
        },
        id,
        previous ? "Ingredient updated by manager" : "Opening ingredient stock",
      );
      return { id, name, unit, costPerUnit: cost, stock, minStock, supplier };
    }),
  );
  router.get(
    "/inventory/suppliers",
    read((req) =>
      dbAll("SELECT * FROM suppliers WHERE tenant_id=? ORDER BY name", [
        req.tenantId,
      ]),
    ),
  );
  router.post(
    "/inventory/suppliers",
    transaction(async (req) => {
      const { name, phone = "", email = "", address = "" } = req.body || {};
      const supplier = {
        id: crypto.randomUUID(),
        name: text(name, "supplier name", 1, 120),
        phone: text(String(phone), "phone", 0, 40),
        email: text(String(email), "email", 0, 254),
        address: text(String(address), "address", 0, 500),
      };
      if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email))
        throw fail(400, "Enter a valid supplier email.");
      req.body.requestId = req.body.requestId || crypto.randomUUID();
      const payload = {
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
      };
      const existing = await prior(req, "supplier_create", payload);
      if (existing) return existing;
      await dbRun(
        "INSERT INTO suppliers (id,name,phone,email,address,tenant_id) VALUES (?,?,?,?,?,?)",
        [
          supplier.id,
          supplier.name,
          supplier.phone,
          supplier.email,
          supplier.address,
          req.tenantId,
        ],
      );
      return record(
        req,
        "supplier_create",
        payload,
        supplier,
        supplier.id,
        "Supplier created",
      );
    }),
  );
  router.get(
    "/inventory/purchases",
    read(async (req) => {
      const orders = await dbAll(
        "SELECT id FROM purchase_orders WHERE tenant_id=? ORDER BY createdAt DESC LIMIT 200",
        [req.tenantId],
      );
      const result = [];
      for (const row of orders)
        result.push(await purchase(row.id, req.tenantId));
      return result;
    }),
  );
  router.get(
    "/inventory/purchases/:id",
    read((req) => purchase(req.params.id, req.tenantId)),
  );
  router.post(
    "/inventory/purchases",
    transaction(async (req) => {
      const { supplierId, lines, reference = "", notes = "" } = req.body || {};
      if (!Array.isArray(lines) || !lines.length || lines.length > 100)
        throw fail(400, "Add between 1 and 100 purchase lines.");
      if (
        !(await dbGet("SELECT id FROM suppliers WHERE id=? AND tenant_id=?", [
          supplierId,
          req.tenantId,
        ]))
      )
        throw fail(404, "Supplier not found.");
      const id = crypto.randomUUID(),
        seen = new Set(),
        resolved = [];
      for (const line of lines) {
        if (seen.has(line.ingredientId))
          throw fail(400, "Combine duplicate ingredient lines.");
        seen.add(line.ingredientId);
        const ingredient = await dbGet(
          "SELECT * FROM ingredients WHERE id=? AND tenant_id=?",
          [line.ingredientId, req.tenantId],
        );
        if (!ingredient) throw fail(404, "Ingredient not found.");
        const quantity = number(line.quantity, "Purchase quantity"),
          unit = line.unit || ingredient.unit;
        const base = convertStock(quantity, unit, ingredient.unit);
        if (base <= 0 || base > 1e9)
          throw fail(400, "Purchase quantity is outside the stock range.");
        let cents;
        try {
          cents = amountInCents(line.unitCost, "Purchase unit cost");
        } catch (error) {
          throw fail(400, error.message);
        }
        resolved.push({ ingredient, quantity, unit, cents });
      }
      const payload = {
        supplierId,
        reference: text(reference, "reference", 0, 120),
        notes: text(notes, "notes", 0, 1000),
        lines: resolved
          .map((line) => ({
            ingredientId: line.ingredient.id,
            quantity: line.quantity,
            unit: line.unit,
            cents: line.cents,
          }))
          .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)),
      };
      const existing = await prior(req, "purchase_order", payload);
      if (existing) return purchase(existing.id, req.tenantId);
      if (
        !Number.isSafeInteger(
          resolved.reduce(
            (sum, line) => sum + Math.round(line.quantity * line.cents),
            0,
          ),
        )
      )
        throw fail(400, "Purchase value is too large.");
      await dbRun(
        "INSERT INTO purchase_orders (id,tenant_id,supplierId,status,reference,notes,actorId,createdAt,updatedAt) VALUES (?,?,?,'ordered',?,?,?,?,?)",
        [
          id,
          req.tenantId,
          supplierId,
          text(reference, "reference", 0, 120),
          text(notes, "notes", 0, 1000),
          req.user.id,
          Date.now(),
          Date.now(),
        ],
      );
      for (const line of resolved)
        await dbRun(
          "INSERT INTO purchase_order_lines (id,orderId,tenant_id,ingredientId,name,baseUnit,purchaseUnit,quantity,unitCostCents) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            crypto.randomUUID(),
            id,
            req.tenantId,
            line.ingredient.id,
            line.ingredient.name,
            line.ingredient.unit,
            line.unit,
            line.quantity,
            line.cents,
          ],
        );
      await record(
        req,
        "purchase_order",
        payload,
        { id },
        id,
        payload.reference || "Purchase order created",
      );
      return purchase(id, req.tenantId);
    }),
  );
  router.post(
    "/inventory/purchases/:id/receive",
    transaction(async (req) => {
      const { lines, reference = "" } = req.body || {};
      if (!Array.isArray(lines) || !lines.length || lines.length > 100)
        throw fail(400, "Enter quantities for the received lines.");
      const selected = lines
        .map((line) => ({
          lineId: text(line.lineId, "purchase line ID", 1, 100),
          quantity: number(line.quantity, "Received quantity"),
        }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId));
      if (new Set(selected.map((line) => line.lineId)).size !== selected.length)
        throw fail(400, "A purchase line can only appear once.");
      const payload = {
        orderId: req.params.id,
        lines: selected,
        reference: text(reference, "receipt reference", 0, 120),
      };
      const replay = await prior(req, "purchase_receipt", payload);
      if (replay) return replay;
      const order = await purchase(req.params.id, req.tenantId);
      if (!["ordered", "part_received"].includes(order.status))
        throw fail(409, "This purchase order cannot receive more stock.");
      const operationId = crypto.randomUUID(),
        received = [];
      let totalCents = 0;
      for (const selection of selected) {
        const line = order.lines.find((row) => row.id === selection.lineId);
        if (
          !line ||
          selection.quantity > round(line.quantity - line.receivedQuantity)
        )
          throw fail(
            409,
            "Received quantity exceeds the remaining purchase quantity.",
          );
        const ingredient = await dbGet(
          "SELECT * FROM ingredients WHERE id=? AND tenant_id=?",
          [line.ingredientId, req.tenantId],
        );
        if (
          !ingredient ||
          ingredient.unit !== line.baseUnit ||
          !Number.isFinite(ingredient.stock) ||
          ingredient.stock < 0 ||
          !Number.isFinite(ingredient.costPerUnit) ||
          ingredient.costPerUnit < 0
        )
          throw fail(
            409,
            "Ingredient units or stock changed. Reconcile this purchase before receiving.",
          );
        const delta = convertStock(
            selection.quantity,
            line.purchaseUnit,
            line.baseUnit,
          ),
          newStock = round(ingredient.stock + delta),
          cents = Math.round(selection.quantity * line.unitCostCents);
        if (newStock > 1e9 || delta <= 0)
          throw fail(400, "Received stock exceeds the supported range.");
        const weightedCost = round(
          (ingredient.stock * ingredient.costPerUnit + cents / 100) / newStock,
        );
        await dbRun(
          "UPDATE ingredients SET stock=?,costPerUnit=? WHERE id=? AND tenant_id=?",
          [newStock, weightedCost, ingredient.id, req.tenantId],
        );
        await dbRun(
          "UPDATE purchase_order_lines SET receivedQuantity=? WHERE id=? AND tenant_id=?",
          [
            round(line.receivedQuantity + selection.quantity),
            line.id,
            req.tenantId,
          ],
        );
        await movement(
          req,
          operationId,
          "ingredient",
          ingredient.id,
          delta,
          "purchase_receipt",
        );
        received.push({
          lineId: line.id,
          name: line.name,
          purchaseQuantity: selection.quantity,
          baseQuantity: delta,
          baseUnit: line.baseUnit,
          amountCents: cents,
        });
        totalCents += cents;
      }
      const remaining = await dbGet(
        "SELECT COUNT(*) AS count FROM purchase_order_lines WHERE orderId=? AND tenant_id=? AND receivedQuantity<quantity-0.000001",
        [order.id, req.tenantId],
      );
      const status = remaining.count ? "part_received" : "received";
      await dbRun(
        "UPDATE purchase_orders SET status=?,updatedAt=? WHERE id=? AND tenant_id=?",
        [status, Date.now(), order.id, req.tenantId],
      );
      return record(
        req,
        "purchase_receipt",
        payload,
        {
          success: true,
          operationId,
          orderId: order.id,
          status,
          totalCents,
          lines: received,
        },
        order.id,
        payload.reference || "Purchase received",
      );
    }),
  );
  router.post(
    "/inventory/purchases/:id/cancel",
    transaction(async (req) => {
      const order = await purchase(req.params.id, req.tenantId);
      if (order.status === "cancelled") return { success: true };
      if (!["ordered", "part_received"].includes(order.status))
        throw fail(
          409,
          "A fully received order cannot be cancelled. Use a recorded stock adjustment for a return.",
        );
      await dbRun(
        "UPDATE purchase_orders SET status='cancelled',updatedAt=? WHERE id=? AND tenant_id=?",
        [Date.now(), order.id, req.tenantId],
      );
      req.body.requestId = req.body.requestId || crypto.randomUUID();
      return record(
        req,
        "purchase_cancel",
        { orderId: order.id },
        {
          success: true,
          note: "Remaining quantities cancelled. Previously received stock is retained.",
        },
        order.id,
        "Remaining purchase quantities cancelled",
      );
    }),
  );

  const recipe = async (id, tenant) => {
    const menuItem = await dbGet(
      "SELECT id,name,price FROM menu_items WHERE id=? AND tenant_id=?",
      [id, tenant],
    );
    if (!menuItem) throw fail(404, "Menu item not found.");
    const lines = await dbAll(
      "SELECT r.ingredientId,r.quantityRequired,i.name,i.unit,i.costPerUnit FROM recipes r JOIN ingredients i ON i.id=r.ingredientId AND i.tenant_id=r.tenant_id WHERE r.menuItemId=? AND r.tenant_id=? ORDER BY i.name",
      [id, tenant],
    );
    return {
      menuItem,
      lines,
      costCents: Math.round(
        lines.reduce(
          (sum, line) => sum + line.quantityRequired * line.costPerUnit,
          0,
        ) * 100,
      ),
    };
  };
  router.get(
    "/inventory/recipes/:id",
    read((req) => recipe(req.params.id, req.tenantId)),
  );
  router.post(
    "/inventory/recipes/:id",
    transaction(async (req) => {
      if (!Array.isArray(req.body.lines) || req.body.lines.length > 100)
        throw fail(400, "Provide up to 100 recipe ingredients.");
      const lines = req.body.lines
        .map((line) => ({
          ingredientId: text(line.ingredientId, "ingredient ID", 1, 100),
          quantityRequired: number(line.quantity, "Recipe quantity"),
        }))
        .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
      if (new Set(lines.map((line) => line.ingredientId)).size !== lines.length)
        throw fail(400, "Combine duplicate recipe ingredients.");
      const payload = { menuItemId: req.params.id, lines };
      const replay = await prior(req, "recipe_update", payload);
      if (replay) return replay;
      await recipe(req.params.id, req.tenantId);
      for (const line of lines)
        if (
          !(await dbGet(
            "SELECT id FROM ingredients WHERE id=? AND tenant_id=?",
            [line.ingredientId, req.tenantId],
          ))
        )
          throw fail(404, "Ingredient not found.");
      await dbRun("DELETE FROM recipes WHERE menuItemId=? AND tenant_id=?", [
        req.params.id,
        req.tenantId,
      ]);
      for (const line of lines)
        await dbRun(
          "INSERT INTO recipes (id,menuItemId,ingredientId,quantityRequired,tenant_id) VALUES (?,?,?,?,?)",
          [
            crypto.randomUUID(),
            req.params.id,
            line.ingredientId,
            line.quantityRequired,
            req.tenantId,
          ],
        );
      return record(
        req,
        "recipe_update",
        payload,
        { success: true, count: lines.length },
        req.params.id,
        "Recipe ingredients updated",
      );
    }),
  );

  router.get(
    "/inventory/counts",
    read(async (req) => {
      const counts = await dbAll(
        "SELECT * FROM stock_counts WHERE tenant_id=? ORDER BY createdAt DESC LIMIT 100",
        [req.tenantId],
      );
      for (const count of counts)
        count.lines = await dbAll(
          "SELECT * FROM stock_count_lines WHERE countId=? AND tenant_id=? ORDER BY name",
          [count.id, req.tenantId],
        );
      return counts;
    }),
  );
  router.post(
    "/inventory/counts",
    transaction(async (req) => {
      const { items, notes = "" } = req.body || {};
      if (!Array.isArray(items) || !items.length || items.length > 200)
        throw fail(400, "Select between 1 and 200 stock items.");
      const payload = {
        items: items
          .map((item) => ({
            resourceType: item.resourceType,
            resourceId: item.resourceId,
          }))
          .sort((a, b) =>
            (a.resourceType + a.resourceId).localeCompare(
              b.resourceType + b.resourceId,
            ),
          ),
        notes: text(notes, "count notes", 0, 500),
      };
      const existing = await prior(req, "stock_count_open", payload);
      if (existing) return existing;
      const id = crypto.randomUUID(),
        seen = new Set(),
        lines = [];
      for (const item of items) {
        if (
          !["ingredient", "menu"].includes(item.resourceType) ||
          seen.has(item.resourceType + item.resourceId)
        )
          throw fail(400, "Select unique stock items.");
        seen.add(item.resourceType + item.resourceId);
        const table =
          item.resourceType === "ingredient" ? "ingredients" : "menu_items";
        const row = await dbGet(
          `SELECT * FROM ${table} WHERE id=? AND tenant_id=?`,
          [item.resourceId, req.tenantId],
        );
        if (!row) throw fail(404, "Stock item not found.");
        if (!Number.isFinite(row.stock) || row.stock < 0)
          throw fail(
            409,
            "This item needs tracked, non-negative stock before counting.",
          );
        if (
          !Number.isFinite(row.costPerUnit ?? row.cost ?? 0) ||
          (row.costPerUnit ?? row.cost ?? 0) < 0
        )
          throw fail(
            409,
            "Set a valid non-negative stock cost before counting.",
          );
        lines.push({ id: crypto.randomUUID(), type: item.resourceType, row });
      }
      await dbRun(
        "INSERT INTO stock_counts (id,tenant_id,status,notes,actorId,createdAt) VALUES (?,?,'draft',?,?,?)",
        [
          id,
          req.tenantId,
          text(notes, "count notes", 0, 500),
          req.user.id,
          Date.now(),
        ],
      );
      for (const line of lines)
        await dbRun(
          "INSERT INTO stock_count_lines (id,countId,tenant_id,resourceType,resourceId,name,unit,expectedQuantity,costPerUnit) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            line.id,
            id,
            req.tenantId,
            line.type,
            line.row.id,
            line.row.name,
            line.row.unit || "pcs",
            line.row.stock,
            line.row.costPerUnit ?? line.row.cost ?? 0,
          ],
        );
      return record(
        req,
        "stock_count_open",
        payload,
        { id, status: "draft" },
        id,
        payload.notes || "Stock count started",
      );
    }),
  );
  router.post(
    "/inventory/counts/:id/complete",
    transaction(async (req) => {
      const entries = req.body?.lines;
      if (!Array.isArray(entries) || !entries.length || entries.length > 200)
        throw fail(400, "Count every selected line.");
      const normalized = entries
        .map((line) => ({
          lineId: text(line.lineId, "count line ID", 1, 100),
          quantity: number(line.quantity, "Counted quantity", true),
        }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId));
      const payload = { countId: req.params.id, lines: normalized };
      const replay = await prior(req, "stock_count", payload);
      if (replay) return replay;
      const count = await dbGet(
        "SELECT * FROM stock_counts WHERE id=? AND tenant_id=?",
        [req.params.id, req.tenantId],
      );
      if (!count) throw fail(404, "Stock count not found.");
      if (count.status !== "draft")
        throw fail(409, "This count is already closed.");
      const lines = await dbAll(
        "SELECT * FROM stock_count_lines WHERE countId=? AND tenant_id=?",
        [count.id, req.tenantId],
      );
      if (
        normalized.length !== lines.length ||
        new Set(normalized.map((line) => line.lineId)).size !== lines.length
      )
        throw fail(400, "Count each selected line exactly once.");
      const operationId = crypto.randomUUID();
      let varianceCents = 0;
      for (const line of lines) {
        const selected = normalized.find((row) => row.lineId === line.id);
        if (!selected) throw fail(400, "A selected count line is missing.");
        const table =
          line.resourceType === "ingredient" ? "ingredients" : "menu_items";
        const changed = await dbRun(
          `UPDATE ${table} SET stock=? WHERE id=? AND tenant_id=? AND stock=?`,
          [
            selected.quantity,
            line.resourceId,
            req.tenantId,
            line.expectedQuantity,
          ],
        );
        if (changed.changes !== 1)
          throw fail(
            409,
            "Stock changed while this count was open. Cancel it and start a new count.",
          );
        const delta = round(selected.quantity - line.expectedQuantity);
        await dbRun(
          "UPDATE stock_count_lines SET countedQuantity=? WHERE id=? AND tenant_id=?",
          [selected.quantity, line.id, req.tenantId],
        );
        await movement(
          req,
          operationId,
          line.resourceType,
          line.resourceId,
          delta,
          "physical_count",
        );
        varianceCents += Math.round(delta * line.costPerUnit * 100);
      }
      if (!Number.isSafeInteger(varianceCents))
        throw fail(400, "Stock variance value is too large.");
      await dbRun(
        "UPDATE stock_counts SET status='completed',completedAt=? WHERE id=? AND tenant_id=?",
        [Date.now(), count.id, req.tenantId],
      );
      return record(
        req,
        "stock_count",
        payload,
        { success: true, operationId, countId: count.id, varianceCents },
        count.id,
        count.notes || "Physical stock count",
      );
    }),
  );
  router.post(
    "/inventory/counts/:id/cancel",
    transaction(async (req) => {
      const count = await dbGet(
        "SELECT status FROM stock_counts WHERE id=? AND tenant_id=?",
        [req.params.id, req.tenantId],
      );
      if (!count) throw fail(404, "Count not found.");
      if (count.status === "completed")
        throw fail(
          409,
          "A completed count cannot be erased. Start a correcting count.",
        );
      await dbRun(
        "UPDATE stock_counts SET status='cancelled' WHERE id=? AND tenant_id=?",
        [req.params.id, req.tenantId],
      );
      req.body.requestId = req.body.requestId || crypto.randomUUID();
      return record(
        req,
        "stock_count_cancel",
        { countId: req.params.id },
        { success: true },
        req.params.id,
        "Draft stock count cancelled",
      );
    }),
  );
  router.post(
    "/inventory/waste",
    transaction(async (req) => {
      const { ingredientId, menuItemId, quantity, reason } = req.body || {};
      if (!ingredientId === !menuItemId)
        throw fail(400, "Choose one stock item.");
      const type = ingredientId ? "ingredient" : "menu",
        id = ingredientId || menuItemId,
        table = ingredientId ? "ingredients" : "menu_items";
      const item = await dbGet(
        `SELECT * FROM ${table} WHERE id=? AND tenant_id=?`,
        [id, req.tenantId],
      );
      if (!item) throw fail(404, "Stock item not found.");
      const qty = number(quantity, "Waste quantity"),
        explanation = text(reason, "waste reason", 3, 500);
      const payload = { type, id, quantity: qty, reason: explanation };
      const replay = await prior(req, "waste", payload);
      if (replay) return replay;
      if (!Number.isFinite(item.stock) || item.stock < qty)
        throw fail(
          409,
          "Insufficient tracked stock. No waste has been deducted.",
        );
      const changed = await dbRun(
        `UPDATE ${table} SET stock=stock-? WHERE id=? AND tenant_id=? AND stock>=?`,
        [qty, id, req.tenantId, qty],
      );
      if (changed.changes !== 1)
        throw fail(409, "Stock changed. Refresh and retry.");
      const operationId = crypto.randomUUID();
      await movement(req, operationId, type, id, -qty, "waste");
      return record(
        req,
        "waste",
        payload,
        {
          success: true,
          operationId,
          quantity: qty,
          unit: item.unit || "pcs",
          costCents: Math.round(
            qty * (item.costPerUnit ?? item.cost ?? 0) * 100,
          ),
        },
        id,
        explanation,
      );
    }),
  );
  router.get(
    "/inventory/activity",
    read((req) =>
      dbAll(
        "SELECT id,kind,resourceId,reason,actorId,createdAt,result FROM inventory_operations WHERE tenant_id=? ORDER BY createdAt DESC LIMIT 200",
        [req.tenantId],
      ),
    ),
  );
  router.get(
    "/inventory/movements",
    read((req) =>
      dbAll(
        `SELECT m.*,COALESCE(i.name,mi.name,m.resourceId) AS resourceName FROM inventory_movements m LEFT JOIN ingredients i ON m.resourceType='ingredient' AND i.id=m.resourceId AND i.tenant_id=m.tenant_id LEFT JOIN menu_items mi ON m.resourceType='menu' AND mi.id=m.resourceId AND mi.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.createdAt DESC LIMIT 300`,
        [req.tenantId],
      ),
    ),
  );
  return router;
}
