import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');

describe('POS Printer & Hardware settings navigation', () => {
  it('provides a dedicated visible navigation destination', () => {
    expect(code).toContain("subTab === 'printer' ? 'active' : ''");
    expect(code).toContain("setSubTab('printer')");
    expect(code).toContain('🖨️ Printer & Hardware');
    expect(code).toContain("['online','business','printer','menu','database','users']");
  });

  it('renders QZ and paper size inside the printer section rather than online store', () => {
    const printerSection = code.slice(code.indexOf("subTab === 'printer' && ("),code.indexOf("{/* 4. Online Store Admin Settings */}"));
    expect(printerSection).toContain('Smart Printer & Paper Size');
    expect(printerSection).toContain('Windows Direct Thermal Print (ESC/POS) — Pilot');
    expect(printerSection).toContain('Connect QZ Tray / Find printers');
    expect(printerSection).toContain('Enable native cashier receipt printing on this computer');
    const onlineSection = code.slice(code.indexOf("subTab === 'online' && ("));
    expect(onlineSection).not.toContain('Smart Printer & Paper Size');
  });
});
