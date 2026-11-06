/**
 * GastroFlow Smart Printer & Paper Size Resolver
 * Auto-detects connected printer type and adjusts receipt dimensions:
 * - 58mm for handheld / mobile Android POS terminals (Sunmi, PAX, compact Bluetooth)
 * - 80mm for standard desktop/countertop thermal receipt printers
 * - A4 for standard full-page laser/inkjet invoices
 */

export function resolvePrinterPaperSize(settingValue) {
  const localPref = typeof window !== 'undefined' ? localStorage.getItem('gastroflow_printer_paper') : null;
  const choice = localPref || settingValue || 'auto';

  if (choice === '58mm' || choice === '80mm' || choice === 'a4') {
    return choice;
  }

  // Automatic detection
  if (typeof window !== 'undefined') {
    const isMobileWidth = window.innerWidth <= 540;
    const isHandheldPOS = /Android.*(POS|Sunmi|PAX|TPS|Q2|V2|M1)|Mobile/i.test(navigator.userAgent);
    if (isMobileWidth || isHandheldPOS) {
      return '58mm';
    }
  }

  // Default to standard 80mm POS receipt roll
  return '80mm';
}

export function testPrintReceipt(settings = {}, currencySymbol = 'Rs.') {
  const paper = resolvePrinterPaperSize(settings.printerPaperWidth);
  const storeName = settings.restaurantName || settings.businessName || 'GastroFlow Store';
  
  const testWindow = window.open('', '_blank', 'width=450,height=600');
  if (!testWindow) {
    alert('Please allow popups to test print.');
    return;
  }

  const paperWidth = paper === '58mm' ? '56mm' : paper === 'a4' ? '190mm' : '78mm';
  const fontSize = paper === '58mm' ? '11px' : paper === 'a4' ? '13px' : '12px';

  testWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>GastroFlow Printer Test</title>
        <style>
          @page { margin: 0; size: ${paper === 'a4' ? 'A4 portrait' : paper === '58mm' ? '58mm auto' : '80mm auto'}; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            margin: 0;
            padding: 8px;
            color: #000;
            background: #fff;
            width: ${paperWidth};
            max-width: 100%;
            font-size: ${fontSize};
            line-height: 1.35;
          }
          .center { text-align: center; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; padding: 2px 0; }
          .bold { font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="center">
          <div style="font-size: 24px;">🍽️</div>
          <h3 style="margin: 2px 0; font-size: 15px; text-transform: uppercase;">${storeName}</h3>
          <p style="margin: 2px 0; font-size: 11px;">PRINTER ALIGNMENT TEST SLIP</p>
          <p style="margin: 2px 0; font-size: 11px;">Profile: ${paper.toUpperCase()} (${paperWidth})</p>
        </div>
        <div class="divider"></div>
        <div class="row"><span>Date & Time:</span><span>${new Date().toLocaleString()}</span></div>
        <div class="row"><span>Paper Setting:</span><span class="bold">${paper.toUpperCase()}</span></div>
        <div class="row"><span>Device Width:</span><span>${window.innerWidth}px</span></div>
        <div class="divider"></div>
        <div class="row"><span>1x Sample Burger</span><span>${currencySymbol} 850.00</span></div>
        <div class="row"><span>1x Fresh Orange Juice</span><span>${currencySymbol} 450.00</span></div>
        <div class="divider"></div>
        <div class="row bold" style="font-size: 14px;"><span>TEST TOTAL:</span><span>${currencySymbol} 1,300.00</span></div>
        <div class="divider"></div>
        <div class="center" style="margin-top: 10px;">
          <p class="bold">✅ Printer Connected Correctly!</p>
          <p style="font-size: 10px;">GastroFlow Intelligent POS Print Engine</p>
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 800);
          };
        </script>
      </body>
    </html>
  `);
  testWindow.document.close();
}

