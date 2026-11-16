import {describe,it,expect} from 'vitest';
import {canUseHostedOrderStream,canUseHostedWebPush} from '../apps/customer-web/src/utils/native-tracking-policy.js';

describe('GastroFlow Food native transport isolation',()=>{
  it('allows hosted PWA SSE and web push',()=>{
    expect(canUseHostedOrderStream(false)).toBe(true);
    expect(canUseHostedWebPush(false)).toBe(true);
  });
  it('disables cookie-bound SSE and browser-only push inside a packaged shell',()=>{
    expect(canUseHostedOrderStream(true)).toBe(false);
    expect(canUseHostedWebPush(true)).toBe(false);
  });
  it('does not interpret unknown build state as native',()=>{
    expect(canUseHostedOrderStream(undefined)).toBe(true);
    expect(canUseHostedWebPush(undefined)).toBe(true);
  });
});
