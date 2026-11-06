import express from "express";
import crypto from "node:crypto";
import { syncKitchen } from "../lib/kitchen.js";
export function createKitchenRouter({
  dbGet,
  dbAll,
  dbRun,
  authenticateToken,
  requireRole,
  notifyOrderUpdate,
}) {
  const router = express.Router();
  router.use(
    "/kitchen",
    authenticateToken,
    requireRole(["owner", "manager", "cashier", "kitchen"]),
  );
  const fail = (message, code = 400) =>
    Object.assign(new Error(message), { code });
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(typeof e.code === "number" ? e.code : 500).json({
        error:
          typeof e.code === "number"
            ? e.message
            : "Kitchen update failed. Refresh and retry.",
      });
    }
  };
  const ticket = async (id, t) => {
    const row = await dbGet(
      "SELECT k.*,o.status AS orderStatus,o.paymentStatus,o.diningType,o.orderType,o.tableId,o.customerName,o.acceptedAt,o.etaMinutes,o.timestamp FROM kitchen_tickets k JOIN orders o ON o.id=k.orderId AND o.tenant_id=k.tenant_id WHERE k.orderId=? AND k.tenant_id=?",
      [id, t],
    );
    if (!row) throw fail("Kitchen ticket not found.", 404);
    row.lines = await dbAll(
      "SELECT * FROM kitchen_lines WHERE orderId=? AND tenant_id=? ORDER BY id",
      [id, t],
    );
    row.lines = row.lines.map((x) => ({
      ...x,
      modifiers: JSON.parse(x.modifiers),
    }));
    return row;
  };
  router.get(
    "/kitchen/tickets",
    wrap(async (req, res) => {
      // Only open legacy tickets can be inferred. Never recook historical paid orders.
      await dbRun("BEGIN TRANSACTION");
      try {
        const legacy = await dbAll(
          "SELECT o.* FROM orders o LEFT JOIN kitchen_tickets k ON k.orderId=o.id WHERE o.tenant_id=? AND o.status IN ('pending','hold','preparing','ready') AND k.orderId IS NULL",
          [req.tenantId],
        );
        for (const o of legacy) {
          const items =
            typeof o.items === "string" ? JSON.parse(o.items || "[]") : [];
          if (!items.length) continue;
          await syncKitchen({
            dbGet,
            dbAll,
            dbRun,
            orderId: o.id,
            tenantId: req.tenantId,
            items,
            reason: "legacy_open_ticket",
          });
          if (["preparing", "ready"].includes(o.status)) {
            await dbRun("UPDATE kitchen_tickets SET state=? WHERE orderId=?", [
              o.status,
              o.id,
            ]);
            await dbRun("UPDATE kitchen_lines SET state=? WHERE orderId=?", [
              o.status,
              o.id,
            ]);
          }
        }
        const ids = await dbAll(
          "SELECT k.orderId FROM kitchen_tickets k JOIN orders o ON o.id=k.orderId AND o.tenant_id=k.tenant_id WHERE k.tenant_id=? AND k.state NOT IN ('served','cancelled') AND o.status NOT IN ('cancelled','rejected','delivered') ORDER BY k.createdAt",
          [req.tenantId],
        );
        const rows = [];
        for (const { orderId } of ids)
          rows.push(await ticket(orderId, req.tenantId));
        await dbRun("COMMIT");
        res.json(rows);
      } catch (e) {
        await dbRun("ROLLBACK");
        throw e;
      }
    }),
  );
  router.get(
    "/kitchen/routing",
    wrap(async (req, res) =>
      res.json(
        await dbAll(
          "SELECT m.id,m.name,COALESCE(r.station,'kitchen') AS station FROM menu_items m LEFT JOIN kitchen_routing r ON r.menuItemId=m.id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.name",
          [req.tenantId],
        ),
      ),
    ),
  );
  router.post(
    "/kitchen/routing",
    requireRole(["owner", "manager"]),
    wrap(async (req, res) => {
      const { menuItemId, station } = req.body || {};
      if (!["kitchen", "bar", "desserts"].includes(station))
        throw fail("Choose a valid station.");
      if (
        !(await dbGet("SELECT id FROM menu_items WHERE id=? AND tenant_id=?", [
          menuItemId,
          req.tenantId,
        ]))
      )
        throw fail("Menu item not found.", 404);
      await dbRun(
        "INSERT INTO kitchen_routing (menuItemId,tenant_id,station) VALUES (?,?,?) ON CONFLICT(menuItemId) DO UPDATE SET station=excluded.station WHERE kitchen_routing.tenant_id=excluded.tenant_id",
        [menuItemId, req.tenantId, station],
      );
      res.json({ ok: true });
    }),
  );
  router.post(
    "/kitchen/tickets/:id",
    wrap(async (req, res) => {
      const { revision, state, lineId, etaMinutes } = req.body || {};
      if (
        !Number.isSafeInteger(revision) ||
        !["preparing", "ready", "served"].includes(state)
      )
        throw fail("Provide a ticket revision and valid action.");
      if (
        etaMinutes !== undefined &&
        (!Number.isSafeInteger(etaMinutes) ||
          etaMinutes < 1 ||
          etaMinutes > 240)
      )
        throw fail("ETA must be 1 to 240 minutes.");
      await dbRun("BEGIN TRANSACTION");
      let updated;
      try {
        const current = await ticket(req.params.id, req.tenantId);
        if (
          [
            "cancelled",
            "rejected",
              "delivered",
            "picked_up",
            "out_for_delivery",
            "arrived",
          ].includes(current.orderStatus) ||
          ["cancelled", "served"].includes(current.state)
        )
          throw fail("Ticket is closed. Refresh the board.", 409);
        if (current.orderStatus==='refunded') throw fail('Fully refunded ticket needs manager cancellation or review.',409);
        if (current.revision !== revision)
          throw fail(
            "Ticket changed on another device. Refresh before acting.",
            409,
          );
        const lines = lineId
          ? current.lines.filter((x) => x.id === lineId)
          : current.lines;
        if (!lines.length) throw fail("Ticket line not found.", 404);
        if (
          state === "served" &&
          (current.diningType === "delivery" ||
            current.orderType === "delivery")
        )
          throw fail(
            "The assigned driver confirms pickup for delivery orders.",
            409,
          );
        if (
          state === "served" &&
          (lineId || current.lines.some((x) => x.state !== "ready"))
        )
          throw fail("Every station must finish before serving.", 409);
        for (const line of lines) {
          if (
            state === "preparing" &&
            !["pending", "preparing"].includes(line.state)
          )
            throw fail("A ready item cannot restart cooking.", 409);
          if (state === "ready" && !["preparing", "ready"].includes(line.state))
            throw fail("Start preparation before marking an item ready.", 409);
        }
        const now = Date.now();
        for (const line of lines)
          await dbRun(
            "UPDATE kitchen_lines SET state=?,updatedAt=? WHERE id=? AND tenant_id=?",
            [state, now, line.id, req.tenantId],
          );
        const remaining = await dbAll(
          "SELECT state FROM kitchen_lines WHERE orderId=? AND tenant_id=?",
          [current.orderId, req.tenantId],
        );
        const aggregate =
          state === "served"
            ? "served"
            : remaining.every((x) => x.state === "ready")
              ? "ready"
              : "preparing";
        await dbRun(
          "UPDATE kitchen_tickets SET state=?,revision=revision+1,updatedAt=? WHERE orderId=? AND tenant_id=?",
          [aggregate, now, current.orderId, req.tenantId],
        );
        // Preserve the legacy paid marker while exposing fulfillment on its own record.
        if (!["paid", "partially_refunded", "refunded"].includes(current.orderStatus))
          await dbRun("UPDATE orders SET status=? WHERE id=? AND tenant_id=?", [
            aggregate,
            current.orderId,
            req.tenantId,
          ]);
        if (etaMinutes)
          await dbRun(
            "UPDATE orders SET etaMinutes=?,acceptedAt=COALESCE(acceptedAt,?) WHERE id=? AND tenant_id=?",
            [etaMinutes, now, current.orderId, req.tenantId],
          );
        await dbRun(
          "INSERT INTO kitchen_events (id,tenant_id,orderId,actorId,action,details,createdAt) VALUES (?,?,?,?,?,?,?)",
          [
            crypto.randomUUID(),
            req.tenantId,
            current.orderId,
            req.user.id,
            state,
            lineId || "whole_ticket",
            now,
          ],
        );
        if (
          state === "served" &&
          current.paymentStatus === "paid" &&
          current.tableId
        )
          await dbRun(
            'UPDATE tables SET status="free",currentOrderId=NULL WHERE id=? AND tenant_id=? AND currentOrderId=?',
            [current.tableId, req.tenantId, current.orderId],
          );
        updated = await dbGet(
          "SELECT * FROM orders WHERE id=? AND tenant_id=?",
          [current.orderId, req.tenantId],
        );
        await dbRun("COMMIT");
      } catch (e) {
        await dbRun("ROLLBACK");
        throw e;
      }
      notifyOrderUpdate(req.params.id, { ...updated, kitchenState: state });
      res.json(await ticket(req.params.id, req.tenantId));
    }),
  );
  return router;
}
