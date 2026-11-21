import {describe,it,expect} from 'vitest';
import buildConfig from '../apps/customer-web/vite.config.js';

describe('GastroFlow Food React singleton build contract',()=>{
  it('resolves customer and shared component React hooks to one package instance',()=>{
    const opts=buildConfig({mode:'production'});
    expect(opts.resolve.dedupe).toEqual(expect.arrayContaining([
      'react','react-dom','react/jsx-runtime','react/jsx-dev-runtime'
    ]));
  });
  it('keeps hosted customer URL prefix unchanged',()=>{
    expect(buildConfig({mode:'production'}).base).toBe('/customer/');
  });
});
