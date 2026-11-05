import { beforeAll, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
process.env.DATABASE_FILE = path.join(
  os.tmpdir(),
  "daily-" + crypto.randomUUID() + ".db",
);
process.env.JWT_SECRET = "daily-service-tests";
const { app, dbReady, dbRun, dbGet } = await import("../server.js");
const auth = (
  id = "user_admin",
  role = "owner",
  tenant = "default_tenant",
) => ({
  Authorization:
    "Bearer " +
    jwt.sign({ id, role, tenant_id: tenant }, process.env.JWT_SECRET),
});
const post = (url, body, headers = auth()) =>
  request(app)
    .post("/api/" + url)
    .set(headers)
    .send(body);
const get = (url, headers = auth()) =>
  request(app)
    .get("/api/" + url)
    .set(headers);
const key = () => crypto.randomUUID();
async function order(extra = {}) {
  const r = await post("orders", {
    id: key(),
    diningType: "takeaway",
    items: [{ id: "daily_food", quantity: 1 }],
    ...extra,
  });
  expect(r.status, r.text).toBe(200);
  return r.body;
}
async function ticket(id) {
  const r = await get("kitchen/tickets");
  expect(r.status, r.text).toBe(200);
  return r.body.find((x) => x.orderId === id);
}
const pay = (o, amount, extra = {}) =>
  post("manual-payments/" + o.id, {
    requestId: key(),
    method: "cash",
    amount,
    ...extra,
  });
const act = (t, state, lineId) =>
  post("kitchen/tickets/" + t.orderId, { revision: t.revision, state, lineId });
beforeAll(async () => {
  await dbReady;
  await dbRun(
    "INSERT INTO menu_items (id,name,price,stock,tenant_id,isAvailable) VALUES ('daily_food','Food',100,1000,'default_tenant',1),('daily_drink','Drink',50,1000,'default_tenant',1)",
  );
  for (const k of ["taxRate", "serviceChargeRate"])
    await dbRun("UPDATE settings SET value=0 WHERE key=? AND tenant_id=?", [
      k,
      "default_tenant",
    ]);
  await dbRun(
    "INSERT INTO tenants (id,name,subdomain,status,plan,ownerEmail) VALUES ('daily_other','Other','daily-other','active','pro','daily@example.test')",
  );
  await dbRun(
    "INSERT INTO users (id,username,passwordHash,role,tenant_id) VALUES ('daily_other_owner','dailyother','unused','owner','daily_other')",
  );
  expect((await post("shifts/open", { startFloat: 100 })).status).toBe(200);
}, 30000);
it("requires staff authentication and rejects kitchen payment access", async () => {
  expect((await request(app).get("/api/manual-payments")).status).toBe(401);
  expect(
    (await get("manual-payments", auth("user_kitchen", "kitchen"))).status,
  ).toBe(403);
  expect((await request(app).get("/api/kitchen/tickets")).status).toBe(401);
});
it("keeps prepaid food in the kitchen until every line is served", async () => {
  const o = await order();
  expect(
    (await post("orders", { id: o.id, status: "paid", paymentMethod: "cash" }))
      .status,
  ).toBe(200);
  let t = await ticket(o.id);
  expect(t.state).toBe("pending");
  expect(t.paymentStatus).toBe("paid");
  expect((await act(t, "served")).status).toBe(409);
  expect((await act(t, "ready", t.lines[0].id)).status).toBe(409);
  expect((await act(t, "preparing", t.lines[0].id)).status).toBe(200);
  t = await ticket(o.id);
  expect((await act(t, "ready", t.lines[0].id)).status).toBe(200);
  t = await ticket(o.id);
  expect((await act(t, "served")).status).toBe(200);
  expect(await ticket(o.id)).toBeUndefined();
  expect(
    (
      await dbGet("SELECT paymentStatus,invoiceNumber FROM orders WHERE id=?", [
        o.id,
      ])
    ).paymentStatus,
  ).toBe("paid");
});
it("routes explicit station snapshots and rejects stale simultaneous kitchen actions", async () => {
  expect(
    (
      await post("kitchen/routing", {
        menuItemId: "daily_drink",
        station: "bar",
      })
    ).status,
  ).toBe(200);
  const o = await order({
    items: [
      {
        id: "daily_food",
        quantity: 1,
        notes: "Severe peanut allergy — confirm preparation",
      },
      { id: "daily_drink", quantity: 1 },
    ],
  });
  const t = await ticket(o.id);
  expect(t.lines.map((x) => x.station).sort()).toEqual(["bar", "kitchen"]);
  expect(t.lines.some((x) => x.notes.includes("peanut"))).toBe(true);
  await post("kitchen/routing", {
    menuItemId: "daily_drink",
    station: "desserts",
  });
  expect(
    (await ticket(o.id)).lines.find((x) => x.name === "Drink").station,
  ).toBe("bar");
  const results = await Promise.all([
    act(t, "preparing", t.lines[0].id),
    act(t, "preparing", t.lines[0].id),
  ]);
  expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  expect((await act(await ticket(o.id), "served")).status).toBe(409);
});
it("does not overwrite started kitchen work through order edits or old status endpoints", async () => {
  const o = await order();
  let t = await ticket(o.id);
  await act(t, "preparing", t.lines[0].id);
  const r = await request(app)
    .put("/api/orders/" + o.id + "/modify")
    .set(auth())
    .send({ items: [{ id: "daily_food", quantity: 2 }] });
  expect(r.status).toBe(400);
  expect(
    (await dbGet("SELECT total FROM orders WHERE id=?", [o.id])).total,
  ).toBe(100);
  expect((await post("orders", { id: o.id, status: "ready" })).status).toBe(
    409,
  );
});
it("does not infer kitchen tickets for historical paid orders", async () => {
  const id = key();
  await dbRun(
    "INSERT INTO orders (id,tenant_id,status,paymentStatus,total,items,timestamp) VALUES (?,'default_tenant','paid','paid',100,?,?)",
    [
      id,
      JSON.stringify([{ id: "daily_food", name: "Food", quantity: 1 }]),
      Date.now(),
    ],
  );
  expect(await ticket(id)).toBeUndefined();
});
it("isolates payment and kitchen data and routing across owners", async () => {
  const o = await order(),
    foreign = auth("daily_other_owner", "owner", "daily_other");
  expect((await get("manual-payments/" + o.id, foreign)).status).toBe(404);
  expect(
    (
      await post(
        "manual-payments/" + o.id,
        {
          requestId: key(),
          method: "bank",
          amount: 100,
          reference: key(),
          confirmed: true,
        },
        foreign,
      )
    ).status,
  ).toBe(404);
  expect((await get("kitchen/tickets", foreign)).body).toEqual([]);
  expect(
    (
      await post(
        "kitchen/tickets/" + o.id,
        { revision: 1, state: "preparing" },
        foreign,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await post(
        "kitchen/routing",
        { menuItemId: "daily_food", station: "bar" },
        foreign,
      )
    ).status,
  ).toBe(404);
});
it("persists a partial cash receipt once and protects it against changed retries and cancellation", async () => {
  const o = await order(),
    id = key();
  const r = await Promise.all([
    pay(o, 40, { requestId: id }),
    pay(o, 40, { requestId: id }),
  ]);
  expect(r.map((x) => x.status)).toEqual([200, 200]);
  const saved = await get("manual-payments/" + o.id);
  expect(saved.body.paidCents).toBe(4000);
  expect(saved.body.balanceCents).toBe(6000);
  expect(saved.body.payments).toHaveLength(1);
  expect(saved.body.order.paymentStatus).toBe("partial");
  expect(saved.body.order.invoiceNumber).toBeFalsy();
  expect((await pay(o, 41, { requestId: id })).status).toBe(409);
  expect((await post("orders", { id: o.id, status: "cancelled" })).status).toBe(
    409,
  );
  expect(
    (await post("orders/" + o.id + "/reject", { reason: "No food" })).status,
  ).toBe(409);
  expect(
    (await post("orders", { id: o.id, status: "paid", paymentMethod: "cash" }))
      .status,
  ).toBe(409);
  expect(
    (
      await request(app)
        .put("/api/orders/" + o.id + "/modify")
        .set(auth())
        .send({ items: [{ id: "daily_food", quantity: 2 }] })
    ).status,
  ).toBe(409);
});
it("serializes different partial payments and refuses overcollection", async () => {
  const o = await order();
  const r = await Promise.all([pay(o, 60), pay(o, 60)]);
  expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
  expect((await get("manual-payments/" + o.id)).body.balanceCents).toBe(4000);
});
it("requires manager confirmation and unique bank references", async () => {
  const o = await order(),
    ref = key();
  expect((await pay(o, 100, { method: "bank", reference: ref })).status).toBe(
    403,
  );
  expect(
    (
      await post(
        "manual-payments/" + o.id,
        {
          requestId: key(),
          method: "bank",
          reference: ref,
          confirmed: true,
          amount: 100,
        },
        auth("user_cashier", "cashier"),
      )
    ).status,
  ).toBe(403);
  expect(
    (await pay(o, 100, { method: "bank", reference: ref, confirmed: true }))
      .status,
  ).toBe(200);
  const another = await order();
  expect(
    (
      await pay(another, 100, {
        method: "bank",
        reference: ref,
        confirmed: true,
      })
    ).status,
  ).toBe(409);
});
it("settles mixed cash and bank exactly once with a final invoice and visible kitchen ticket", async () => {
  const o = await order();
  await pay(o, 30);
  const id = key(),
    ref = key(),
    body = { requestId: id, method: "bank", reference: ref, confirmed: true };
  const result = await Promise.all([pay(o, 70, body), pay(o, 70, body)]);
  expect(result.map((x) => x.status)).toEqual([200, 200]);
  expect(result[0].body.order.invoiceNumber).toBeTruthy();
  expect(result[0].body.order.invoiceNumber).toBe(
    result[1].body.order.invoiceNumber,
  );
  expect(result[0].body.balanceCents).toBe(0);
  expect(result[0].body.order.paymentMethod).toBe("split");
  expect((await ticket(o.id)).state).toBe("pending");
  expect((await pay(o, 1)).status).toBe(409);
});
it.each([0, -1, 1.001, "NaN"])(
  "rejects invalid partial amount %s",
  async (amount) => {
    const o = await order();
    expect((await pay(o, amount)).status).toBe(400);
  },
);
it("prevents payment-history mutation", async () => {
  const o = await order(),
    r = await pay(o, 10);
  await expect(
    dbRun("UPDATE manual_payments SET amountCents=0 WHERE id=?", [
      r.body.payments[0].id,
    ]),
  ).rejects.toThrow();
  await expect(
    dbRun("DELETE FROM manual_payments WHERE id=?", [r.body.payments[0].id]),
  ).rejects.toThrow();
});
it("keeps prepaid counter delivery dispatchable and requires driver pickup to clear kitchen", async () => {
  const o = await order({ diningType: "delivery" });
  const paid = await pay(o, 100, {
    method: "bank",
    reference: key(),
    confirmed: true,
  });
  expect(paid.status).toBe(200);
  expect(paid.body.order.status).toBe("pending");
  let t = await ticket(o.id);
  await act(t, "preparing", t.lines[0].id);
  t = await ticket(o.id);
  await act(t, "ready", t.lines[0].id);
  t = await ticket(o.id);
  expect((await act(t, "served")).status).toBe(409);
  const driver = await dbGet(
    "SELECT id FROM drivers WHERE tenant_id='default_tenant' LIMIT 1",
  );
  await dbRun("UPDATE orders SET driverId=? WHERE id=?", [driver.id, o.id]);
  const headers = {
    Authorization:
      "Bearer " +
      jwt.sign(
        { driverId: driver.id, role: "driver", tenant_id: "default_tenant" },
        process.env.JWT_SECRET,
      ),
  };
  expect(
    (
      await post(
        "public/driver/status",
        { orderId: o.id, status: "out_for_delivery" },
        headers,
      )
    ).status,
  ).toBe(200);
  expect(await ticket(o.id)).toBeUndefined();
  expect(
    (await dbGet("SELECT paymentStatus FROM orders WHERE id=?", [o.id]))
      .paymentStatus,
  ).toBe("paid");
});
it("rejects foreign ticket lines and unauthorized routing writes", async () => {
  const a = await order(),
    b = await order(),
    ta = await ticket(a.id),
    tb = await ticket(b.id);
  expect((await act(ta, "preparing", tb.lines[0].id)).status).toBe(404);
  expect(
    (
      await post(
        "kitchen/routing",
        { menuItemId: "daily_food", station: "bar" },
        auth("user_kitchen", "kitchen"),
      )
    ).status,
  ).toBe(403);
});
it("returns saved menu identities and modifiers when recalling a ticket", async () => {
  await dbRun(
    "INSERT INTO modifiers (id,menuItemId,name,priceDelta,tenant_id) VALUES ('daily_extra','daily_food','Extra',20,'default_tenant')",
  );
  const o = await order({
    status: "hold",
    items: [
      {
        id: "daily_food",
        quantity: 1,
        selectedModifiers: [{ id: "daily_extra" }],
      },
    ],
  });
  const rows = await get("orders");
  const saved = rows.body.find((x) => x.id === o.id);
  expect(saved.items[0].id).toBe("daily_food");
  expect(saved.items[0].selectedModifiers[0].id).toBe("daily_extra");
  expect(saved.items[0].unitPrice).toBe(120);
});
it("attributes split cash receipts to each collecting cashier shift", async () => {
  const staff = auth("user_cashier", "cashier");
  expect((await post("shifts/open", { startFloat: 50 }, staff)).status).toBe(
    200,
  );
  const o = await order();
  await pay(o, 40);
  expect(
    (
      await post(
        "manual-payments/" + o.id,
        { requestId: key(), method: "cash", amount: 60 },
        staff,
      )
    ).status,
  ).toBe(200);
  const response = await post("shifts/close", { actualCash: 110 }, staff);
  expect(response.status, response.text).toBe(200);
  const shift = await dbGet(
    "SELECT * FROM shifts WHERE userId='user_cashier' ORDER BY startTime DESC LIMIT 1",
  );
  expect(shift.expectedCash).toBe(110);
  const summary = await get("shifts/summary/" + shift.id, staff);
  expect(summary.body.stats.cashSales).toBe(60);
});
it("counts partial cash in its original shift and excludes bank receipts and later double settlement", async () => {
  const all = await dbGet(
    "SELECT COALESCE(SUM(amountCents),0) AS cents FROM manual_payments WHERE actorId='user_admin' AND method='cash'",
  );
  const legacy = await dbGet(
    "SELECT COALESCE(SUM(total),0) AS amount FROM orders WHERE paymentStatus='paid' AND cashierId='user_admin' AND paymentMethod='cash' AND NOT EXISTS(SELECT 1 FROM manual_payments m WHERE m.orderId=orders.id)",
  );
  const r = await post("shifts/close", {
    actualCash: 100 + all.cents / 100 + legacy.amount,
  });
  expect(r.status, r.text).toBe(200);
  const shift = await dbGet(
    "SELECT expectedCash FROM shifts WHERE userId='user_admin' ORDER BY startTime DESC LIMIT 1",
  );
  expect(shift.expectedCash).toBe(100 + all.cents / 100 + legacy.amount);
  const o = await order();
  expect((await pay(o, 10)).status).toBe(409);
});

it("does not free a paid dine-in table before its food is served", async () => {
  const tableId = key();
  await dbRun(
    "INSERT INTO tables (id,number,capacity,status,tenant_id) VALUES (?,91,2,'free','default_tenant')",
    [tableId],
  );
  const o = await order({ diningType: "dine-in", tableId });
  await post("orders", { id: o.id, status: "paid", paymentMethod: "cash" });
  expect(
    (await dbGet("SELECT currentOrderId FROM tables WHERE id=?", [tableId]))
      .currentOrderId,
  ).toBe(o.id);
  let t = await ticket(o.id);
  await act(t, "preparing", t.lines[0].id);
  t = await ticket(o.id);
  await act(t, "ready", t.lines[0].id);
  await act(await ticket(o.id), "served");
  expect(
    await dbGet("SELECT currentOrderId,status FROM tables WHERE id=?", [
      tableId,
    ]),
  ).toEqual({ currentOrderId: null, status: "free" });
});
it("rejects simultaneous new bills claiming the same table", async () => {
  const tableId = key();
  await dbRun(
    "INSERT INTO tables (id,number,capacity,status,tenant_id) VALUES (?,92,2,'free','default_tenant')",
    [tableId],
  );
  const intent = () =>
    post("orders", {
      id: key(),
      diningType: "dine-in",
      tableId,
      items: [{ id: "daily_food", quantity: 1 }],
    });
  const results = await Promise.all([intent(), intent()]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
});
