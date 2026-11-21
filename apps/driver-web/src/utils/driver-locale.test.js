import {describe,it,expect} from 'vitest';
import {driverLanguages,driverText,driverThemeChoice} from './driver-locale.js';
describe('Driver core language and theme preferences',()=>{
  it('supports English, Sinhala and Tamil core navigation',()=>{
    expect(driverLanguages).toEqual(['en','si','ta']);
    for(const code of driverLanguages){
      for(const label of ['home','orders','cash','profile','settings','accessibility']){
        expect(driverText(code,label)).toBeTruthy();
        expect(driverText(code,label)).not.toBe(label);
      }
    }
  });
  it('falls back safely to English and device-selected theme',()=>{
    expect(driverText('unsupported','home')).toBe('Home');
    expect(driverThemeChoice('dark')).toBe('dark');
    expect(driverThemeChoice('light')).toBe('light');
    expect(driverThemeChoice('unexpected')).toBe('system');
  });
});
