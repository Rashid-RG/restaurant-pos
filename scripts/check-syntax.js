import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.js'];
for (const dir of ['lib', 'routes', 'scripts']) {
  for (const file of readdirSync(dir)) if (file.endsWith('.js') && statSync(`${dir}/${file}`).isFile()) files.push(`${dir}/${file}`);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax verified for ${files.length} server and operational modules.`);
