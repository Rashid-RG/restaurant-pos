import { beforeAll, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { convertStock } from "../routes/inventory-operations.js";
process.env.DATABASE_FILE = path.join(
  os.tmpdir(),
  `inventory-ops-${crypto.randomUUID()}.db`,
);
process.env.JWT_SECRET = "inventory-ops-test";
const { app, dbReady, dbRun, dbGet } = await import("../server.js");
const auth = (tenant = "inv_A", role = "owner") => ({
  Authorization:
    "Bearer " +
    jwt.sign(
      { id: tenant + "_" + role, role, tenant_id: tenant },
      process.env.JWT_SECRET,
    ),
});
const post = (path, body, tenant = "inv_A", role = "owner") =>
  request(app)
    .post("/api/" + path)
    .set(auth(tenant, role))
    .send(body);
const key = () => crypto.randomUUID();
let supplier, foreignSupplier;
const purchase = async (extra = {}) => {
  const result = await post("inventory/purchases", {
    requestId: key(),
    supplierId: supplier.id,
    lines: [{ ingredientId: "rice_A", quantity: 2, unit: "kg", unitCost: 200 }],
    ...extra,
  });
  expect(result.status, result.text).toBe(200);
  return result.body;
};
const stock = async () =>
  dbGet("SELECT stock,costPerUnit FROM ingredients WHERE id='rice_A'");
const startCount = async () => {
  const response = await post("inventory/counts", {
    requestId: key(),
    items: [{ resourceType: "ingredient", resourceId: "rice_A" }],
    notes: "Physical count test",
  });
  expect(response.status, response.text).toBe(200);
  return (
    await request(app).get("/api/inventory/counts").set(auth())
  ).body.find((row) => row.id === response.body.id);
};
beforeAll(async () => {
  await dbReady;
  for (const tenant of ["inv_A", "inv_B"]) {
    await dbRun(
      "INSERT INTO tenants (id,name,subdomain,status,ownerEmail) VALUES (?,?,?,?,?)",
      [tenant, tenant, tenant, "active", "owner@example.test"],
    );
    for (const role of ["owner", "cashier"])
      await dbRun(
        "INSERT INTO users (id,username,role,tenant_id) VALUES (?,?,?,?)",
        [tenant + "_" + role, tenant + "_" + role, role, tenant],
      );
  }
  await dbRun(
    "INSERT INTO ingredients (id,name,unit,costPerUnit,stock,minStock,tenant_id) VALUES ('rice_A','Rice','g',0.1,1000,100,'inv_A'),('rice_B','Foreign rice','kg',10,20,2,'inv_B')",
  );
  supplier = (
    await post("inventory/suppliers", {
      name: "Local Supplier",
      email: "supplier@example.test",
    })
  ).body;
  foreignSupplier = (
    await post("inventory/suppliers", { name: "Foreign Supplier" }, "inv_B")
  ).body;
}, 30000);
it.each([
  ["g", "kg", 1000, 1],
  ["kg", "g", 1.5, 1500],
  ["ml", "L", 500, 0.5],
  ["pcs", "pcs", 3, 3],
])("converts compatible %s/%s quantities", async (from, to, quantity, result) =>
  expect(convertStock(quantity, from, to)).toBe(result),
);
it("rejects incompatible purchase units", async () =>
  expect(() => convertStock(1, "L", "g")).toThrow(/same thing/));
it.each([
  "/inventory/purchases",
  "/inventory/counts",
  "/inventory/activity",
  "/inventory/movements",
  "/inventory/suppliers",
])("requires an authorized staff identity at %s", async (path) => {
  expect((await request(app).get("/api" + path)).status).toBe(401);
  expect(
    (
      await request(app)
        .get("/api" + path)
        .set(auth("inv_A", "cashier"))
    ).status,
  ).toBe(403);
});
it("records a supplier and rejects invalid supplier details", async () => {
  expect(supplier.id).toBeTruthy();
  expect(
    (await post("inventory/suppliers", { name: "Bad", email: "invalid" }))
      .status,
  ).toBe(400);
  const response = await request(app)
    .get("/api/inventory/suppliers")
    .set(auth());
  expect(response.body.some((row) => row.id === foreignSupplier.id)).toBe(
    false,
  );
});
it("creates a tenant-scoped purchase snapshot without changing stock", async () => {
  const before = await stock(),
    order = await purchase();
  expect(order.lines[0].baseUnit).toBe("g");
  expect(order.totalCents).toBe(40000);
  expect(await stock()).toEqual(before);
  expect(
    (
      await request(app)
        .get("/api/inventory/purchases/" + order.id)
        .set(auth("inv_B"))
    ).status,
  ).toBe(404);
});
it("replays purchase creation instead of making a duplicate order", async () => {
  const requestId = key(),
    body = {
      requestId,
      supplierId: supplier.id,
      reference: "retry-po",
      lines: [
        { ingredientId: "rice_A", quantity: 2, unit: "kg", unitCost: 200 },
      ],
    };
  const responses = await Promise.all([
    post("inventory/purchases", body),
    post("inventory/purchases", body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(responses[0].body.id).toBe(responses[1].body.id);
  expect(
    (await post("inventory/purchases", { ...body, reference: "changed" }))
      .status,
  ).toBe(409);
});
it.each([
  { supplierId: () => foreignSupplier.id },
  {
    lines: [{ ingredientId: "rice_B", quantity: 1, unit: "kg", unitCost: 20 }],
  },
  {
    lines: [{ ingredientId: "rice_A", quantity: -1, unit: "g", unitCost: 20 }],
  },
  { lines: [{ ingredientId: "rice_A", quantity: 1, unit: "L", unitCost: 20 }] },
  {
    lines: [
      { ingredientId: "rice_A", quantity: 1, unit: "g", unitCost: 0.001 },
    ],
  },
])("rejects invalid or foreign purchase contents (%#)", async (invalid) => {
  const body = {
    requestId: key(),
    supplierId: supplier.id,
    lines: [{ ingredientId: "rice_A", quantity: 1, unit: "g", unitCost: 20 }],
    ...invalid,
  };
  if (typeof body.supplierId === "function")
    body.supplierId = body.supplierId();
  expect([400, 404]).toContain(
    (await post("inventory/purchases", body)).status,
  );
});
it("receives a partial delivery once, converts units and updates weighted cost", async () => {
  const before = await stock(),
    order = await purchase(),
    body = {
      requestId: key(),
      reference: "packing-slip-1",
      lines: [{ lineId: order.lines[0].id, quantity: 1 }],
    };
  const responses = await Promise.all([
    post(`inventory/purchases/${order.id}/receive`, body),
    post(`inventory/purchases/${order.id}/receive`, body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(responses[0].body.operationId).toBe(responses[1].body.operationId);
  expect(responses[0].body.status).toBe("part_received");
  const after = await stock();
  expect(after.stock).toBe(before.stock + 1000);
  expect(after.costPerUnit).toBeCloseTo(
    (before.stock * before.costPerUnit + 200) / (before.stock + 1000),
    5,
  );
  const saved = (
    await request(app)
      .get("/api/inventory/purchases/" + order.id)
      .set(auth())
  ).body;
  expect(saved.lines[0].receivedQuantity).toBe(1);
  expect(
    (
      await post(`inventory/purchases/${order.id}/receive`, {
        ...body,
        lines: [{ lineId: order.lines[0].id, quantity: 0.5 }],
      })
    ).status,
  ).toBe(409);
});
it("rejects over-receiving and finalizes a fully received purchase", async () => {
  const order = await purchase(),
    before = await stock();
  expect(
    (
      await post(`inventory/purchases/${order.id}/receive`, {
        requestId: key(),
        lines: [{ lineId: order.lines[0].id, quantity: 3 }],
      })
    ).status,
  ).toBe(409);
  expect(await stock()).toEqual(before);
  const response = await post(`inventory/purchases/${order.id}/receive`, {
    requestId: key(),
    lines: [{ lineId: order.lines[0].id, quantity: 2 }],
  });
  expect(response.status, response.text).toBe(200);
  expect(response.body.status).toBe("received");
  expect(
    (await post(`inventory/purchases/${order.id}/cancel`, {})).status,
  ).toBe(409);
});
it("rolls back every receipt line if a later ingredient is unavailable", async () => {
  await dbRun(
    "INSERT INTO ingredients (id,name,unit,costPerUnit,stock,tenant_id) VALUES ('other_A','Other','kg',10,20,'inv_A')",
  );
  const order = await purchase({
    lines: [
      { ingredientId: "rice_A", quantity: 1, unit: "kg", unitCost: 200 },
      { ingredientId: "other_A", quantity: 1, unit: "kg", unitCost: 10 },
    ],
  });
  await dbRun("UPDATE ingredients SET unit='L' WHERE id='other_A'");
  const before = await stock(),
    response = await post(`inventory/purchases/${order.id}/receive`, {
      requestId: key(),
      lines: order.lines.map((line) => ({ lineId: line.id, quantity: 1 })),
    });
  expect(response.status).toBe(409);
  expect(await stock()).toEqual(before);
  const saved = (
    await request(app)
      .get("/api/inventory/purchases/" + order.id)
      .set(auth())
  ).body;
  expect(saved.lines.every((line) => line.receivedQuantity === 0)).toBe(true);
});
it("cancels remaining quantities without reversing stock already received", async () => {
  const order = await purchase();
  await post(`inventory/purchases/${order.id}/receive`, {
    requestId: key(),
    lines: [{ lineId: order.lines[0].id, quantity: 1 }],
  });
  const before = await stock();
  expect(
    (await post(`inventory/purchases/${order.id}/cancel`, {})).status,
  ).toBe(200);
  expect(await stock()).toEqual(before);
  expect(
    (
      await post(`inventory/purchases/${order.id}/receive`, {
        requestId: key(),
        lines: [{ lineId: order.lines[0].id, quantity: 1 }],
      })
    ).status,
  ).toBe(409);
});
it("does not reveal another restaurant purchase through receiving", async () => {
  const order = await purchase();
  expect(
    (
      await post(
        `inventory/purchases/${order.id}/receive`,
        {
          requestId: key(),
          lines: [{ lineId: order.lines[0].id, quantity: 1 }],
        },
        "inv_B",
      )
    ).status,
  ).toBe(404);
});
it("reconciles physical stock once on a count completion retry", async () => {
  const count = await startCount(),
    before = await stock(),
    body = {
      requestId: key(),
      lines: [{ lineId: count.lines[0].id, quantity: before.stock - 5 }],
    };
  const responses = await Promise.all([
    post(`inventory/counts/${count.id}/complete`, body),
    post(`inventory/counts/${count.id}/complete`, body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect((await stock()).stock).toBe(before.stock - 5);
  expect(responses[0].body.operationId).toBe(responses[1].body.operationId);
});
it("detects concurrent stock changes rather than overwriting them during a count", async () => {
  const count = await startCount();
  await dbRun("UPDATE ingredients SET stock=stock+1 WHERE id='rice_A'");
  const before = await stock();
  expect(
    (
      await post(`inventory/counts/${count.id}/complete`, {
        requestId: key(),
        lines: [
          {
            lineId: count.lines[0].id,
            quantity: count.lines[0].expectedQuantity,
          },
        ],
      })
    ).status,
  ).toBe(409);
  expect(await stock()).toEqual(before);
  expect((await post(`inventory/counts/${count.id}/cancel`, {})).status).toBe(
    200,
  );
});
it("rejects missing count lines and cross-restaurant stock counts", async () => {
  const count = await startCount();
  expect(
    (
      await post(`inventory/counts/${count.id}/complete`, {
        requestId: key(),
        lines: [],
      })
    ).status,
  ).toBe(400);
  expect(
    (await post(`inventory/counts/${count.id}/cancel`, {}, "inv_B")).status,
  ).toBe(404);
  expect(
    (
      await post("inventory/counts", {
        requestId: key(),
        items: [{ resourceType: "ingredient", resourceId: "rice_B" }],
      })
    ).status,
  ).toBe(404);
});
it("logs waste once, preserves its reason and rejects stock shortages", async () => {
  const before = await stock(),
    body = {
      requestId: key(),
      ingredientId: "rice_A",
      quantity: 5,
      reason: "Spoiled during preparation",
    };
  const responses = await Promise.all([
    post("inventory/waste", body),
    post("inventory/waste", body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect((await stock()).stock).toBe(before.stock - 5);
  expect(
    (
      await post("inventory/waste", {
        ...body,
        requestId: key(),
        quantity: 100000,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post("inventory/waste", {
        ...body,
        requestId: key(),
        ingredientId: "rice_B",
      })
    ).status,
  ).toBe(404);
  const history = (
    await request(app).get("/api/inventory/activity").set(auth())
  ).body;
  expect(history.some((row) => row.reason === body.reason)).toBe(true);
});
it("preserves stock and operation history as append-only records", async () => {
  await expect(
    dbRun("DELETE FROM inventory_movements WHERE tenant_id='inv_A'"),
  ).rejects.toThrow(/append-only/);
  await expect(
    dbRun(
      "UPDATE inventory_operations SET reason='Erased' WHERE tenant_id='inv_A'",
    ),
  ).rejects.toThrow(/append-only/);
});
it("updates ingredient metadata without deleting recipes and records opening stock", async () => {
  await dbRun(
    "INSERT INTO menu_items (id,name,price,stock,tenant_id) VALUES ('recipe_menu_A','Recipe item',10,10,'inv_A')",
  );
  await dbRun(
    "INSERT INTO recipes (id,menuItemId,ingredientId,quantityRequired,tenant_id) VALUES ('recipe_preserved','recipe_menu_A','rice_A',10,'inv_A')",
  );
  const before = await stock();
  const response = await post("ingredients", {
    id: "rice_A",
    name: "Rice updated",
    unit: "g",
    costPerUnit: 0.2,
    stock: before.stock,
    minStock: 100,
  });
  expect(response.status, response.text).toBe(200);
  expect(
    await dbGet("SELECT id FROM recipes WHERE id='recipe_preserved'"),
  ).toBeTruthy();
  expect(
    (
      await post("ingredients", {
        id: "rice_A",
        name: "Rice",
        unit: "kg",
        costPerUnit: 10,
        stock: before.stock,
        minStock: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post("ingredients", {
        name: "Bad stock",
        unit: "kg",
        costPerUnit: 10,
        stock: -1,
        minStock: 1,
      })
    ).status,
  ).toBe(400);
});
it("reconciles counted menu stock and rejects untracked menu items", async () => {
  await dbRun(
    "INSERT INTO menu_items (id,name,price,cost,stock,tenant_id) VALUES ('count_menu_A','Count menu',100,20,10,'inv_A'),('untracked_menu_A','Untracked',100,20,NULL,'inv_A')",
  );
  const created = await post("inventory/counts", {
    requestId: key(),
    items: [{ resourceType: "menu", resourceId: "count_menu_A" }],
  });
  expect(created.status).toBe(200);
  const line = await dbGet("SELECT * FROM stock_count_lines WHERE countId=?", [
    created.body.id,
  ]);
  const completed = await post(`inventory/counts/${created.body.id}/complete`, {
    requestId: key(),
    lines: [{ lineId: line.id, quantity: 7 }],
  });
  expect(completed.status).toBe(200);
  expect(completed.body.varianceCents).toBe(-6000);
  expect(
    (await dbGet("SELECT stock FROM menu_items WHERE id='count_menu_A'")).stock,
  ).toBe(7);
  expect(
    (
      await post("inventory/counts", {
        requestId: key(),
        items: [{ resourceType: "menu", resourceId: "untracked_menu_A" }],
      })
    ).status,
  ).toBe(409);
});
it("replays supplier creation with the same private operation ID", async () => {
  const body = {
    requestId: key(),
    name: "Retry supplier",
    phone: "0770000000",
  };
  const first = await post("inventory/suppliers", body),
    second = await post("inventory/suppliers", body);
  expect(first.status).toBe(200);
  expect(second.body.id).toBe(first.body.id);
  expect(
    (await post("inventory/suppliers", { ...body, name: "Changed supplier" }))
      .status,
  ).toBe(409);
});
it("edits a recipe using only the restaurant ingredients and exposes live ingredient cost", async () => {
  const body = {
    requestId: key(),
    lines: [{ ingredientId: "rice_A", quantity: 10 }],
  };
  const result = await post("inventory/recipes/recipe_menu_A", body);
  expect(result.status, result.text).toBe(200);
  const recipe = (
    await request(app).get("/api/inventory/recipes/recipe_menu_A").set(auth())
  ).body;
  expect(recipe.lines).toHaveLength(1);
  expect(recipe.costCents).toBe(200);
  expect(
    (
      await post("inventory/recipes/recipe_menu_A", {
        ...body,
        requestId: key(),
        lines: [{ ingredientId: "rice_B", quantity: 1 }],
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get("/api/inventory/recipes/recipe_menu_A")
        .set(auth("inv_B"))
    ).status,
  ).toBe(404);
  expect(
    (
      await post("inventory/recipes/recipe_menu_A", {
        ...body,
        requestId: key(),
        lines: [
          { ingredientId: "rice_A", quantity: 1 },
          { ingredientId: "rice_A", quantity: 2 },
        ],
      })
    ).status,
  ).toBe(400);
  expect((await post("inventory/recipes/recipe_menu_A", body)).status).toBe(
    200,
  );
});
it("preserves recipe relationships when menu metadata is edited", async () => {
  const before = await dbGet(
    "SELECT id FROM recipes WHERE menuItemId='recipe_menu_A'",
  );
  const response = await post("menu_items", {
    id: "recipe_menu_A",
    name: "Updated recipe menu",
    price: 120,
    cost: 2,
    stock: 10,
    minStock: 1,
    isAvailable: 1,
  });
  expect(response.status, response.text).toBe(200);
  expect(
    await dbGet("SELECT id FROM recipes WHERE id=?", [before.id]),
  ).toBeTruthy();
});
it("does not overwrite later ingredient consumption when an opening-stock response is retried", async () => {
  const body = {
    id: "opening_retry_A",
    requestId: key(),
    name: "Opening stock",
    unit: "kg",
    costPerUnit: 10,
    stock: 20,
    minStock: 2,
  };
  expect((await post("ingredients", body)).status).toBe(200);
  await dbRun("UPDATE ingredients SET stock=17 WHERE id='opening_retry_A'");
  const replay = await post("ingredients", body);
  expect(replay.status).toBe(200);
  expect(
    (await dbGet("SELECT stock FROM ingredients WHERE id='opening_retry_A'"))
      .stock,
  ).toBe(17);
});
