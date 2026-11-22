import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolveCustomerImageUrl} from '../apps/customer-web/src/utils/native-image-url.js';

const native={nativeBuild:true,configuredOrigin:'https://gastroflow-staging.onrender.com'};
describe('GastroFlow Food native restaurant image URLs',()=>{
  it('resolves root-relative food image paths against the approved API host',()=>{
    expect(resolveCustomerImageUrl('/uploads/menu/rice.png',native))
      .toBe('https://gastroflow-staging.onrender.com/uploads/menu/rice.png');
    expect(resolveCustomerImageUrl('/images/shop.jpg?size=medium',native))
      .toBe('https://gastroflow-staging.onrender.com/images/shop.jpg?size=medium');
  });
  it('leaves the existing hosted website behavior unchanged',()=>{
    expect(resolveCustomerImageUrl('/uploads/menu/rice.png',{nativeBuild:false}))
      .toBe('/uploads/menu/rice.png');
    expect(resolveCustomerImageUrl(' https://images.unsplash.com/photo.jpg ',{nativeBuild:false}))
      .toBe('https://images.unsplash.com/photo.jpg');
  });
  it('preserves external HTTPS image services without changing their hosts',()=>{
    const absolute='https://images.unsplash.com/photo.jpg?w=600';
    expect(resolveCustomerImageUrl(absolute,native)).toBe(absolute);
    expect(resolveCustomerImageUrl('//example.org/photo.png',native)).toBe('//example.org/photo.png');
  });
  it('does not invent an image for missing URLs and rejects invalid native API configuration',()=>{
    expect(resolveCustomerImageUrl('',native)).toBe('');
    expect(resolveCustomerImageUrl(null,native)).toBe('');
    expect(()=>resolveCustomerImageUrl('/uploads/item.png',{nativeBuild:true,configuredOrigin:'http://localhost:5000'}))
      .toThrow(/HTTPS/);
  });
  it('wires the native resolution into marketplace, item cards and menu customizer',()=>{
    const market=readFileSync('apps/customer-web/src/views/MarketplaceMenu.jsx','utf8');
    const menu=readFileSync('apps/customer-web/src/views/MenuView.jsx','utf8');
    expect(market).toContain('resolveCustomerImageUrl(item.imageUrl,');
    expect(menu).toContain('resolveCustomerImageUrl(item.imageUrl,');
    expect(menu).toContain('resolveCustomerImageUrl(customizerItem.imageUrl,');
  });
});
