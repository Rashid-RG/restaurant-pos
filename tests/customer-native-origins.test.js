import {describe,it,expect} from 'vitest';
import {configuredNativeOrigins,invalidNativeOriginEntries} from '../lib/customer-native-origins.js';

describe('GastroFlow customer native CORS opt-in',()=>{
  it('starts with no native origin allowed',()=>{
    expect(configuredNativeOrigins()).toEqual([]);
    expect(configuredNativeOrigins('')).toEqual([]);
  });
  it('allows only exact WebView origins explicitly configured',()=>{
    expect(configuredNativeOrigins('capacitor://localhost,https://localhost,capacitor://localhost'))
      .toEqual(['capacitor://localhost','https://localhost']);
  });
  it('never admits wildcard, insecure, altered or arbitrary hosts',()=>{
    const text='*,null,file://,http://localhost,capacitor://evil.example,https://localhost.attacker.org,capacitor://localhost:1234';
    expect(configuredNativeOrigins(text)).toEqual([]);
    expect(invalidNativeOriginEntries(text)).toHaveLength(7);
  });
});
