import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

describe('GastroFlow Food reduced-motion layout safety',()=>{
  it('disables motion but preserves fixed-bottom-navigation centering transforms',()=>{
    const css=readFileSync('apps/customer-web/src/premium-motion.css','utf8');
    const rule=css.match(/@media\(prefers-reduced-motion:reduce\)\{\.customer-premium \*.*?\}\}/s)?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain('animation:none!important');
    expect(rule).toContain('transition:none!important');
    expect(rule).not.toContain('transform:none!important');
  });
  it('keeps translation used to center the five-item mobile bottom bar',()=>{
    const css=readFileSync('apps/customer-web/src/index.css','utf8');
    expect(css).toContain('transform: translateX(-50%)');
  });
  it('keeps the search accessibility label screen-reader-only on phones',()=>{
    const css=readFileSync('apps/customer-web/src/views/MarketplaceMenu.css','utf8');
    expect(css).toContain('.marketplace-search .sr-only{position:absolute!important;');
    expect(css).toContain('clip:rect(0,0,0,0)!important;');
  });
});
