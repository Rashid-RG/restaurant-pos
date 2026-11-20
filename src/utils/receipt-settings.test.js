import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_CONFIG, readReceiptConfig, receiptFooterMessage, shouldPrintSubtotal, shouldPrintTax } from './receipt-settings';

describe('tenant receipt presentation settings', () => {
  it('defaults to compact, private invoice number, and customer order ID', () => {
    const config = readReceiptConfig({});
    expect(config.layout).toBe('compact');
    expect(config.showInvoiceNumber).toBe(false);
    expect(config.showOrderId).toBe(true);
    expect(receiptFooterMessage(config)).toContain('Visit again');
  });
  it('accepts tenant persisted values and rejects unsupported layouts and logo dimensions', () => {
    const config = readReceiptConfig({smartReceiptConfig:JSON.stringify({layout:'detailed',logoSize:80,showInvoiceNumber:true})});
    expect(config.layout).toBe('detailed');
    expect(config.logoSize).toBe(80);
    expect(config.showInvoiceNumber).toBe(true);
    expect(readReceiptConfig({smartReceiptConfig:'{"layout":"unknown","logoSize":999}'}).logoSize).toBe(46);
  });
  it('never hides nonzero taxes even when hide zero tax is selected', () => {
    expect(shouldPrintTax({tax:45},readReceiptConfig({}))).toBe(true);
    expect(shouldPrintTax({tax:0},readReceiptConfig({}))).toBe(false);
    expect(shouldPrintTax({tax:0},readReceiptConfig({smartReceiptConfig:JSON.stringify({hideZeroTax:false})}))).toBe(true);
  });
  it('shows subtotal automatically when the total differs', () => {
    expect(shouldPrintSubtotal({subtotal:80,total:80},DEFAULT_RECEIPT_CONFIG)).toBe(false);
    expect(shouldPrintSubtotal({subtotal:80,total:90},DEFAULT_RECEIPT_CONFIG)).toBe(true);
  });
  it('bounds custom footer text and handles malformed settings safely', () => {
    expect(readReceiptConfig({smartReceiptConfig:'garbage'}).layout).toBe('compact');
    const config=readReceiptConfig({smartReceiptConfig:JSON.stringify({footer:'custom',customMessage:'x'.repeat(300)})});
    expect(receiptFooterMessage(config)).toHaveLength(120);
  });
});
