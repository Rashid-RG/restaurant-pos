import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const apps = [
  {dir:'apps/customer-web/public', prefix:'food-logo', manifest:'manifest.json', start:'/customer/', scope:'/customer/'},
  {dir:'apps/driver-web/public', prefix:'driver-logo', manifest:'manifest.json', start:'/driver-app/', scope:'/driver-app/'},
  {dir:'public', prefix:'pos-logo', manifest:'pos-manifest.json', start:'/', scope:'/'},
  {dir:'apps/customer-web/public', prefix:'driver-logo', manifest:'driver-manifest.json', start:'/customer/?mode=driver', scope:'/customer/'}
];

describe('Preserve original GastroFlow brand assets for installed apps', () => {
  it('does not replace originals during a build', () => {
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    for(const script of ['build', 'build:all', 'customer:build', 'driver:build'])
      expect(pkg.scripts[script]).not.toContain('generate-pwa-icons');
    expect(existsSync('scripts/generate-pwa-icons.js')).toBe(false);
  });
  for (const app of apps) {
    it('includes original branded SVG and correctly sized PNG assets for '+app.prefix+' in '+app.dir, () => {
      const original=readFileSync(app.dir+'/'+app.prefix+'.svg','utf8');
      expect(original).toContain('<svg');
      for (const [name,size] of [[app.prefix+'.png',512],[app.prefix+'-192.png',192]]) {
        const buf=readFileSync(app.dir+'/'+name);
        expect([...buf.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
        expect(buf.readUInt32BE(16)).toBe(size);
        expect(buf.readUInt32BE(20)).toBe(size);
        expect(buf.length).toBeGreaterThan(1000);
      }
    });
    it('keeps safe nonmaskable icons, correct install scope and versioned sources in '+app.manifest, () => {
      const manifest=JSON.parse(readFileSync(app.dir+'/'+app.manifest,'utf8'));
      expect(manifest.start_url).toBe(app.start);
      expect(manifest.scope).toBe(app.scope);
      expect(manifest.icons.map(i=>i.sizes)).toEqual(['192x192','512x512']);
      expect(manifest.icons.every(i=>i.type==='image/png'&&i.purpose==='any'&&i.src.includes('?v=6'))).toBe(true);
    });
  }
  it('keeps food, driver and POS icon designs distinct', () => {
    const files=['apps/customer-web/public/food-logo.svg','apps/driver-web/public/driver-logo.svg','public/pos-logo.svg'];
    const content=files.map(file=>readFileSync(file,'utf8'));
    expect(new Set(content).size).toBe(3);
    const icons=['apps/customer-web/public/food-logo.png','apps/driver-web/public/driver-logo.png','public/pos-logo.png'];
    const pngs=icons.map(file=>readFileSync(file).toString('base64'));
    expect(new Set(pngs).size).toBe(3);
  });
  it('uses original SVG favicons and PNG iPhone home screen artwork, not new generated designs', () => {
    const checks=[
      ['index.html','/pos-logo.svg?v=6','/pos-logo.png?v=6'],
      ['apps/customer-web/index.html','food-logo.svg?v=6','food-logo.png?v=6'],
      ['apps/driver-web/index.html','driver-logo.svg?v=6','driver-logo.png?v=6']
    ];
    for(const [file,svg,png] of checks){
      const html=readFileSync(file,'utf8');
      expect(html).toContain(svg);expect(html).toContain(png);
    }
  });
});
