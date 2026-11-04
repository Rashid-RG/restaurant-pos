// Real production processes, fresh databases and restart persistence. No live services used.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), 'gastroflow-production-'));
const availablePort = async () => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const baseEnv = { ...process.env, VITEST: '', NODE_ENV: 'production', RENDER: '', DATABASE_URL: '', JWT_SECRET: crypto.randomBytes(40).toString('hex'), CUSTOMER_JWT_SECRET: crypto.randomBytes(40).toString('hex'), ADMIN_USERNAME: 'smoke_operator', ADMIN_PASSWORD: crypto.randomBytes(20).toString('hex'), ADMIN_PIN: '649273', CORS_ORIGIN: 'https://pos.example.test', PAYHERE_MERCHANT_ID: '1234567', PAYHERE_MERCHANT_SECRET: 'smoke-merchant-secret', PAYHERE_NOTIFY_URL: 'https://pos.example.test/api/payments/payhere/webhook' };
async function boot(env) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Startup exited: ${logs}`);
      try { const res = await fetch(`${base}/api/health`); if (res.ok) return { child, base }; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Startup timeout: ${logs}`);
  } catch (error) { child.kill('SIGKILL'); throw error; }
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
async function login(base) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: baseEnv.ADMIN_USERNAME, password: baseEnv.ADMIN_PASSWORD }) });
  assert.equal(response.status, 200, `Production admin must be able to log in: ${await response.clone().text()}`);
  return (await response.json()).token;
}
try {
  for (const driver of ['sqlite', 'libsql']) {
    const database = path.join(directory, `${driver}.db`);
    const env = { ...baseEnv, DATABASE_FILE: database, TURSO_DATABASE_URL: driver === 'libsql' ? `file:${database}` : '', TURSO_AUTH_TOKEN: '' };
    let service = await boot(env);
    try {
      const token = await login(service.base);
      for (const route of ['/', '/customer/', '/driver-app/']) {
        const page = await fetch(`${service.base}${route}`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /assets\/.*\.js/);
      }
      const unauthenticated = await fetch(`${service.base}/api/settings`);
      assert.equal(unauthenticated.status, 401);
      const simulation = await fetch(`${service.base}/api/payments/payhere/dev-simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(simulation.status, 403);
      const created = await fetch(`${service.base}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: 'persistence_probe', name: 'Restart Persistence', emoji: '✓' }) });
      assert.equal(created.status, 200, await created.text());
    } finally { await stop(service.child); }
    service = await boot(env);
    try {
      const token = await login(service.base);
      const rows = await (await fetch(`${service.base}/api/categories`, { headers: { Authorization: `Bearer ${token}` } })).json();
      assert(rows.some(row => row.id === 'persistence_probe'), 'Data must survive restart.');
    } finally { await stop(service.child); }
    if (driver === 'sqlite') {
      const backup = spawn(process.execPath, ['scripts/backup.js'], { cwd: root, env: { ...env, BACKUP_DIRECTORY: path.join(directory, 'backups') }, stdio: ['ignore','pipe','pipe'] });
      let errors = '';
      backup.stderr.on('data', data => { errors += data; });
      backup.stdout.resume();
      const [code] = await once(backup, 'exit');
      assert.equal(code, 0, errors);
      assert.equal((await readdir(path.join(directory, 'backups'))).length, 1);
    }
    console.log(`Production smoke passed: ${driver}, all three frontends, bootstrap, payment guard and restart persistence.`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
