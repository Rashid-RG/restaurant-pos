import crypto from "node:crypto";

export async function initKitchen(dbRun) {
  await dbRun(
    "CREATE TABLE IF NOT EXISTS kitchen_tickets (orderId TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,createdAt BIGINT NOT NULL,updatedAt BIGINT NOT NULL)",
  );
  await dbRun(
    "CREATE TABLE IF NOT EXISTS kitchen_lines (id TEXT PRIMARY KEY,orderId TEXT NOT NULL,tenant_id TEXT NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL,notes TEXT NOT NULL,modifiers TEXT NOT NULL,station TEXT NOT NULL,state TEXT NOT NULL,updatedAt BIGINT NOT NULL)",
  );
  await dbRun(
    "CREATE TABLE IF NOT EXISTS kitchen_events (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,orderId TEXT NOT NULL,actorId TEXT,action TEXT NOT NULL,details TEXT NOT NULL,createdAt BIGINT NOT NULL)",
  );
  await dbRun(
    "CREATE TABLE IF NOT EXISTS kitchen_routing (menuItemId TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,station TEXT NOT NULL)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS kitchen_queue ON kitchen_tickets(tenant_id,state,createdAt)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS kitchen_line_order ON kitchen_lines(tenant_id,orderId)",
  );
}

// Caller owns the order transaction. Payment never removes this fulfillment record.
export async function syncKitchen({
  dbGet,
  dbAll,
  dbRun,
  orderId,
  tenantId,
  items,
  reason,
  actorId = null,
}) {
  if (reason === "offline_order" || reason === "modify_release") return;
  const old = await dbGet(
    "SELECT * FROM kitchen_tickets WHERE orderId=? AND tenant_id=?",
    [orderId, tenantId],
  );
  if (!items.length) {
    if (old)
      await dbRun(
        "UPDATE kitchen_tickets SET state='cancelled',updatedAt=?,revision=revision+1 WHERE orderId=? AND tenant_id=?",
        [Date.now(), orderId, tenantId],
      );
    return;
  }
  if (old && reason !== "modify_reserve") return;
  if (old && old.state !== "pending")
    throw new Error(
      "Kitchen work has started. Reconcile with the kitchen before changing this ticket.",
    );
  const order = await dbGet(
    "SELECT status FROM orders WHERE id=? AND tenant_id=?",
    [orderId, tenantId],
  );
  const initial = ["preparing", "ready"].includes(order?.status)
    ? order.status
    : "pending";
  const now = Date.now();
  await dbRun(
    "INSERT INTO kitchen_tickets (orderId,tenant_id,state,revision,createdAt,updatedAt) VALUES (?,?,?,1,?,?) ON CONFLICT(orderId) DO UPDATE SET revision=revision+1,updatedAt=excluded.updatedAt",
    [orderId, tenantId, initial, now, now],
  );
  await dbRun("DELETE FROM kitchen_lines WHERE orderId=? AND tenant_id=?", [
    orderId,
    tenantId,
  ]);
  for (const item of items) {
    const route = await dbGet(
      "SELECT station FROM kitchen_routing WHERE menuItemId=? AND tenant_id=?",
      [item.id || item.menuItemId, tenantId],
    );
    await dbRun(
      "INSERT INTO kitchen_lines (id,orderId,tenant_id,name,quantity,notes,modifiers,station,state,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        orderId,
        tenantId,
        item.name || "Menu item",
        item.quantity,
        String(item.notes || ""),
        JSON.stringify(item.selectedModifiers || []),
        route?.station || "kitchen",
        initial,
        now,
      ],
    );
  }
  await dbRun(
    "INSERT INTO kitchen_events (id,tenant_id,orderId,actorId,action,details,createdAt) VALUES (?,?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      tenantId,
      orderId,
      actorId,
      "ticket_saved",
      reason,
      now,
    ],
  );
}
