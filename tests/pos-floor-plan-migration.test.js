import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import LegacyFloorPlan from '../src/components/FloorPlan.jsx';
import PosFloorPlan from '../apps/pos-web/src/components/FloorPlan.jsx';

describe('POS floor-management component relocation contract', () => {
  it('keeps the exact same floor plan component available through the legacy import', () => {
    expect(LegacyFloorPlan).toBe(PosFloorPlan);
  });

  it('preserves table creation, deletion, order loading and restaurant context', () => {
    const source=readFileSync('apps/pos-web/src/components/FloorPlan.jsx','utf8');
    expect(source).toContain("from '../../../../src/context/POSContext'");
    for (const method of ['saveTable','deleteTable','loadOrderToPOS','setActiveTab','showToast']) {
      expect(source).toContain(method);
    }
    expect(source).toContain("diningType: 'dine-in'");
  });

  it('preserves authenticated transfer and merge endpoints and their payload field names', () => {
    const source=readFileSync('apps/pos-web/src/components/FloorPlan.jsx','utf8');
    expect(source).toContain("fetch('/api/tables/transfer'");
    expect(source).toContain("fetch('/api/tables/merge'");
    expect(source).toContain("localStorage.getItem('gastroflow_token')");
    expect(source).toContain('fromTableId: selectedTableDetails.table.id');
    expect(source).toContain('sourceTableId: selectedTableDetails.table.id');
    expect(source).toContain('toTableId: targetTableId');
    expect(source).toContain('targetTableId: targetTableId');
  });

  it('keeps the existing POS navigation, runtime bootstrap, and build unchanged', () => {
    const old=readFileSync('src/components/FloorPlan.jsx','utf8');
    const app=readFileSync('src/App.jsx','utf8');
    const html=readFileSync('index.html','utf8');
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    expect(old).toContain("../../apps/pos-web/src/components/FloorPlan.jsx");
    expect(app).toContain("import FloorPlan from './components/FloorPlan'");
    expect(app).toContain("case 'floor':");
    expect(html).toContain('src="/src/main.jsx"');
    expect(pkg.scripts.build).toBe('vite build');
  });
});
