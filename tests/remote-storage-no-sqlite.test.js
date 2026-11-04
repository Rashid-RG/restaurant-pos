import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('boots the libSQL server without loading the local sqlite3 driver', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gastroflow-remote-'));
  const loader = `export async function resolve(specifier, context, next) {
    if (specifier === 'sqlite3') throw new Error('Local sqlite3 must not load for libSQL');
    return next(specifier, context);
  }`;
  try {
    const result = spawnSync(process.execPath, [
      '--loader', `data:text/javascript,${encodeURIComponent(loader)}`,
      '--input-type=module', '--eval',
      `const { dbReady } = await import('./server.js'); await dbReady; console.log('REMOTE_BOOT_OK'); process.exit(0);`,
    ], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 25000,
      env: { ...process.env, NODE_ENV: 'test', VITEST: '1', DATABASE_URL: '', TURSO_DATABASE_URL: `file:${join(directory, 'test.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'remote-storage-regression-test-secret' },
    });
    expect(result.stderr + result.stdout).not.toContain('Local sqlite3 must not load');
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('REMOTE_BOOT_OK');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
