import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let result;
beforeAll(() => {
  result = spawnSync(process.execPath, ['scripts/generate-pwa-icons.js'], { encoding:'utf8', timeout: 60000 });
}, 65000);

const configs = [
  {dir:'apps/customer-web/public',prefix:'food-logo',manifest:'manifest.json',start:'/customer/',scope:'/customer/'},
  {dir:'apps/driver-web/public',prefix:'driver-logo',manifest:'manifest.json',start:'/driver-app/',scope:'/driver-app/'},
  {dir:'public',prefix:'pos-logo',manifest:'pos-manifest.json',start:'/',scope:'/'},
  {dir:'apps/customer-web/public',prefix:'driver-logo',manifest:'driver-manifest.json',start:'/customer/?mode=driver',scope:'/customer/'}
];

describe('PWA launcher icon generation', () => {
  it('generates icons with no external tools or network', () => {
    expect(result.status, result.stderr).toBe(0);
  });
  for (const config of configs) {
    it('generates correct 180/192/512 PNG dimensions for '+config.prefix+' in '+config.dir, () => {
      for (const size of [180,192,512]) {
        const name=size===512 ? config.prefix+'.png' : config.prefix+'-'+size+'.png';
        const file=config.dir+'/'+name;
        expect(existsSync(file)).toBe(true);
        const bytes=readFileSync(file);
        expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
        expect(bytes.readUInt32BE(16)).toBe(size);
        expect(bytes.readUInt32BE(20)).toBe(size);
        expect(bytes.length).toBeGreaterThan(size);
      }
    });
    it('configures '+config.manifest+' with a separate install scope and safe 512px mask', () => {
      const manifest=JSON.parse(readFileSync(config.dir+'/'+config.manifest,'utf8'));
      expect(manifest.start_url).toBe(config.start);
      expect(manifest.scope).toBe(config.scope);
      expect(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'&&icon.type==='image/png')).toBe(true);
      expect(manifest.icons.some(icon=>icon.purpose==='any'&&icon.sizes==='192x192'&&icon.type==='image/png')).toBe(true);
    });
  }
  it('points iPhone home-screen icons to dedicated 180px assets', () => {
    const files=[
      ['index.html','pos-logo-180.png?v=5'],
      ['apps/customer-web/index.html','food-logo-180.png?v=5'],
      ['apps/driver-web/index.html','driver-logo-180.png?v=5']
    ];
    for(const [file,icon] of files) expect(readFileSync(file,'utf8')).toContain(icon);
  });
});
