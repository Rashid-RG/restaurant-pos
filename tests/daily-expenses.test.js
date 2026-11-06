import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_FILE = path.join(os.tmpdir(), `expenses_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'expenses-integration-test-secret';

const { app, dbReady, dbRun, dbGet } = await import('../server.js');

const token = (id, tenant_id = 'default_tenant', extra = {}) =>
  jwt.sign({ id, tenant_id, role: 'owner', ...extra }, process.env.JWT_SECRET);

const auth = value => ({ Authorization: `Bearer ${value}` });
const platformOwner = () => auth(token('user_admin'));
const tenantAuth = tenantId => auth(token(`user_${tenantId}`, tenantId));

beforeAll(async () => {
  await dbReady;
  await dbRun("INSERT OR IGNORE INTO tenants (id, name, subdomain, ownerEmail, plan, status, createdAt) VALUES ('tenant_expense_test', 'Expense Test Bistro', 'expense-test', 'exp@test.com', 'basic', 'active', ?)", [Date.now()]);
  await dbRun("INSERT OR IGNORE INTO users (id, username, passwordHash, role, tenant_id) VALUES ('user_tenant_expense_test', 'exp_owner', 'fakehash', 'owner', 'tenant_expense_test')");
}, 30000);

describe('Daily Expenses Management & Summary', () => {
  const testTenant = 'tenant_expense_test';
  const testDate = '2026-11-06';

  it('rejects recording an expense with zero or negative amount', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set(tenantAuth(testTenant))
      .send({ date: testDate, category: 'Ingredients', amount: -50, paymentMethod: 'cash' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
  });

  it('successfully creates a daily expense', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set(tenantAuth(testTenant))
      .send({
        date: testDate,
        category: 'Ingredients',
        amount: 2500,
        paymentMethod: 'cash',
        notes: 'Vegetables and spices'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.expense.amount).toBe(2500);
    expect(res.body.expense.category).toBe('Ingredients');
  });

  it('lists expenses for the specified date', async () => {
    const res = await request(app)
      .get(`/api/expenses?date=${testDate}`)
      .set(tenantAuth(testTenant));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].category).toBe('Ingredients');
  });

  it('calculates the daily summary correctly', async () => {
    const res = await request(app)
      .get(`/api/expenses/summary?date=${testDate}`)
      .set(tenantAuth(testTenant));

    expect(res.status).toBe(200);
    expect(res.body.totalExpenses).toBe(2500);
    expect(res.body.expenseCount).toBe(1);
    expect(Array.isArray(res.body.categoryBreakdown)).toBe(true);
    expect(res.body.categoryBreakdown[0].category).toBe('Ingredients');
  });

  it('deletes an expense successfully', async () => {
    const list = await request(app)
      .get(`/api/expenses?date=${testDate}`)
      .set(tenantAuth(testTenant));

    const expenseId = list.body[0].id;
    const deleteRes = await request(app)
      .delete(`/api/expenses/${expenseId}`)
      .set(tenantAuth(testTenant));

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const checkList = await request(app)
      .get(`/api/expenses?date=${testDate}`)
      .set(tenantAuth(testTenant));
    expect(checkList.body.length).toBe(0);
  });
});

describe('Platform Owner Password Management & Vault', () => {
  let createdTenant;

  it('records temporary credentials in vault upon restaurant creation', async () => {
    const res = await request(app)
      .post('/api/saas/tenants')
      .set(platformOwner())
      .send({
        name: 'Vault Bistro',
        subdomain: 'vault-bistro',
        ownerEmail: 'owner@vaultbistro.test',
        plan: 'basic'
      });

    expect(res.status).toBe(201);
    createdTenant = res.body.tenant;
    expect(createdTenant.temporaryPassword).toBeTruthy();
  });

  it('exposes the credentials vault to the platform owner', async () => {
    const res = await request(app)
      .get('/api/saas/tenants/credentials')
      .set(platformOwner());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const match = res.body.find(c => c.id === createdTenant.id);
    expect(match).toBeTruthy();
    expect(match.password).toBe(createdTenant.temporaryPassword);
    expect(match.hasSavedPassword).toBe(true);
  });

  it('allows platform owner to reset restaurant password and updates the vault', async () => {
    const resetRes = await request(app)
      .post(`/api/saas/tenants/${createdTenant.id}/reset-password`)
      .set(platformOwner())
      .send({ customPassword: 'NewSecurePassword!2026', customPin: '9988' });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.credentials.password).toBe('NewSecurePassword!2026');
    expect(resetRes.body.credentials.pin).toBe('9988');

    // Verify vault has updated password
    const vaultRes = await request(app)
      .get('/api/saas/tenants/credentials')
      .set(platformOwner());

    const updated = vaultRes.body.find(c => c.id === createdTenant.id);
    expect(updated.password).toBe('NewSecurePassword!2026');
    expect(updated.pin).toBe('9988');
  });
});
