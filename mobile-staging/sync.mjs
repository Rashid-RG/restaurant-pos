import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const projectId = 'gastroflow-staging';
const appId = 'com.gastroflow.app.staging';
const platform = process.argv[2];

if (platform === 'android') {
  const config = JSON.parse(readFileSync(new URL('google-services.json', import.meta.url), 'utf8'));
  if (config.project_info.project_id !== projectId || !config.client.some(
    client => client.client_info.android_client_info?.package_name === appId
  )) {
    throw new Error('Android SDK configuration does not match GastroFlow Staging.');
  }
  copyFileSync(new URL('google-services.json', import.meta.url), new URL('android/app/google-services.json', import.meta.url));
} else if (platform === 'ios') {
  if (process.platform !== 'darwin') throw new Error('iOS sync requires macOS and Xcode.');
  const config = readFileSync(new URL('GoogleService-Info.plist', import.meta.url), 'utf8');
  if (!/<key>PROJECT_ID<\/key>\s*<string>gastroflow-staging<\/string>/.test(config) ||
      !/<key>BUNDLE_ID<\/key>\s*<string>com\.gastroflow\.app\.staging<\/string>/.test(config)) {
    throw new Error('iOS SDK configuration does not match GastroFlow Staging.');
  }
  copyFileSync(new URL('GoogleService-Info.plist', import.meta.url), new URL('ios/App/App/GoogleService-Info.plist', import.meta.url));
} else {
  throw new Error('Use npm run sync -- android or npm run sync -- ios.');
}

const cli = fileURLToPath(new URL('node_modules/@capacitor/cli/bin/capacitor', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'sync', platform], { cwd: directory, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
