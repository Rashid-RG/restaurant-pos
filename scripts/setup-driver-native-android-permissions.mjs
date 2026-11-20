#!/usr/bin/env node
// Isolated GastroDriver Android source setup. Does not touch POS/GastroFood.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve('apps/driver-native/android');
const manifest=resolve(root,'app/src/main/AndroidManifest.xml');
if(!existsSync(manifest))throw Error('Generate isolated GastroDriver Android project first');
let text=readFileSync(manifest,'utf8');
if(!text.includes('<manifest')||!text.includes('<application'))throw Error('Unexpected manifest');
for(const permission of [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION'
]){
  if(!text.includes('android:name="'+permission+'"')){
    text=text.replace(/(<application\b)/,
      '    <uses-permission android:name="'+permission+'" />\n    $1');
  }
}
writeFileSync(manifest,text);
console.log('GastroDriver Android permission declarations added; runtime permission flow and real-device approval still required.');
