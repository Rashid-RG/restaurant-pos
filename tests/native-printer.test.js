import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNativePrinterConfig, saveNativePrinterConfig, isNativePrintingEnabled,
  nativePrintReceiptMarkup, nativePrintReceiptElement, nativePrintTestSlip
} from '../src/utils/native-printer.js';

afterEach(() => { vi.unstubAllGlobals(); });

function mockLocal() {
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  vi.stubGlobal('window', { localStorage });
  return localStorage;
}

function mockQz(printers = ['POS-80']) {
  const print = vi.fn().mockResolvedValue(null);
  const create = vi.fn(name => ({ printer: name }));
  const qz = {
    websocket: { isActive: () => true, connect: vi.fn() },
    printers: { find: vi.fn(async () => printers) },
    configs: { create },
    print
  };
  vi.stubGlobal('window', { localStorage: { getItem: () => null }, qz });
  vi.stubGlobal('document', { querySelector: () => ({ textContent: 'TEST', outerHTML: '<div class="receipt-print-area">TEST</div>', classList: {contains:()=>true} }) });
  return { qz, print, create };
}

describe('Native ESC/POS printer safety', () => {
  it('remains disabled by default and isolates each restaurant on the local device', () => {
    mockLocal();
    expect(getNativePrinterConfig('restaurant-a').enabled).toBe(false);
    expect(() => saveNativePrinterConfig('restaurant-a', { enabled: true })).toThrow();
    saveNativePrinterConfig('restaurant-a', { enabled: true, printerName: 'POS-80', cut: true });
    expect(isNativePrintingEnabled('restaurant-a')).toBe(true);
    expect(isNativePrintingEnabled('restaurant-b')).toBe(false);
    expect(getNativePrinterConfig('restaurant-a').printerName).toBe('POS-80');
    saveNativePrinterConfig('restaurant-a', { enabled: false, printerName: 'POS-80' });
    expect(isNativePrintingEnabled('restaurant-a')).toBe(false);
  });

  it('sends HTML as raw ESC/POS with no fixed-length browser page', async () => {
    const { print, create } = mockQz();
    await nativePrintReceiptMarkup('<div class="receipt-print-area">Rice x 1 Rs. 1800</div>',
      { printerName: 'POS-80', paperSetting: '80mm', cut: true });
    expect(create).toHaveBeenCalledWith('POS-80');
    expect(print).toHaveBeenCalledOnce();
    const data = print.mock.calls[0][1];
    expect(data[0]).toMatchObject({ type:'raw', format:'html', flavor:'plain', options: {language:'ESCPOS'} });
    expect(data[0].data).not.toContain('@page');
    expect(data[0].data).toContain('Rice x 1 Rs. 1800');
    expect(data[1]).toContain(String.fromCharCode(29, 86, 0));
  });

  it('never sends a direct job to an unavailable or guessed Windows printer', async () => {
    const { print } = mockQz(['Office Laser']);
    await expect(nativePrintReceiptMarkup('<div>test</div>', { printerName:'POS-80' }))
      .rejects.toThrow(/not available/i);
    expect(print).not.toHaveBeenCalled();
  });

  it('does not send A4 reports to the thermal printer', async () => {
    const { print } = mockQz();
    await expect(nativePrintReceiptMarkup('<div>audit</div>', { printerName:'POS-80', paperSetting:'a4' }))
      .rejects.toThrow(/not A4/i);
    expect(print).not.toHaveBeenCalled();
  });

  it('requires explicit local opt-in for actual receipts', async () => {
    mockLocal();
    await expect(nativePrintReceiptElement('restaurant-a')).rejects.toThrow(/Enable direct printing/i);
  });

  it('sends a small single test job with cut only when requested', async () => {
    const { print } = mockQz();
    await nativePrintTestSlip('POS-80', '58mm', false);
    expect(print).toHaveBeenCalledOnce();
    const data = print.mock.calls[0][1];
    expect(data[0].options.pageWidth).toBeLessThan(2.1);
    expect(data[1]).toBe('\n\n');
  });
});
