import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// An independent database — never test against staging or production data.
process.env.DATABASE_FILE = path.join(os.tmpdir(), `gastroflow_pos_url_auth_${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'pos-tenant-url-auth-test-secret';
process.env.CUSTOMER_JWT_SECRET = 'pos-tenant-url-auth-customer-secret';
process.env.PAYHERE_ENABLED = 'false';

const { app, dbReady, dbRun } = await import('../server.js');
const tenantA = 'tenant_pos_link_test_a';
const tenantB = 'tenant_pos_link_test_b';
const usernameA = 'pos_url_staff_a';
const usernameB = 'pos_url_staff_b';
const passwordA = 'correct-password-for-a';
const passwordB = 'correct-password-for-b';

beforeAll(async () => {
  await dbReady;
  const hashA = await bcrypt.hash(passwordA, 6);
  const hashB = await bcrypt.hash(passwordB, 6);
  for (const [id, sub, email] of [
    [tenantA, 'pos-link-test-a', 'pos-owner-a@example.test'],
    [tenantB, 'pos-link-test-b', 'pos-owner-b@example.test']
  ]) {
    await dbRun('INSERT INTO tenants(id,name,subdomain,ownerEmail,status) VALUES(?,?,?,?,?)',
      [id, id, sub, email, 'active']);
  }
  await dbRun('INSERT INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',
    ['pos_user_a', usernameA, hashA, 'manager', tenantA]);
  await dbRun('INSERT INTO users(id,username,passwordHash,role,tenant_id) VALUES(?,?,?,?,?)',
    ['pos_user_b', usernameB, hashB, 'manager', tenantB]);
}, 30000);

const login = (username, password, expectedTenantId) =>
  request(app).post('/api/auth/login').send({username,password,expectedTenantId});

describe('POS URL restaurant identity isolation', () => {
  it('lets Shop A staff sign in on their own URL', async () => {
    const response = await login(usernameA,passwordA,tenantA);
    expect(response.status, response.text).toBe(200);
    expect(response.body.user.tenant_id).toBe(tenantA);
    expect(response.body.token).toBeTruthy();
  });

  it('rejects Shop B credentials on Shop A unique POS URL', async () => {
    const response = await login(usernameB,passwordB,tenantA);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
    expect(response.body.token).toBeUndefined();
  });

  it('rejects Shop A credentials on Shop B unique POS URL', async () => {
    const response = await login(usernameA,passwordA,tenantB);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
  });

  it('supports the correct restaurant subdomain as the URL selector', async () => {
    const allowed = await login(usernameA,passwordA,'pos-link-test-a');
    const denied = await login(usernameB,passwordB,'pos-link-test-a');
    expect(allowed.status, allowed.text).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('rejects nonexistent store selectors even with valid credentials', async () => {
    const response = await login(usernameA,passwordA,'tenant_nonexistent_pos_link');
    expect(response.status).toBe(403);
  });

  it('prevents saved Shop B sessions from unlocking Shop A URL', async () => {
    const signedIn = await login(usernameB,passwordB,tenantB);
    expect(signedIn.status).toBe(200);
    const response = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${signedIn.body.token}`)
      .set('X-Expected-Tenant-Id', tenantA);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TENANT_URL_MISMATCH');
  });

  it('allows a saved staff session only for its own restaurant', async () => {
    const signedIn = await login(usernameA,passwordA,tenantA);
    const response = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${signedIn.body.token}`)
      .set('X-Expected-Tenant-Id', 'pos-link-test-a');
    expect(response.status, response.text).toBe(200);
    expect(response.body.user.tenant_id).toBe(tenantA);
  });
});
