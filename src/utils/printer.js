import { formatRestaurantTime, restaurantTimeZone } from './restaurant-time';
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

  const paperWidth = paper === '58mm' ? '52mm' : paper === 'a4' ? '190mm' : '76mm';
  const rollWidth = paper === '58mm' ? '58mm' : paper === 'a4' ? '210mm' : '80mm';
  const fontSize = paper === '58mm' ? '11px' : paper === 'a4' ? '13px' : '12px';
  const pageHeight = paper === 'a4' ? '297mm' : '110mm';

  testWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>GastroFlow Printer Test</title>
        <style>
          @page { margin: 0; size: ${paper === 'a4' ? 'A4 portrait' : `${rollWidth} ${pageHeight}`}; }
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
        <div class="row"><span>Date & Time:</span><span>${formatRestaurantTime(new Date(), restaurantTimeZone(settings))}</span></div>
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
            // Measure the actual test slip: avoid 110mm fixed-length blank tails.
            if ('${paper}' !== 'a4') {
              var height = Math.min(600, Math.max(35, Math.ceil(document.body.scrollHeight / 3.7795) + 5));
              var compactPage = document.createElement('style');
              compactPage.textContent = '@page { size: ${rollWidth} ' + height + 'mm !important; margin: 0 !important; }';
              document.head.appendChild(compactPage);
            }
            window.print();
            setTimeout(function() { window.close(); }, 800);
          };
        </script>
      </body>
    </html>
  `);
  testWindow.document.close();
}

/**
 * Programmatically measures receipt DOM content and injects exact @page dimensions
 * into the document head prior to window.print().
 * This prevents Chromium from falling back to default driver page length (297mm / A4)
 * which causes thermal printers to feed excessive trailing blank paper before cutting.
 */
export function prepareThermalPrint(elementOrSelector, paperSetting = '80mm') {
  if (typeof document === 'undefined') return { widthMm: 80, totalHeightMm: 120 };

  const resolved = resolvePrinterPaperSize(paperSetting);
  if (resolved === 'a4') {
    let styleEl = document.getElementById('dynamic-thermal-page-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamic-thermal-page-style';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
      @page {
        size: A4 portrait !important;
        margin: 8mm !important;
      }
    `;
    return { widthMm: 210, totalHeightMm: 297 };
  }

  const is58mm = resolved === '58mm';
  const widthMm = is58mm ? 58 : 80;
  const contentWidthMm = is58mm ? 52 : 76;

  let el = typeof elementOrSelector === 'string'
    ? document.querySelector(elementOrSelector)
    : elementOrSelector;

  if (!el) {
    el = document.getElementById('receipt-print-root') || document.querySelector('.receipt-print-area') || document.querySelector('.z-report-print-area');
  }

  let measuredPx = 0;
  if (el) {
    // If the element has height in layout, measure directly;
    // otherwise create an invisible off-screen clone to measure real height with exact typography & wrapping!
    if (el.offsetHeight > 0 || el.scrollHeight > 0) {
      measuredPx = Math.max(el.offsetHeight, el.scrollHeight);
    } else {
      try {
        const clone = el.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.left = '-9999px';
        clone.style.top = '0px';
        clone.style.width = `${contentWidthMm}mm`;
        clone.style.maxWidth = `${contentWidthMm}mm`;
        clone.style.visibility = 'hidden';
        clone.style.display = 'block';
        clone.style.height = 'auto';
        clone.style.margin = '0';
        clone.style.padding = '1mm 2mm 0mm 2mm';
        clone.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, monospace';
        clone.style.fontSize = is58mm ? '11px' : '12px';
        clone.style.lineHeight = '1.3';
        document.body.appendChild(clone);
        measuredPx = Math.max(clone.offsetHeight || 0, clone.scrollHeight || 0);
        document.body.removeChild(clone);
      } catch (_) {
        measuredPx = 0;
      }
    }
  }

  // 96 CSS pixels = 1 inch = 25.4mm  =>  1mm = 3.7795px
  // Allow room for delayed fonts and thermal-printer blade. Never truncate the preview.
  let totalHeightMm = measuredPx > 0
    ? Math.ceil(measuredPx / 3.7795) + 15
    : (is58mm ? 150 : 180);

  // Safety clamps: never less than 35mm, never more than 1500mm
  if (totalHeightMm < 85) totalHeightMm = 85;
  if (totalHeightMm > 1500) totalHeightMm = 1500;

  let styleEl = document.getElementById('dynamic-thermal-page-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-thermal-page-style';
    document.head.appendChild(styleEl);
  }

  styleEl.innerHTML = `
    @page {
      size: ${widthMm}mm ${totalHeightMm}mm !important;
      margin: 0mm !important;
    }
    @media print {
      html, body {
        width: ${widthMm}mm !important;
        height: auto !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      #receipt-print-root, .receipt-print-area, .z-report-print-area {
        width: ${contentWidthMm}mm !important;
        max-width: ${contentWidthMm}mm !important;
        min-height: 0 !important;
        height: auto !important;
        margin: 0 auto !important;
        padding: 1mm 2mm 0mm 2mm !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
  `;

  return { widthMm, totalHeightMm };
}

export function cleanupThermalPrint() {
  if (typeof document === 'undefined') return;
  const styleEl = document.getElementById('dynamic-thermal-page-style');
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl);
  }
}


/**
 * Prevent blank customer bills when the receipt has not mounted yet.
 * Keep its print CSS active until the browser finishes the print dialog.
 */
let finishActiveReceiptPrint = null;
export function printRenderedReceipt(paperSetting = '80mm') {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const root = document.getElementById('receipt-print-root');
  const receipt = root?.querySelector('.receipt-print-area');
  const billText = receipt?.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!receipt || billText.length < 24) {
    console.error('[GastroFlow] Printing cancelled: the receipt has no rendered bill content.');
    return false;
  }
  if (finishActiveReceiptPrint) finishActiveReceiptPrint();
  const paper=resolvePrinterPaperSize(paperSetting);
  document.body.classList.toggle('print-58mm', paper === '58mm');
  document.body.classList.add('printing-receipt');
  prepareThermalPrint(receipt, paper);
  let timer;
  const finish=()=>{
    window.removeEventListener('afterprint',finish);
    if(timer)clearTimeout(timer);
    document.body.classList.remove('print-58mm','printing-receipt');
    cleanupThermalPrint();
    if(finishActiveReceiptPrint===finish)finishActiveReceiptPrint=null;
  };
  finishActiveReceiptPrint=finish;
  window.addEventListener('afterprint',finish,{once:true});
  try {
    timer=setTimeout(finish,30000);
    window.print();
    return true;
  } catch(e) {
    finish();
    console.error('[GastroFlow] Receipt printing failed',e);
    return false;
  }
}
