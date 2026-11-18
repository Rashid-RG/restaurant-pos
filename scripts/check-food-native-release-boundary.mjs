// Read-only build identity and distribution guard for the EXISTING GastroFlow
// Food customer project. This does not sign, generate, deploy or edit any app.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PROD_ID='com.rstechnologies.gastrofood';
const STAGING_ID=PROD_ID+'.staging';
const STAGING_API='https://gastroflow-staging.onrender.com';
const APPROVED_BRANCH="if: github.ref == 'refs/heads/codex/production-readiness'";

export function nativeReleaseBoundaryErrors({customer,root,gradle,androidWorkflow,iosWorkflow,manifest,strings,iosSourceExists=false}) {
  const issues=[];
  if(customer?.appId!==PROD_ID||customer?.webDir!=='dist'||customer?.server?.url||customer?.server?.cleartext===true)
    issues.push('Customer Capacitor identity must be isolated, local and secure');
  if(customer?.appId===root?.appId)issues.push('Customer app collides with POS package');
  if(!/applicationId\s+["']com\.rstechnologies\.gastrofood["']/.test(gradle))
    issues.push('Android production application ID is not the customer ID');
  if(!/applicationIdSuffix\s+['"]\.staging['"]/.test(gradle))
    issues.push('Android staging package must be separately installable');
  if(!/signingConfig signingConfigs\.foodStaging/.test(gradle))
    issues.push('Android staging must require permanent signing configuration');
  if(!/FOOD_STAGING_KEYSTORE_PATH/.test(gradle))
    issues.push('Android staging signing cannot use an unprotected ephemeral key');
  if(!androidWorkflow.includes(APPROVED_BRANCH))
    issues.push('Signed Android workflow must be restricted to approved branch');
  if(!androidWorkflow.includes('workflow_dispatch:')||/\n\s*push:/.test(androidWorkflow))
    issues.push('Signed Android workflow must be explicitly dispatched, not push triggered');
  if(!androidWorkflow.includes('sha256sum --check "$RUNNER_TEMP/pos-lock.sha256"'))
    issues.push('Signed Android workflow must protect root POS dependency lockfile');
  if(!androidWorkflow.includes('check-food-native-release-boundary.mjs'))
    issues.push('Signed Android workflow must execute native release boundary checks');
  if(!androidWorkflow.includes(STAGING_API))
    issues.push('Signed Android workflow must use staging HTTPS API');
  if(!androidWorkflow.includes(STAGING_ID))
    issues.push('Signed Android workflow must verify staging package identity');
  // GitHub only exposes workflow_dispatch for workflows registered on the
  // default branch. Permit a single-workflow-file push trigger on the approved
  // branch to validate the unsigned iOS simulator without touching main.
  const iosSafePush=/\n  push:\n    branches: \[codex\/production-readiness\]\n    paths:\n      - \.github\/workflows\/food-native-ios-simulator\.yml\n/.test(iosWorkflow);
  const iosHasPush=/\n\s*push:/.test(iosWorkflow);
  if(!iosWorkflow.includes(APPROVED_BRANCH)||!iosWorkflow.includes('workflow_dispatch:')||
      (iosHasPush&&!iosSafePush))
    issues.push('iOS simulator must use only manual dispatch or approved workflow-file-only push on development branch');
  if(!iosWorkflow.includes('CODE_SIGNING_ALLOWED=NO')||
      !iosWorkflow.includes("test \"$BUNDLE_ID\" = '"+PROD_ID+"'"))
    issues.push('iOS simulator workflow must not claim to build a signed device IPA');
  if(!iosWorkflow.includes(STAGING_API))
    issues.push('iOS simulator must point to staging API');
  if(!/android\.permission\.ACCESS_FINE_LOCATION/.test(manifest)||
     !/android\.permission\.ACCESS_COARSE_LOCATION/.test(manifest))
    issues.push('Android must declare foreground location permissions');
  if(!/android:allowBackup="false"/.test(manifest))
    issues.push('Android must disable platform backup of customer app data');
  if(!/name="food_staging_app_name"/.test(strings))
    issues.push('Android staging launcher label must be distinct');
  if(iosSourceExists===false){
    // The iOS source is intentionally generated in macOS Actions, not committed.
    // It is a distribution blocker, not a source-validation failure.
  }
  return issues;
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const json=p=>JSON.parse(read(p));
  const errors=nativeReleaseBoundaryErrors({
    customer:json('apps/customer-web/capacitor.config.json'),
    root:json('capacitor.config.json'),
    gradle:read('apps/customer-web/android/app/build.gradle'),
    androidWorkflow:read('.github/workflows/gastrofood-staging-apk.yml'),
    iosWorkflow:read('.github/workflows/food-native-ios-simulator.yml'),
    manifest:read('apps/customer-web/android/app/src/main/AndroidManifest.xml'),
    strings:read('apps/customer-web/android/app/src/main/res/values/strings.xml'),
    iosSourceExists:fs.existsSync(path.join(root,'apps/customer-web/ios/App/App.xcodeproj/project.pbxproj'))
  });
  errors.forEach(e=>console.error('BLOCKED:',e));
  console.log('Native release boundary:',errors.length?'FAILED':'PASS',
    '| iOS device-signing status: NOT VERIFIED (simulator only)');
  if(errors.length)process.exitCode=1;
}
