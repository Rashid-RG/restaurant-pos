#!/usr/bin/env node
// Non-destructive monorepo structure guard. Only checks invariants; never moves or mutates code.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const required = [
  'server.js','src/App.jsx','src/platform/PlatformAdmin.jsx','src/platform/PlatformOperations.jsx','src/platform/workspace-policy.js','apps/customer-web/src/App.jsx',
  'apps/driver-web/src/App.jsx','apps/customer-web/android/app/build.gradle',
  'apps/customer-web/capacitor.config.json','lib/db_adapter.js',
  'routes/platform.js','shared/ui','tests','infra','docs'
];
const findings = [];
for (const entry of required) {
  if (!existsSync(entry)) findings.push('Missing architecture boundary: ' + entry);
}
const tracked = execFileSync('git', ['ls-files'], { encoding:'utf8' }).trim().split('\n');
const generated = tracked.filter(f =>
  /(?:^|\/)(?:node_modules|dist|coverage|build)\//.test(f) ||
  /\.timestamp-\d+.*\.mjs$/.test(f) ||
  /(?:^|\/)(?:\.env|.*\.jks|.*\.keystore)$/.test(f)
);
if (generated.length) findings.push('Generated/sensitive tracked paths: ' + generated.join(', '));
const posEntrypoint = readFileSync('src/App.jsx', 'utf8');
if (!posEntrypoint.includes("from './platform/PlatformAdmin'")) findings.push('POS entrypoint must reference dedicated platform domain');
if (!posEntrypoint.includes("currentUser.isPlatformAdmin === true ? <PlatformAdmin /> : <Dashboard />")) findings.push('Platform workspace must remain gated for non-platform users');
for (const [legacy, destination] of [
  ['src/components/PlatformAdmin.jsx', '../platform/PlatformAdmin.jsx'],
  ['src/components/PlatformOperations.jsx', '../platform/PlatformOperations.jsx'],
]) {
  if (!readFileSync(legacy,'utf8').includes(destination)) findings.push('Missing backwards-compatible platform import: ' + legacy);
}
const workspaceSource = readFileSync('src/components/WorkspaceTools.jsx', 'utf8');
if (!workspaceSource.includes("from '../platform/workspace-policy.js'")) findings.push('POS workspace must consume isolated platform navigation policy');
const customerConfig = JSON.parse(readFileSync('apps/customer-web/capacitor.config.json', 'utf8'));
if (customerConfig.appId !== 'com.rstechnologies.gastrofood') findings.push('Unexpected production customer package ID');
if (customerConfig.server?.url) findings.push('Customer native app must package assets, not point at a remotely hosted WebView');
const gradle = readFileSync('apps/customer-web/android/app/build.gradle','utf8');
if (!gradle.includes("applicationIdSuffix '.staging'")) findings.push('Missing isolated Android staging package');
if (!gradle.includes('signingConfig signingConfigs.foodStaging')) findings.push('Missing permanent staging signing reference');
const workflow = readFileSync('.github/workflows/gastrofood-staging-apk.yml','utf8');
if (!workflow.includes('FOOD_STAGING_KEYSTORE_BASE64')) findings.push('Missing required secure signing secret gate');
if (/^\s+push:/m.test(workflow)) findings.push('Signed staging release workflow must remain manual-only');
if (findings.length) {
  console.error('GastroFlow architecture validation failed:\n' + findings.map(x=>'- ' + x).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Architecture guard passed: system roots, package isolation, tracked artifacts and signing-release policy.');
}
