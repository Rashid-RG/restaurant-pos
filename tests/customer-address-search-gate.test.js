import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createAddressSearchGate} from '../apps/customer-web/src/utils/address-search-gate.js';

describe('GastroFlow Food delivery address search consistency',()=>{
  it('accepts only the latest search result, even when older requests finish last',()=>{
    const gate=createAddressSearchGate();
    const first=gate.start(), second=gate.start();
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
  });
  it('invalidates stale results as soon as the customer types a new query',()=>{
    const gate=createAddressSearchGate();
    const pending=gate.start();
    gate.invalidate();
    expect(gate.isCurrent(pending)).toBe(false);
    const next=gate.start();
    expect(gate.isCurrent(next)).toBe(true);
  });
  it('does not accept results after a pin is selected or the picker unmounts',()=>{
    const gate=createAddressSearchGate();
    const pending=gate.start();
    gate.invalidate();
    expect(gate.isCurrent(pending)).toBe(false);
    const last=gate.start();
    gate.dispose();
    expect(gate.isCurrent(last)).toBe(false);
    expect(gate.isCurrent(gate.start())).toBe(false);
  });
  it('guards list updates, errors, loading state and result selection in actual picker',()=>{
    const source=readFileSync('apps/customer-web/src/components/LocationPicker.jsx','utf8');
    expect(source).toContain('const request=addressSearchGateRef.current.start()');
    expect(source).toContain('if (!addressSearchGateRef.current.isCurrent(request)) return');
    expect(source).toContain('if (addressSearchGateRef.current.isCurrent(request)) setSearching(false)');
    expect(source).toContain('addressSearchGateRef.current.invalidate()');
    expect(source).toContain('addressSearchGateRef.current.dispose()');
    expect(source).toContain('commit(r.lat, r.lng, r.label)');
  });
});
