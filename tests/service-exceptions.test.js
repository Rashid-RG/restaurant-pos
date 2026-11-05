import { beforeAll, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
process.env.DATABASE_FILE = path.join(
  os.tmpdir(),
  "exceptions-" + crypto.randomUUID() + ".db",
);
process.env.JWT_SECRET = "exception-tests";
const { app, dbReady, dbRun, dbGet } = await import("../server.js");
const key = () => crypto.randomUUID();
const auth = (
  id = "user_admin",
  role = "owner",
  tenant = "default_tenant",
) => ({
  Authorization:
    "Bearer " +
    jwt.sign({ id, role, tenant_id: tenant }, process.env.JWT_SECRET),
});
const post = (p, b, h = auth()) =>
  request(app)
    .post("/api/" + p)
    .set(h)
    .send(b);
const get = (p, h = auth()) =>
  request(app)
    .get("/api/" + p)
    .set(h);
async function order() {
  const r = await post("orders", {
    id: key(),
    diningType: "takeaway",
    items: [{ id: "ex_food", quantity: 1 }],
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
const pay = (o, amount, extra = {}) =>
  post("manual-payments/" + o.id, {
    requestId: key(),
    method: "cash",
    amount,
    ...extra,
  });
const ret = (o, paymentId, amount, extra = {}, headers = auth()) =>
  post(
    "manual-payments/" + o.id + "/refunds",
    {
      requestId: key(),
      paymentId,
      amount,
      confirmed: true,
      reason: "Customer requested return",
      ...extra,
    },
    headers,
  );
const summary = async (o) => (await get("manual-payments/" + o.id)).body;
const ticket = async (o) =>
  (await get("kitchen/tickets")).body.find((t) => t.orderId === o.id);
async function start(o) {
  const t = await ticket(o);
  expect(
    (
      await post("kitchen/tickets/" + o.id, {
        revision: t.revision,
        state: "preparing",
        lineId: t.lines[0].id,
      })
    ).status,
  ).toBe(200);
  return ticket(o);
}
const change = (o, t, extra = {}) =>
  post("service-exceptions/" + o.id, {
    requestId: key(),
    revision: t.revision,
    action: "replace",
    reason: "Customer changed the whole ticket",
    discardPreparedBatch: true,
    items: [{ id: "ex_food", quantity: 2 }],
    ...extra,
  });
const stock = async () =>
  (await dbGet("SELECT stock FROM menu_items WHERE id='ex_food'")).stock;
beforeAll(async () => {
  await dbReady;
  await dbRun(
    "INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('ex_food','Exception meal',100,1000,'default_tenant',1)",
  );
  for (const k of ["taxRate", "serviceChargeRate"])
    await dbRun("UPDATE settings SET value=0 WHERE key=? AND tenant_id=?", [
      k,
      "default_tenant",
    ]);
  await dbRun(
    "INSERT INTO tenants (id,name,subdomain,ownerEmail,status) VALUES ('exception_other','Other','exception-other','other@example.test','active')",
  );
  await dbRun(
    "INSERT INTO users (id,username,passwordHash,role,tenant_id) VALUES ('ex_other_owner','exother','fixture','owner','exception_other')",
  );
  expect((await post("shifts/open", { startFloat: 1000 })).status).toBe(200);
}, 30000);
it("returns a partial receipt once and settles only net collected money", async () => {
  const o = await order(),
    paid = await pay(o, 40),
    id = paid.body.payments[0].id,
    refundId = key();
  const results = await Promise.all([
    ret(o, id, 40, { requestId: refundId }),
    ret(o, id, 40, { requestId: refundId }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  let saved = await summary(o);
  expect(saved.paidCents).toBe(0);
  expect(saved.balanceCents).toBe(10000);
  expect(saved.order.paymentStatus).toBe("unpaid");
  expect(saved.refunds[0].settled).toBe(0);
  expect((await ret(o, id, 1)).status).toBe(409);
  expect((await pay(o, 100)).status).toBe(200);
  saved = await summary(o);
  expect(saved.order.paymentStatus).toBe("paid");
  expect(saved.paidCents).toBe(10000);
  expect(JSON.parse(saved.order.paymentSplit)).toEqual([
    { method: "cash", amount: 100 },
  ]);
});
it("rejects changed refund retries, missing confirmation and unauthorized cashiers", async () => {
  const o = await order(),
    p = (await pay(o, 20)).body.payments[0],
    id = key();
  expect((await ret(o, p.id, 10, { confirmed: false })).status).toBe(400);
  expect(
    (await ret(o, p.id, 10, {}, auth("user_cashier", "cashier"))).status,
  ).toBe(403);
  expect((await ret(o, p.id, 10, { requestId: id })).status).toBe(200);
  expect((await ret(o, p.id, 11, { requestId: id })).status).toBe(409);
});
it("serializes competing refunds within the receipt amount", async () => {
  const o = await order(),
    p = (await pay(o, 100)).body.payments[0];
  const results = await Promise.all([ret(o, p.id, 60), ret(o, p.id, 60)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await summary(o)).order.refundedAmount).toBe(60);
});
it("handles mixed cash/bank refunds by original receipt without changing stock", async () => {
  const o = await order();
  await pay(o, 30);
  const paid = await pay(o, 70, {
      method: "bank",
      reference: key(),
      confirmed: true,
    }),
    cash = paid.body.payments.find((p) => p.method === "cash"),
    bank = paid.body.payments.find((p) => p.method === "bank"),
    before = await stock();
  expect((await ret(o, bank.id, 70)).status).toBe(400);
  expect((await ret(o, bank.id, 70, { reference: key() })).status).toBe(200);
  expect((await ret(o, cash.id, 30)).status).toBe(200);
  const saved = await summary(o);
  expect(saved.order.status).toBe("refunded");
  expect(saved.order.refundedAmount).toBe(100);
  expect(saved.balanceCents).toBe(0);
  expect(await stock()).toBe(before);
  expect(await ticket(o)).toBeTruthy();
  expect(
    (
      await post("orders/" + o.id + "/refund", {
        refundAmount: 1,
        refundId: key(),
        reason: "Again",
      })
    ).status,
  ).toBe(409);
});
it("rejects foreign payment IDs and cross-tenant refund access", async () => {
  const a = await order(),
    b = await order(),
    p = (await pay(a, 20)).body.payments[0];
  expect((await ret(b, p.id, 10)).status).toBe(404);
  expect(
    (
      await ret(
        a,
        p.id,
        10,
        {},
        auth("ex_other_owner", "owner", "exception_other"),
      )
    ).status,
  ).toBe(404);
});
it("rejects reused bank refund references", async () => {
  const a = await order(),
    b = await order(),
    ref = key(),
    pa = (
      await pay(a, 100, { method: "bank", reference: key(), confirmed: true })
    ).body.payments[0],
    pb = (
      await pay(b, 100, { method: "bank", reference: key(), confirmed: true })
    ).body.payments[0];
  expect((await ret(a, pa.id, 10, { reference: ref })).status).toBe(200);
  expect((await ret(b, pb.id, 10, { reference: ref })).status).toBe(409);
});
it("replaces unprepared food by returning unused stock then reserving the new bill", async () => {
  const o = await order(),
    before = await stock(),
    t = await ticket(o);
  expect((await change(o, t, { discardPreparedBatch: false })).status).toBe(
    200,
  );
  expect(await stock()).toBe(before - 1);
  expect(
    (await dbGet("SELECT total FROM orders WHERE id=?", [o.id])).total,
  ).toBe(200);
});
it("replaces the prepared batch without restoring consumed stock and replays once", async () => {
  const o = await order(),
    t = await start(o),
    before = await stock(),
    requestId = key();
  expect((await change(o, t, { discardPreparedBatch: false })).status).toBe(
    400,
  );
  const results = await Promise.all([
    change(o, t, { requestId }),
    change(o, t, { requestId }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(await stock()).toBe(before - 2);
  expect((await ticket(o)).state).toBe("pending");
  const audit = await dbGet(
    "SELECT beforeState FROM service_exceptions WHERE id=?",
    [requestId],
  );
  expect(JSON.parse(audit.beforeState).preparedBatchDiscarded).toBe(true);
  expect(JSON.parse(audit.beforeState).inventory.requirements).toContain(
    "ex_food",
  );
  expect(
    (await change(o, t, { requestId, reason: "Different reason" })).status,
  ).toBe(409);
});
it("rolls back every amendment on replacement shortage", async () => {
  const o = await order(),
    t = await start(o),
    before = await stock();
  const result = await change(o, t, {
    items: [{ id: "ex_food", quantity: 1000 }],
  });
  expect(result.status, result.text).toBe(400);
  expect(await stock()).toBe(before);
  expect((await ticket(o)).state).toBe("preparing");
  expect(
    (await dbGet("SELECT total FROM orders WHERE id=?", [o.id])).total,
  ).toBe(100);
});
it("blocks stale changes and unpaid edits with outstanding receipts", async () => {
  const o = await order(),
    old = await ticket(o),
    t = await start(o);
  expect((await change(o, old)).status).toBe(409);
  await pay(o, 10);
  expect((await change(o, t)).status).toBe(409);
});
it("cancels prepared food without returning stock and rejects legacy cancellation bypass", async () => {
  const o = await order(),
    t = await start(o),
    before = await stock();
  expect((await post("orders", { id: o.id, status: "cancelled" })).status).toBe(
    409,
  );
  expect(
    (await post("orders/" + o.id + "/reject", { reason: "Kitchen change" }))
      .status,
  ).toBe(409);
  expect((await change(o, t, { action: "cancel" })).status).toBe(200);
  expect(await stock()).toBe(before);
  expect(
    (await dbGet("SELECT status FROM orders WHERE id=?", [o.id])).status,
  ).toBe("cancelled");
});
it("permits explicit cancellation of a fully refunded ticket and preserves its financial state", async () => {
  const o = await order(),
    p = (await pay(o, 100)).body.payments[0];
  await ret(o, p.id, 100);
  const t = await ticket(o),
    before = await stock();
  expect(
    (await change(o, t, { action: "cancel", discardPreparedBatch: false }))
      .status,
  ).toBe(200);
  expect(await stock()).toBe(before + 1);
  expect(
    (await dbGet("SELECT status FROM orders WHERE id=?", [o.id])).status,
  ).toBe("refunded");
  expect(await ticket(o)).toBeUndefined();
});
it("enforces manager ownership for amendments and immutable history", async () => {
  const o = await order(),
    t = await ticket(o);
  expect(
    (
      await post(
        "service-exceptions/" + o.id,
        {
          requestId: key(),
          revision: t.revision,
          action: "cancel",
          reason: "Test cancellation",
        },
        auth("user_cashier", "cashier"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        "service-exceptions/" + o.id,
        {
          requestId: key(),
          revision: t.revision,
          action: "cancel",
          reason: "Test cancellation",
        },
        auth("ex_other_owner", "owner", "exception_other"),
      )
    ).status,
  ).toBe(404);
  await expect(dbRun("DELETE FROM service_exceptions")).rejects.toThrow();
  await expect(
    dbRun("UPDATE manual_refunds SET amountCents=1"),
  ).rejects.toThrow();
});
it("reconciles cash returns separately from bank refunds at shift close", async () => {
  const receipt = await dbGet(
      "SELECT SUM(amountCents) AS cents FROM manual_payments WHERE method='cash'",
    ),
    returned = await dbGet(
      "SELECT SUM(amountCents) AS cents FROM manual_refunds WHERE method='cash'",
    );
  const expected = 1000 + (receipt.cents - returned.cents) / 100;
  const close = await post("shifts/close", { actualCash: expected });
  expect(close.status, close.text).toBe(200);
  expect(close.body.expectedCash).toBe(expected);
  const report = await get("shifts/summary/" + close.body.id);
  expect(report.body.stats.cashRefunds).toBe(returned.cents / 100);
  expect(report.body.stats.bankRefunds).toBeGreaterThan(0);
});
