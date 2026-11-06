import express from "express";
import crypto from "node:crypto";
import { setOrderInventory } from "../lib/order-inventory.js";
import { amountInCents } from "../lib/tenders.js";
export async function initServiceExceptions(dbRun) {
  await dbRun(
    "CREATE TABLE IF NOT EXISTS service_exceptions (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,orderId TEXT NOT NULL,payloadHash TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,actorId TEXT NOT NULL,beforeState TEXT NOT NULL,afterState TEXT NOT NULL,createdAt BIGINT NOT NULL)",
  );
  for (const action of ["UPDATE", "DELETE"])
    await dbRun(
      `CREATE TRIGGER IF NOT EXISTS service_exceptions_no_${action.toLowerCase()} BEFORE ${action} ON service_exceptions BEGIN SELECT RAISE(ABORT,'Service exception history is immutable'); END`,
    );
}
export function createServiceExceptions({
  dbGet,
  dbAll,
  dbRun,
  authenticateToken,
  requireRole,
  resolveAndCalculateBill,
  releaseOrderLoyalty,
  notifyOrderUpdate,
}) {
  const router = express.Router();
  router.use(
    "/service-exceptions",
    authenticateToken,
    requireRole(["owner", "manager"]),
  );
  const fail = (message, code = 400) =>
    Object.assign(new Error(message), { code });
  router.get("/service-exceptions", async (req, res, next) => {
    try {
      res.json(
        await dbAll(
          "SELECT id,orderId,action,reason,actorId,createdAt FROM service_exceptions WHERE tenant_id=? ORDER BY createdAt DESC LIMIT 100",
          [req.tenantId],
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post("/service-exceptions/:id", async (req, res) => {
    let open = false;
    try {
      const { requestId, revision, action, discardPreparedBatch } =
          req.body || {},
        reason = String(req.body?.reason || "").trim(),
        items = req.body?.items;
      if (
        !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId || "") ||
        !Number.isSafeInteger(revision) ||
        !["replace", "cancel"].includes(action) ||
        reason.length < 3 ||
        reason.length > 500
      )
        throw fail(
          "Provide a stable request ID, current ticket revision, action and reason.",
        );
      if (
        action === "replace" &&
        (!Array.isArray(items) || !items.length || items.length > 100)
      )
        throw fail("Provide replacement menu lines.");
      const payloadHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            orderId: req.params.id,
            revision,
            action,
            reason,
            discardPreparedBatch: discardPreparedBatch === true,
            items: action === "replace" ? items : null,
          }),
        )
        .digest("hex");
      await dbRun("BEGIN TRANSACTION");
      open = true;
      const order = await dbGet(
        "SELECT * FROM orders WHERE id=? AND tenant_id=?",
        [req.params.id, req.tenantId],
      );
      if (!order) throw fail("Order not found.", 404);
      const replay = await dbGet(
        "SELECT * FROM service_exceptions WHERE id=?",
        [requestId],
      );
      if (replay) {
        if (
          replay.tenant_id !== req.tenantId ||
          replay.payloadHash !== payloadHash
        )
          throw fail("Request ID conflicts with an earlier change.", 409);
        await dbRun("COMMIT");
        open = false;
        return res.json({ ...JSON.parse(replay.afterState), recovered: true });
      }
      const ticket = await dbGet(
        "SELECT * FROM kitchen_tickets WHERE orderId=? AND tenant_id=?",
        [order.id, req.tenantId],
      );
      if (!ticket || ticket.revision !== revision)
        throw fail(
          "Kitchen ticket changed. Refresh before making an amendment.",
          409,
        );
      if (
        !["pending", "preparing", "ready"].includes(ticket.state) ||
        [
          "cancelled",
          "rejected",
          "delivered",
          "picked_up",
          "out_for_delivery",
          "arrived",
          "served",
        ].includes(order.status)
      )
        throw fail("This ticket is closed or already handed over.", 409);
      const payments = await dbGet(
          "SELECT COALESCE(SUM(amountCents),0) AS cents FROM manual_payments WHERE orderId=? AND tenant_id=?",
          [order.id, req.tenantId],
        ),
        returns = await dbGet(
          "SELECT COALESCE(SUM(amountCents),0) AS cents FROM manual_refunds WHERE orderId=? AND tenant_id=?",
          [order.id, req.tenantId],
        );
      const fullyRefunded =
        order.paymentStatus === "paid" &&
        amountInCents(order.refundedAmount || 0) === amountInCents(order.total);
      if (
        order.paymentStatus === "paid" &&
        !(action === "cancel" && fullyRefunded)
      )
        throw fail(
          "Refund the settled bill first. Paid bills cannot be repriced.",
          409,
        );
      if (payments.cents > returns.cents && !fullyRefunded)
        throw fail(
          "Return recorded payments before changing or cancelling the bill.",
          409,
        );
      if (["payhere", "online_pending"].includes(order.paymentMethod))
        throw fail(
          "Reconcile the gateway payment before amending this ticket.",
          409,
        );
      const prepared = ticket.state !== "pending";
      if (prepared && discardPreparedBatch !== true)
        throw fail(
          "Confirm the entire previous prepared batch is discarded; its stock remains consumed.",
        );
      const inventory = await dbGet(
        "SELECT * FROM order_inventory_state WHERE orderId=? AND tenant_id=?",
        [order.id, req.tenantId],
      );
      if (!inventory)
        throw fail(
          "Legacy inventory must be reconciled before this amendment.",
          409,
        );
      const lines = await dbAll(
        "SELECT * FROM kitchen_lines WHERE orderId=? AND tenant_id=?",
        [order.id, req.tenantId],
      );
      const before = JSON.stringify({
        order,
        ticket,
        lines,
        inventory,
        preparedBatchDiscarded: prepared,
      });
      if (action === "replace") {
        if (
          Number(order.promotionalDiscount || 0) > 0 ||
          Number(order.loyaltyPointsReserved || 0) > 0
        )
          throw fail(
            "Cancel and refund this promotional/loyalty order, then create a new bill with the intended offer.",
            409,
          );
        if (prepared)
          await dbRun(
            "UPDATE order_inventory_state SET requirements='{}',revision=revision+1,updatedAt=? WHERE orderId=? AND tenant_id=?",
            [Date.now(), order.id, req.tenantId],
          );
        else
          await setOrderInventory({
            dbGet,
            dbAll,
            dbRun,
            orderId: order.id,
            tenantId: req.tenantId,
            items: [],
            reason: "modify_release",
            actorId: req.user.id,
            requireExisting: true,
          });
        let bill;
        try {
          bill = await resolveAndCalculateBill(
            items,
            order.discountType,
            order.discountValue,
            0,
            order.tip,
            null,
            order.deliveryFee || 0,
            req.tenantId,
          );
        } catch (e) {
          throw fail(e.message);
        }
        await dbRun(
          "UPDATE orders SET items=?,subtotal=?,discount=?,tax=?,serviceCharge=?,total=?,tip=?,roundedAmount=?,status='pending',paymentStatus='unpaid',paymentMethod=NULL,paymentSplit=NULL,acceptedAt=NULL,etaMinutes=NULL WHERE id=? AND tenant_id=?",
          [
            JSON.stringify(bill.resolvedItems),
            bill.subtotal,
            bill.totalDiscount,
            bill.tax,
            bill.serviceCharge,
            bill.total,
            bill.tip,
            bill.roundedAmount,
            order.id,
            req.tenantId,
          ],
        );
        await dbRun("DELETE FROM order_items WHERE orderId=? AND tenant_id=?", [
          order.id,
          req.tenantId,
        ]);
        for (const item of bill.resolvedItems)
          await dbRun(
            "INSERT INTO order_items (id,orderId,menuItemId,name,price,quantity,notes,tenant_id) VALUES (?,?,?,?,?,?,?,?)",
            [
              crypto.randomUUID(),
              order.id,
              item.id,
              item.name,
              item.unitPrice,
              item.quantity,
              item.notes,
              req.tenantId,
            ],
          );
        await dbRun(
          "UPDATE kitchen_tickets SET state='pending' WHERE orderId=? AND tenant_id=?",
          [order.id, req.tenantId],
        );
        await setOrderInventory({
          dbGet,
          dbAll,
          dbRun,
          orderId: order.id,
          tenantId: req.tenantId,
          items: bill.resolvedItems,
          reason: "modify_reserve",
          actorId: req.user.id,
          requireExisting: true,
        });
      } else {
        if (!prepared)
          await setOrderInventory({
            dbGet,
            dbAll,
            dbRun,
            orderId: order.id,
            tenantId: req.tenantId,
            items: [],
            reason: "manager_cancelled",
            actorId: req.user.id,
            requireExisting: true,
          });
        else
          await dbRun(
            "UPDATE kitchen_tickets SET state='cancelled',revision=revision+1,updatedAt=? WHERE orderId=? AND tenant_id=?",
            [Date.now(), order.id, req.tenantId],
          );
        await dbRun(
          "UPDATE orders SET status=?,voidReason=? WHERE id=? AND tenant_id=?",
          [
            fullyRefunded ? "refunded" : "cancelled",
            reason,
            order.id,
            req.tenantId,
          ],
        );
        await releaseOrderLoyalty(order.id, req.tenantId);
        if (order.tableId)
          await dbRun(
            "UPDATE tables SET status='free',currentOrderId=NULL WHERE id=? AND tenant_id=? AND currentOrderId=?",
            [order.tableId, req.tenantId, order.id],
          );
      }
      const updated = await dbGet(
        "SELECT * FROM orders WHERE id=? AND tenant_id=?",
        [order.id, req.tenantId],
      );
      const result = {
        orderId: order.id,
        action,
        total: updated.total,
        status: updated.status,
        preparedBatchDiscarded: prepared,
      };
      await dbRun(
        "INSERT INTO service_exceptions (id,tenant_id,orderId,payloadHash,action,reason,actorId,beforeState,afterState,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          requestId,
          req.tenantId,
          order.id,
          payloadHash,
          action,
          reason,
          req.user.id,
          before,
          JSON.stringify(result),
          Date.now(),
        ],
      );
      await dbRun(
        "INSERT INTO kitchen_events (id,tenant_id,orderId,actorId,action,details,createdAt) VALUES (?,?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          req.tenantId,
          order.id,
          req.user.id,
          "manager_" + action,
          reason,
          Date.now(),
        ],
      );
      await dbRun("COMMIT");
      open = false;
      notifyOrderUpdate(order.id, updated);
      res.json(result);
    } catch (e) {
      if (open) await dbRun("ROLLBACK");
      res
        .status(typeof e.code === "number" ? e.code : 500)
        .json({
          error:
            typeof e.code === "number"
              ? e.message
              : "Amendment was not confirmed. Retry the same request.",
        });
    }
  });
  return router;
}
