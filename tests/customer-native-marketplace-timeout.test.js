import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {marketplaceReadSignal,NATIVE_MARKETPLACE_TIMEOUT_MS} from '../apps/customer-web/src/utils/native-marketplace-timeout.js';

afterEach(()=>vi.useRealTimers());

describe('GastroFlow Food native-only marketplace network deadlines',()=>{
  it('does not change the browser website request signal',()=>{
    const controller=new AbortController();
    expect(marketplaceReadSignal({nativeBuild:false,parentSignal:controller.signal})).toBe(controller.signal);
    expect(marketplaceReadSignal({nativeBuild:false})).toBeUndefined();
  });
  it('sets a bounded deadline on native marketplace reads',()=>{
    const native=marketplaceReadSignal({nativeBuild:true,timeoutMs:1000});
    expect(native).toBeInstanceOf(AbortSignal);
    expect(native.aborted).toBe(false);
    expect(NATIVE_MARKETPLACE_TIMEOUT_MS).toBe(15000);
  });
  it('aborts when a user navigates away and never retries a stale tenant menu',()=>{
    const parent=new AbortController();
    const native=marketplaceReadSignal({nativeBuild:true,parentSignal:parent.signal});
    parent.abort();
    expect(native.aborted).toBe(true);
  });
  it('rejects unsafe or unbounded timeout configurations',()=>{
    for(const timeoutMs of [-1,0,200,60001,Infinity,NaN,2.5]){
      expect(()=>marketplaceReadSignal({nativeBuild:true,timeoutMs})).toThrow(RangeError);
    }
  });
  it('protects real marketplace discovery and each restaurant menu, not checkout writes',()=>{
    const source=readFileSync('apps/customer-web/src/views/MarketplaceMenu.jsx','utf8');
    expect(source).toContain("apiFetch('/public/restaurants', {");
    expect(source).toContain("signal: marketplaceReadSignal({nativeBuild:import.meta.env.MODE==='native',parentSignal:controller.signal})");
    expect((source.match(/marketplaceReadSignal\(/g)||[]).length).toBe(2);
    expect(source).toContain('return () => { cancelled = true; controller.abort(); }');
  });
});
