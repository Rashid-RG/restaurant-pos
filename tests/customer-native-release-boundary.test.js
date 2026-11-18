import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {nativeReleaseBoundaryErrors} from '../scripts/check-food-native-release-boundary.mjs';

const read=p=>fs.readFileSync(p,'utf8');
const fixture=()=>({
 customer:JSON.parse(read('apps/customer-web/capacitor.config.json')),
 root:JSON.parse(read('capacitor.config.json')),
 gradle:read('apps/customer-web/android/app/build.gradle'),
 androidWorkflow:read('.github/workflows/gastrofood-staging-apk.yml'),
 iosWorkflow:read('.github/workflows/food-native-ios-simulator.yml'),
 manifest:read('apps/customer-web/android/app/src/main/AndroidManifest.xml'),
 strings:read('apps/customer-web/android/app/src/main/res/values/strings.xml'),
});

describe('GastroFlow Food native distribution boundaries',()=>{
 it('accepts current isolated staging release configuration without requiring iOS signing',()=>{
   expect(nativeReleaseBoundaryErrors(fixture())).toEqual([]);
 });
 it('rejects accidental POS identity reuse or remote WebView shells',()=>{
   const f=fixture();
   f.customer.appId=f.root.appId;
   f.customer.server={url:'http://example.invalid',cleartext:true};
   expect(nativeReleaseBoundaryErrors(f).join(' ')).toMatch(/collides with POS/);
 });
 it('blocks Android APK signing from an unapproved branch or automatic push',()=>{
   const f=fixture();
   f.androidWorkflow=f.androidWorkflow.replace("if: github.ref == 'refs/heads/codex/production-readiness'",'if: true')
     .replace('workflow_dispatch:','workflow_dispatch:\n  push:');
   expect(nativeReleaseBoundaryErrors(f)).toEqual(expect.arrayContaining([
      expect.stringMatching(/restricted to approved branch/),
      expect.stringMatching(/explicitly dispatched/)
   ]));
 });
 it('requires stable Android signing, separate staging identity and root POS lock verification',()=>{
   const f=fixture();
   f.gradle=f.gradle.replace("applicationIdSuffix '.staging'","applicationIdSuffix '.production'");
   f.gradle=f.gradle.replace('signingConfig signingConfigs.foodStaging','');
   f.androidWorkflow=f.androidWorkflow.replace('sha256sum --check "$RUNNER_TEMP/pos-lock.sha256"','echo skipped');
   expect(nativeReleaseBoundaryErrors(f)).toEqual(expect.arrayContaining([
     expect.stringMatching(/separately installable/),
     expect.stringMatching(/permanent signing/),
     expect.stringMatching(/POS dependency lockfile/)
   ]));
 });
 it('fails if unsigned simulator checks are removed or iOS starts on every push',()=>{
   const f=fixture();
   f.iosWorkflow=f.iosWorkflow.replace('CODE_SIGNING_ALLOWED=NO','CODE_SIGNING_ALLOWED=YES')
      .replace('workflow_dispatch:','workflow_dispatch:\n  push:');
   expect(nativeReleaseBoundaryErrors(f)).toEqual(expect.arrayContaining([
     expect.stringMatching(/signed device IPA/),
     expect.stringMatching(/manually started/)
   ]));
 });
});
