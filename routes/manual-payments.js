import express from "express";
import crypto from "node:crypto";
import { amountInCents, staffReceipt } from "../lib/tenders.js";
export async function initManualPayments(dbRun) {
  await dbRun(
    "CREATE TABLE IF NOT EXISTS manual_refunds (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,orderId TEXT NOT NULL,paymentId TEXT NOT NULL,amountCents INTEGER NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL,reason TEXT NOT NULL,actorId TEXT NOT NULL,shiftId TEXT,settled INTEGER NOT NULL,createdAt BIGINT NOT NULL)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS manual_refund_order ON manual_refunds(tenant_id,orderId)",
  );
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS manual_bank_refund_reference ON manual_refunds(tenant_id,reference) WHERE method='bank'",
  );
  for (const action of ["UPDATE", "DELETE"])
    await dbRun(
      `CREATE TRIGGER IF NOT EXISTS manual_refunds_no_${action.toLowerCase()} BEFORE ${action} ON manual_refunds BEGIN SELECT RAISE(ABORT,'Refund history is immutable'); END`,
    );

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
      res.status(typeof e.code === "number" ? e.code : 500).json({
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
    const refunds = await dbAll(
      "SELECT * FROM manual_refunds WHERE orderId=? AND tenant_id=? ORDER BY createdAt,id",
      [id, t],
    );
    for (const payment of payments) {
      payment.refundedCents = refunds
        .filter((r) => r.paymentId === payment.id)
        .reduce((s, r) => s + r.amountCents, 0);
      payment.availableCents = payment.amountCents - payment.refundedCents;
    }
    const paidCents = payments.reduce((s, x) => s + x.availableCents, 0),
      totalCents = amountInCents(order.total);
    return {
      order: staffReceipt(order),
      payments,
      refunds,
      paidCents,
      balanceCents: order.paymentStatus === "paid" ? 0 : totalCents - paidCents,
      totalCents,
    };
  };
  router.get(
    "/manual-payments",
    wrap(async (req, res) => {
      const orders = await dbAll(
        "SELECT id FROM orders WHERE tenant_id=? AND status NOT IN ('cancelled','rejected') AND (COALESCE(paymentStatus,'unpaid')!='paid' OR paymentTimestamp>=?) ORDER BY timestamp DESC LIMIT 200",
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
            ...current.payments
              .filter((p) => p.availableCents > 0)
              .map((p) => ({ ...p, amountCents: p.availableCents })),
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
  router.post(
    "/manual-payments/:id/refunds",
    requireRole(["owner", "manager"]),
    wrap(async (req, res) => {
      const { requestId, paymentId, amount, confirmed } = req.body || {},
        reason = String(req.body?.reason || "").trim(),
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
        reason.length < 3 ||
        reason.length > 500
      )
        throw fail(
          "A stable refund ID, positive amount and reason are required.",
        );
      await dbRun("BEGIN TRANSACTION");
      let updated;
      try {
        const current = await summary(req.params.id, req.tenantId),
          order = current.order;
        const payment = current.payments.find((p) => p.id === paymentId);
        if (!payment) throw fail("Original payment not found.", 404);
        if (confirmed !== true)
          throw fail("Confirm that the money has actually been returned.");
        if (
          payment.method === "bank" &&
          (reference.length < 3 || reference.length > 120)
        )
          throw fail("Enter the completed bank refund transaction reference.");
        if (payment.method === "cash" && reference)
          throw fail("Cash refunds do not use a bank reference.");
        const replay = await dbGet("SELECT * FROM manual_refunds WHERE id=?", [
          requestId,
        ]);
        if (replay) {
          if (
            replay.tenant_id !== req.tenantId ||
            replay.orderId !== order.id ||
            replay.paymentId !== paymentId ||
            replay.amountCents !== cents ||
            replay.reason !== reason ||
            replay.reference !== reference
          )
            throw fail("Refund ID belongs to a different request.", 409);
          await dbRun("COMMIT");
          return res.json({ ...current, recovered: true });
        }
        if (
          await dbGet(
            "SELECT id FROM refund_transactions r WHERE r.orderId=? AND r.tenant_id=? AND NOT EXISTS(SELECT 1 FROM manual_refunds m WHERE m.id=r.id)",
            [order.id, req.tenantId],
          )
        )
          throw fail(
            "This bill has a legacy refund. Reconcile its allocation before another receipt return.",
            409,
          );
        if (cents > payment.availableCents)
          throw fail(
            "Refund exceeds the remaining amount on this receipt.",
            409,
          );
        if (
          payment.method === "bank" &&
          (await dbGet(
            "SELECT id FROM manual_refunds WHERE tenant_id=? AND reference=? AND method='bank'",
            [req.tenantId, reference],
          ))
        )
          throw fail("Bank refund reference is already recorded.", 409);
        const shift = await dbGet(
          "SELECT id FROM shifts WHERE tenant_id=? AND userId=? AND status='open'",
          [req.tenantId, req.user.id],
        );
        if (payment.method === "cash" && !shift)
          throw fail("Open a cashier shift before returning drawer cash.", 409);
        const settled = order.paymentStatus === "paid",
          now = Date.now();
        await dbRun(
          "INSERT INTO manual_refunds (id,tenant_id,orderId,paymentId,amountCents,method,reference,reason,actorId,shiftId,settled,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            requestId,
            req.tenantId,
            order.id,
            paymentId,
            cents,
            payment.method,
            reference,
            reason,
            req.user.id,
            shift?.id || null,
            settled ? 1 : 0,
            now,
          ],
        );
        if (settled) {
          const refundCents = amountInCents(order.refundedAmount || 0) + cents;
          if (refundCents > current.totalCents)
            throw fail("Refund exceeds the final bill.", 409);
          await dbRun(
            "INSERT INTO refund_transactions (id,orderId,tenant_id,amountCents,reason,actorId,createdAt) VALUES (?,?,?,?,?,?,?)",
            [
              requestId,
              order.id,
              req.tenantId,
              cents,
              reason,
              req.user.id,
              now,
            ],
          );
          const status =
            refundCents === current.totalCents
              ? "refunded"
              : "partially_refunded";
          await dbRun(
            "UPDATE orders SET status=?,refundedAmount=?,voidReason=? WHERE id=? AND tenant_id=?",
            [status, refundCents / 100, reason, order.id, req.tenantId],
          );
          if (status === "refunded" && order.status !== "refunded") {
            const points = Math.floor(order.total / 10);
            if (order.customerId)
              await dbRun(
                "UPDATE customers SET points=MAX(0,points-?) WHERE id=? AND tenant_id=?",
                [points, order.customerId, req.tenantId],
              );
            if (order.customerAccountId)
              await dbRun(
                "UPDATE customer_accounts SET loyaltyPoints=MAX(0,loyaltyPoints-?) WHERE id=? AND tenant_id=?",
                [points, order.customerAccountId, req.tenantId],
              );
          }
        } else {
          const remaining = current.paidCents - cents;
          await dbRun(
            "UPDATE orders SET paymentStatus=? WHERE id=? AND tenant_id=?",
            [remaining ? "partial" : "unpaid", order.id, req.tenantId],
          );
        }
        await writeAuditLog(
          req.user.id,
          req.user.username,
          "manual_refund",
          `Returned ${payment.method} ${cents / 100} from receipt ${paymentId}; refund ${requestId}; ${reason}`,
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
