import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');

describe('POS Printer & Hardware settings navigation', () => {
  it('provides a dedicated visible navigation destination', () => {
    expect(code).toContain("subTab === 'home'");
    expect(code).toContain("setSubTab('home')");
    expect(code).toContain("id: 'printer'");
    expect(code).toContain('Printer & Receipts');
    expect(code).toContain("['online','business','printer','menu','database','users','billing','saas']");
    expect(code).toContain('settings-page-breadcrumb');
  });

  it('renders QZ and paper size inside the printer section rather than online store', () => {
    const printerSection = code.slice(code.indexOf("subTab === 'printer' && ("),code.indexOf("{/* 4. Online Store Admin Settings */}"));
    expect(printerSection).toContain('Receipt & Printer Studio');
    expect(printerSection).toContain('Receipt Designer');
    expect(printerSection).toContain('Printer & Hardware');
    expect(printerSection).toContain('<SmartReceiptDesigner');
    expect(printerSection).toContain('Find connected printers');
    expect(printerSection).toContain('Enable direct cashier printing on this computer');
    const onlineSection = code.slice(code.indexOf("subTab === 'online' && ("));
    expect(onlineSection).not.toContain('Smart Printer & Paper Size');
  });
});
