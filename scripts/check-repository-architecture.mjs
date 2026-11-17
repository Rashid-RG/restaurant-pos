#!/usr/bin/env node
// Non-destructive monorepo structure guard. Only checks invariants; never moves or mutates code.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const required = [
  'server.js','apps/pos-web/README.md','apps/pos-web/src/App.jsx','apps/pos-web/src/utils/staff-session.js','apps/pos-web/src/utils/kitchen-recovery.js','apps/pos-web/src/utils/sold-items.js','apps/pos-web/src/utils/offlineSync.js','apps/pos-web/src/components/SupportTicketsView.jsx','apps/pos-web/src/components/StoreStatusScreen.jsx','apps/pos-web/src/components/SubscriptionBilling.jsx','apps/pos-web/src/components/ServiceExceptions.jsx','src/App.jsx','src/platform/PlatformAdmin.jsx','src/platform/PlatformOperations.jsx','src/platform/workspace-policy.js','apps/customer-web/src/App.jsx',
  'apps/driver-web/src/App.jsx','apps/customer-web/android/app/build.gradle',
  'apps/customer-web/capacitor.config.json','lib/db_adapter.js',
  'routes/platform.js','lib/orders/index.js','lib/orders/checkout-recovery.js','lib/orders/verification.js','lib/orders/tracking.js','lib/orders/inventory.js','lib/orders/loyalty-reversal.js','lib/identity/index.js','lib/identity/contact-validation.js','lib/identity/credential-generation.js','lib/identity/password-reset.js','lib/identity/password-reset-resolver.js','lib/identity/customer-login.js','lib/identity/customer-registration.js','lib/identity/customer-registration-duplicates.js','lib/identity/customer-schema-audit.js','docs/CUSTOMER_ACCOUNT_UNIQUENESS_SAFE_MIGRATION.md','lib/communications/index.js','lib/communications/app-links.js','lib/communications/order-confirmation.js','lib/delivery/index.js','lib/delivery/fee.js','lib/delivery/peak-hours.js','lib/delivery/geo-distance.js','shared/ui','tests','infra','docs'
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
const legacyStaffSession = readFileSync('src/utils/staff-session.js','utf8');
if (!legacyStaffSession.includes('../../apps/pos-web/src/utils/staff-session.js')) findings.push('Original POS staff session import must remain a compatibility export');
for (const file of ['kitchen-recovery.js','sold-items.js','offlineSync.js']) {
  const legacy = readFileSync('src/utils/' + file, 'utf8');
  if (!legacy.includes('../../apps/pos-web/src/utils/' + file)) findings.push('POS migrated utility lacks compatibility export: ' + file);
}
const legacySupportView = readFileSync('src/components/SupportTicketsView.jsx','utf8');
if (!legacySupportView.includes('../../apps/pos-web/src/components/SupportTicketsView.jsx')) findings.push('Legacy POS support tickets view must preserve its compatibility export');
const legacyStoreStatus = readFileSync('src/components/StoreStatusScreen.jsx','utf8');
if (!legacyStoreStatus.includes('../../apps/pos-web/src/components/StoreStatusScreen.jsx')) findings.push('Store status screen must retain the existing POS component import');
const legacySubscriptionView = readFileSync('src/components/SubscriptionBilling.jsx','utf8');
if (!legacySubscriptionView.includes('../../apps/pos-web/src/components/SubscriptionBilling.jsx')) findings.push('Subscription billing view must retain the existing POS component import');
const legacyServiceExceptions = readFileSync('src/components/ServiceExceptions.jsx','utf8');
if (!legacyServiceExceptions.includes('../../apps/pos-web/src/components/ServiceExceptions.jsx')) findings.push('Service exceptions must retain existing POS import compatibility');
const posCompatApp = readFileSync('apps/pos-web/src/App.jsx','utf8');
if (!posCompatApp.includes('../../../src/App.jsx')) findings.push('Dedicated POS app boundary must preserve existing UI entrypoint during gradual migration');
const currentHtml = readFileSync('index.html','utf8');
if (!currentHtml.includes('/src/main.jsx')) findings.push('POS migration must not change the live entrypoint without release approval');
const posEntrypoint = readFileSync('src/App.jsx', 'utf8');
if (!posEntrypoint.includes("from './platform/PlatformAdmin'")) findings.push('POS entrypoint must reference dedicated platform domain');
if (!posEntrypoint.includes("currentUser.isPlatformAdmin === true ? <PlatformAdmin /> : <Dashboard />")) findings.push('Platform workspace must remain gated for non-platform users');
for (const [legacy, destination] of [
  ['src/components/PlatformAdmin.jsx', '../platform/PlatformAdmin.jsx'],
  ['src/components/PlatformOperations.jsx', '../platform/PlatformOperations.jsx'],
]) {
  if (!readFileSync(legacy,'utf8').includes(destination)) findings.push('Missing backwards-compatible platform import: ' + legacy);
}
const backendEntrypoint = readFileSync('server.js', 'utf8');
if (!backendEntrypoint.includes("from './lib/delivery/index.js'")) findings.push('Backend must import delivery domain through its stable entrypoint');
for (const [legacy, destination] of [
  ['lib/geo-distance.js', './delivery/geo-distance.js'],
  ['lib/delivery-fee.js', './delivery/fee.js'],
  ['lib/peak-hours.js', './delivery/peak-hours.js'],
]) {
  if (!readFileSync(legacy, 'utf8').includes(destination)) findings.push('Delivery legacy entrypoint must be preserved: ' + legacy);
}
if (!backendEntrypoint.includes("from './lib/identity/index.js'")) findings.push('Backend must import identity domain through stable entrypoint');
if (!backendEntrypoint.includes("from './lib/communications/index.js'")) findings.push('Backend must import communications domain through stable entrypoint');
for (const [legacy, destination] of [
  ['lib/customer-contact-validation.js', './identity/contact-validation.js'],
  ['lib/credential-generation.js', './identity/credential-generation.js'],
  ['lib/app-links.js', './communications/app-links.js'],
]) {
  if (!readFileSync(legacy, 'utf8').includes(destination)) findings.push('Legacy domain compatibility export missing: ' + legacy);
}
if (!backendEntrypoint.includes("from './lib/orders/index.js'")) findings.push('Backend must consume the orders domain recovery entrypoint');
if (!readFileSync('lib/checkout-recovery.js','utf8').includes("./orders/checkout-recovery.js")) findings.push('Order recovery compatibility export must remain available');
if (!readFileSync('lib/order-verification.js','utf8').includes("./orders/verification.js")) findings.push('Checkout proof compatibility export must remain available');
if (backendEntrypoint.includes("from './lib/order-verification.js'")) findings.push('Backend should consume the order domain entrypoint, not the legacy proof path');
if (!readFileSync('lib/order-tracking.js','utf8').includes("./orders/tracking.js")) findings.push('Tracking compatibility export must remain available');
if (backendEntrypoint.includes("from './lib/order-tracking.js'")) findings.push('Backend must use canonical orders domain tracking entrypoint');
if (!readFileSync('lib/order-inventory.js','utf8').includes("./orders/inventory.js")) findings.push('Inventory compatibility export must remain available');
if (backendEntrypoint.includes("from './lib/order-inventory.js'")) findings.push('Backend must use canonical orders domain inventory entrypoint');
if (!backendEntrypoint.includes('createReleaseOrderLoyalty({ dbGet, dbRun })')) findings.push('Order cancellation must delegate loyalty reversal to the orders domain');
if (!backendEntrypoint.includes('createOrderConfirmationSender({')) findings.push('Order confirmations must delegate through communications module');
if (!backendEntrypoint.includes('createPasswordResetIssuer({dbRun, generateToken, generateOtp, hashCode})')) findings.push('Password-reset issuance must use identity domain');
if (!backendEntrypoint.includes('createPasswordResetResolver({ dbGet, hashCode })')) findings.push('Password reset resolution must delegate to the identity domain');
if (!backendEntrypoint.includes('createCustomerLoginLookup({ dbGet, normalizeLkPhone })')) findings.push('Customer login must use tenant-scoped identity lookup');
if (!backendEntrypoint.includes('createRegistrationOtpVerifier({ verifyOTPAsync })')) findings.push('Registration must use the tenant-bound OTP verification service');
if (!backendEntrypoint.includes('const tenantId = tenantIdForOtp;')) findings.push('Registration must persist using the same restaurant tenant as OTP verification');
if (!backendEntrypoint.includes('createCustomerRegistrationDuplicates({ dbGet })')) findings.push('Registration duplicate screening must use restaurant-scoped identity service');
if (!backendEntrypoint.includes('isCustomerRegistrationUniqueConflict(err)')) findings.push('Legacy registration uniqueness conflicts must be handled gracefully');
const customerSchemaAudit = readFileSync('lib/identity/customer-schema-audit.js', 'utf8');
if (!customerSchemaAudit.includes('PRAGMA table_info(customer_accounts)') || !customerSchemaAudit.includes('PRAGMA index_list(customer_accounts)')) findings.push('Customer account audit must inspect schema without changing records');
if (backendEntrypoint.includes('inspectCustomerAccountSchema(')) findings.push('Customer schema diagnostics must not execute during server startup');
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
