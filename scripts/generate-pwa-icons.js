// Generate Android/iOS-ready app icons without native image or network dependencies.
// Full-bleed backgrounds and centered artwork respect Android maskable safe zones.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const sizeList = [180, 192, 512];
const apps = [
  { kind: 'food', dir: 'apps/customer-web/public', name: 'food-logo', bg: [232, 94, 48] },
  { kind: 'driver', dir: 'apps/driver-web/public', name: 'driver-logo', bg: [13, 112, 128] },
  { kind: 'pos', dir: 'public', name: 'pos-logo', bg: [43, 57, 102] },
  { kind: 'driver', dir: 'apps/customer-web/public', name: 'driver-logo', bg: [13, 112, 128] }
];

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4);
  return out;
}
function savePng(path, pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    pixels.copy(raw, dst + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
  writeFileSync(path, png);
}
function createIcon(size, kind, background) {
  const pixels = Buffer.alloc(size * size * 4);
  // Shape functions work in a shared 100x100 design grid.
  const blend = (x, y, color, alpha) => {
    if (alpha <= 0) return;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) pixels[i+c] = Math.round(pixels[i+c] * (1-alpha) + color[c] * alpha);
    pixels[i+3] = 255;
  };
  for (let y=0; y<size; y++) for(let x=0; x<size; x++) {
    const u=x/(size-1), v=y/(size-1), i=(y*size+x)*4;
    const light = Math.max(0, 1 - Math.hypot(u-.24,v-.15)*1.0) * .12;
    for (let c=0;c<3;c++) pixels[i+c]=Math.min(255,Math.round(background[c]*(1-light)+255*light));
    pixels[i+3]=255;
  }
  const shape = (box, test, color) => {
    const [x0,y0,x1,y1] = box.map(n=>Math.max(0,Math.min(size, Math.floor(n*size/100))));
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
      // 2x2 antialiasing keeps 180px iOS icons crisp.
      let hits=0;
      for(const dy of [.25,.75]) for(const dx of [.25,.75]) {
        if(test((x+dx)*100/size,(y+dy)*100/size))hits++;
      }
      if(hits)blend(x,y,color,hits/4);
    }
  };
  const ellipse=(cx,cy,rx,ry,color)=>shape([cx-rx-1,cy-ry-1,cx+rx+1,cy+ry+1],
    (x,y)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1,color);
  const roundRect=(x,y,w,h,r,color)=>shape([x-1,y-1,x+w+1,y+h+1],
    (px,py)=>{const cx=Math.max(x+r,Math.min(px,x+w-r));const cy=Math.max(y+r,Math.min(py,y+h-r));return (px-cx)**2+(py-cy)**2<=r*r},color);
  const capsule=(x1,y1,x2,y2,r,color)=>shape([Math.min(x1,x2)-r-1,Math.min(y1,y2)-r-1,Math.max(x1,x2)+r+1,Math.max(y1,y2)+r+1],
    (x,y)=>{const vx=x2-x1,vy=y2-y1;const t=Math.max(0,Math.min(1,((x-x1)*vx+(y-y1)*vy)/(vx*vx+vy*vy||1)));return Math.hypot(x-x1-t*vx,y-y1-t*vy)<=r},color);
  // The focal design always lives in 20..80, safe from platform icon masks.
  ellipse(50,50,32,32,[255,255,255]);
  if(kind==='food') {
    ellipse(50,48,23,17,[247,176,71]);
    roundRect(27,51,46,6,3,[52,124,75]);
    roundRect(27,55,46,8,4,[103,58,40]);
    roundRect(28,62,44,9,4,[244,181,87]);
    ellipse(40,41,1.6,1,[255,244,205]);
    ellipse(51,37,1.6,1,[255,244,205]);
    ellipse(61,43,1.6,1,[255,244,205]);
    ellipse(48,45,1.5,1,[255,244,205]);
  } else if(kind==='driver') {
    // Simplified rider/delivery-bike silhouette; distinct from the food bag icon.
    ellipse(36,67,10,10,[25,54,80]); ellipse(64,67,10,10,[25,54,80]);
    ellipse(36,67,5.4,5.4,[255,255,255]); ellipse(64,67,5.4,5.4,[255,255,255]);
    capsule(36,67,47,49,2.9,[25,54,80]);
    capsule(47,49,64,67,2.9,[25,54,80]);
    capsule(36,67,64,67,2.9,[25,54,80]);
    capsule(47,49,57,42,3,[25,54,80]);
    capsule(56,42,65,42,3,[25,54,80]);
    roundRect(27,40,18,16,3,[247,164,62]);
    roundRect(31,37,10,5,2,[255,206,121]);
    capsule(43,57,57,57,3,[25,54,80]);
  } else {
    // POS terminal screen and payment receipt glyph.
    roundRect(30,26,40,42,6,[31,57,97]);
    roundRect(34,30,32,29,3,[92,200,179]);
    roundRect(38,35,18,5,2,[255,255,255]);
    roundRect(38,44,10,8,2,[255,255,255]);
    roundRect(51,44,11,8,2,[255,191,89]);
    capsule(50,68,50,74,4,[31,57,97]);
    roundRect(32,74,36,6,3,[31,57,97]);
  }
  return pixels;
}
for(const app of apps) {
  for(const size of sizeList) {
    const name=size===512?app.name+'.png':app.name+'-'+size+'.png';
    savePng(join(app.dir,name), createIcon(size,app.kind,app.bg),size);
    process.stdout.write('Generated '+join(app.dir,name)+'\n');
  }
}
