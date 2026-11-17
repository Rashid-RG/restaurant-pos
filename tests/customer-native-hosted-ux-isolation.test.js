import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useHostedPwaUpdatePrompt } from '../apps/customer-web/src/utils/native-update-policy.js';
import { showHostedDriverShortcut } from '../apps/customer-web/src/utils/native-driver-link-policy.js';

describe('GastroFlow Food installed native shell vs existing hosted website',()=>{
  it('retains the existing web update prompt and driver shortcut on hosted builds',()=>{
    for(const mode of ['production','development',undefined]){
      expect(useHostedPwaUpdatePrompt(mode)).toBe(true);
      expect(showHostedDriverShortcut(mode)).toBe(true);
    }
  });
  it('never shows hosted PWA service-worker update prompts or driver portal in native builds',()=>{
    expect(useHostedPwaUpdatePrompt('native')).toBe(false);
    expect(showHostedDriverShortcut('native')).toBe(false);
  });
  it('guards the actual update effect and rendered banner in the customer component',()=>{
    const source=readFileSync('apps/customer-web/src/components/SystemUpdatePrompt.jsx','utf8');
    expect(source).toContain('if (!isHostedPwa || dismissed) return');
    expect(source).toContain('if (!isHostedPwa || !updateAvailable || dismissed) return null');
  });
  it('guards hosted driver portal link in the customer App, not the web driver route',()=>{
    const source=readFileSync('apps/customer-web/src/App.jsx','utf8');
    expect(source).toContain('showHostedDriverShortcut(import.meta.env.MODE) && <button');
    expect(source).toContain("'/driver-app'");
  });
});
