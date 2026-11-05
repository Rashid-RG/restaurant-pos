import express from "express";
import crypto from "node:crypto";
import { amountInCents, staffReceipt } from "../lib/tenders.js";
export async function initManualPayments(dbRun) {
  await dbRun(
    "CREATE TABLE IF NOT EXISTS manual_payments (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,orderId TEXT NOT NULL,amountCents INTEGER NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL,actorId TEXT NOT NULL,shiftId TEXT,createdAt BIGINT NOT NULL)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS manual_payment_order ON manual_payments(tenant_id,orderId)",
  );
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS manual_bank_reference ON manual_payments(tenant_id,reference) WHERE method='bank'",
  );
  for (const action of ["UPDATE", "DELETE"])
    await dbRun(
      `CREATE TRIGGER IF NOT EXISTS manual_payments_no_${action.toLowerCase()} BEFORE ${action} ON manual_payments BEGIN SELECT RAISE(ABORT,'Payment history is immutable'); END`,
    );
}
export function createManualPayments({
  dbGet,
  dbAll,
  dbRun,
  authenticateToken,
  requireRole,
  settleOrderPaid,
  notifyOrderUpdate,
  writeAuditLog,
}) {
  const router = express.Router();
  router.use(
    "/manual-payments",
    authenticateToken,
    requireRole(["owner", "manager", "cashier"]),
  );
  const fail = (message, code = 400) =>
    Object.assign(new Error(message), { code });
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res
        .status(typeof e.code === "number" ? e.code : 500)
        .json({
          error:
            typeof e.code === "number"
              ? e.message
              : "Payment could not be confirmed. Refresh and retry the same request.",
        });
    }
  };
  const summary = async (id, t) => {
    const order = await dbGet(
      "SELECT * FROM orders WHERE id=? AND tenant_id=?",
      [id, t],
    );
    if (!order) throw fail("Order not found.", 404);
    const payments = await dbAll(
      "SELECT * FROM manual_payments WHERE orderId=? AND tenant_id=? ORDER BY createdAt,id",
      [id, t],
    );
    const paidCents = payments.reduce((s, x) => s + x.amountCents, 0),
      totalCents = amountInCents(order.total);
    return {
      order: staffReceipt(order),
      payments,
      paidCents,
      balanceCents: order.paymentStatus === "paid" ? 0 : totalCents - paidCents,
      totalCents,
    };
  };
  router.get(
    "/manual-payments",
    wrap(async (req, res) => {
      const orders = await dbAll(
        "SELECT id FROM orders WHERE tenant_id=? AND status NOT IN ('cancelled','rejected','refunded','partially_refunded') AND (COALESCE(paymentStatus,'unpaid')!='paid' OR paymentTimestamp>=?) ORDER BY timestamp DESC LIMIT 200",
        [req.tenantId, Date.now() - 86400000],
      );
      const result = [];
      for (const order of orders)
        result.push(await summary(order.id, req.tenantId));
      res.json(result);
    }),
  );
  router.get(
    "/manual-payments/:id",
    wrap(async (req, res) =>
      res.json(await summary(req.params.id, req.tenantId)),
    ),
  );
  router.post(
    "/manual-payments/:id",
    wrap(async (req, res) => {
      const { requestId, method, amount, confirmed } = req.body || {},
        reference = String(req.body?.reference || "").trim();
      let cents;
      try {
        cents = amountInCents(amount);
      } catch (e) {
        throw fail(e.message);
      }
      if (
        !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId || "") ||
        cents <= 0 ||
        !["cash", "bank"].includes(method)
      )
        throw fail(
          "Provide a stable request ID, cash/bank method and positive amount.",
        );
      if (
        method === "bank" &&
        (!["owner", "manager"].includes(req.user.role) ||
          confirmed !== true ||
          reference.length < 3 ||
          reference.length > 120)
      )
        throw fail(
          "A manager must confirm receipt in the bank account and enter its transaction reference.",
          403,
        );
      if (method === "cash" && reference)
        throw fail("Cash entries do not use a bank reference.");
      await dbRun("BEGIN TRANSACTION");
      let updated;
      try {
        const current = await summary(req.params.id, req.tenantId),
          order = current.order;
        const replay = await dbGet("SELECT * FROM manual_payments WHERE id=?", [
          requestId,
        ]);
        if (replay) {
          if (
            replay.tenant_id !== req.tenantId ||
            replay.orderId !== order.id ||
            replay.amountCents !== cents ||
            replay.method !== method ||
            replay.reference !== reference
          )
            throw fail("Payment ID conflicts with an earlier request.", 409);
          await dbRun("COMMIT");
          return res.json({ ...current, recovered: true });
        }
        if (
          order.paymentStatus === "paid" ||
          [
            "paid",
            "cancelled",
            "rejected",
            "refunded",
            "partially_refunded",
          ].includes(order.status)
        )
          throw fail("This bill is already settled or closed.", 409);
        if (["payhere", "online_pending"].includes(order.paymentMethod))
          throw fail(
            "Gateway payment must be reconciled before collecting cash or bank payment.",
            409,
          );
        if (cents > current.balanceCents)
          throw fail(
            "Amount exceeds the remaining balance. Refresh the bill.",
            409,
          );
        if (
          method === "bank" &&
          (await dbGet(
            "SELECT id FROM manual_payments WHERE tenant_id=? AND reference=? AND method='bank'",
            [req.tenantId, reference],
          ))
        )
          throw fail("This bank reference has already been recorded.", 409);
        const shift = await dbGet(
          "SELECT id FROM shifts WHERE tenant_id=? AND userId=? AND status='open'",
          [req.tenantId, req.user.id],
        );
        if (method === "cash" && !shift)
          throw fail("Open a cashier shift before collecting cash.", 409);
        await dbRun(
          "INSERT INTO manual_payments (id,tenant_id,orderId,amountCents,method,reference,actorId,shiftId,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            requestId,
            req.tenantId,
            order.id,
            cents,
            method,
            reference,
            req.user.id,
            shift?.id || null,
            Date.now(),
          ],
        );
        const entries = [
            ...current.payments,
            { amountCents: cents, method, reference },
          ],
          methods = new Set(entries.map((x) => x.method));
        const paymentMethod = methods.size === 1 ? method : "split",
          split = entries.map((x) => ({
            method: x.method,
            amount: x.amountCents / 100,
            ...(x.reference ? { reference: x.reference } : {}),
          }));
        await dbRun(
          "UPDATE orders SET paymentStatus=?,paymentMethod=?,paymentSplit=? WHERE id=? AND tenant_id=?",
          [
            "partial",
            paymentMethod,
            JSON.stringify(split),
            order.id,
            req.tenantId,
          ],
        );
        if (cents === current.balanceCents) {
          await settleOrderPaid(order, paymentMethod, true, {
            actorId: req.user.id,
            username: req.user.username,
            manualLedger: true,
          });
          await dbRun(
            "UPDATE orders SET cashierId=? WHERE id=? AND tenant_id=?",
            [req.user.id, order.id, req.tenantId],
          );
        }
        await writeAuditLog(
          req.user.id,
          req.user.username,
          "manual_payment",
          `Recorded ${method} ${cents / 100} for order ${order.id}; payment ${requestId}`,
        );
        updated = await summary(order.id, req.tenantId);
        await dbRun("COMMIT");
      } catch (e) {
        await dbRun("ROLLBACK");
        throw e;
      }
      notifyOrderUpdate(req.params.id, updated.order);
      res.json(updated);
    }),
  );
  return router;
}
