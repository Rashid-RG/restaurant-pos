import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isCurrentLocationSelection } from '../apps/customer-web/src/utils/location-selection-guard.js';

describe('Stores manual delivery-address save safety',()=>{
  it('accepts only the current geocoding submission',()=>{
    expect(isCurrentLocationSelection(1,1)).toBe(true);
    expect(isCurrentLocationSelection(2,2)).toBe(true);
    expect(isCurrentLocationSelection(1,2)).toBe(false);
    expect(isCurrentLocationSelection(2,3)).toBe(false);
  });
  it('rejects invalid or absent generation tokens',()=>{
    for(const value of [0,-1,NaN,1.2,null,undefined]){
      expect(isCurrentLocationSelection(value,1)).toBe(false);
    }
  });
  it('checks the generation after asynchronous geocoding and before fallback storage writes',()=>{
    const source=readFileSync('apps/customer-web/src/views/RestaurantsView.jsx','utf8');
    const save=source.split('const handleSaveCustomAddress = async (e) => {')[1]
      ?.split('const handlePinLocationChange = async')[0];
    expect(save).toBeTruthy();
    expect(save).toContain('const requestId = ++locationRequestRef.current');
    expect(save).toContain('addressSearchGateRef.current.invalidate()');
    expect(save).toContain('if (!isCurrentLocationSelection(requestId,locationRequestRef.current)) return');
    expect((save.match(/if \(!isCurrentLocationSelection\(requestId,locationRequestRef.current\)\) return/g)||[]).length).toBe(2);
    expect(save.indexOf('if (!isCurrentLocationSelection(requestId,locationRequestRef.current)) return'))
      .toBeLessThan(save.indexOf('handleSelectAddressSuggestion(data[0])'));
    expect(save.lastIndexOf('if (!isCurrentLocationSelection(requestId,locationRequestRef.current)) return'))
      .toBeLessThan(save.indexOf('resolveCoordsForAddress(manualAddr)'));
  });
  it('invalidates pending save when user edits address, selects pin/city or closes dialog',()=>{
    const source=readFileSync('apps/customer-web/src/views/RestaurantsView.jsx','utf8');
    expect(source).toContain("locationRequestRef.current++;\n                    setCustomAddressInput(e.target.value)");
    expect(source).toContain("locationRequestRef.current++;\n                  addressSearchGateRef.current.invalidate();\n                  setShowLocationModal(false)");
    expect(source).toContain("const handlePinLocationChange = async (lat, lng) => {\n    const requestId=++locationRequestRef.current");
    expect(source).toContain("const handleSelectPredefinedCity = (cityStr) => {\n    addressSearchGateRef.current.invalidate();\n    locationRequestRef.current++");
  });
});
