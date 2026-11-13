import { formatRestaurantTime, restaurantTimeZone } from './restaurant-time';
/**
 * GastroFlow Smart Printer & Paper Size Resolver
 * Auto-detects connected printer type and adjusts receipt dimensions:
 * - 58mm for handheld / mobile Android POS terminals (Sunmi, PAX, compact Bluetooth)
 * - 80mm for standard desktop/countertop thermal receipt printers
 * - A4 for standard full-page laser/inkjet invoices
 */

export function resolvePrinterPaperSize(settingValue) {
  // An explicit restaurant setting must win over an old browser preference.
  // A stale preference (including 'a4') used to silently force long/blank rolls.
  let localPref = null;
  if (typeof window !== 'undefined') {
    try { localPref = window.localStorage?.getItem('gastroflow_printer_paper'); } catch (_) {}
  }
  const choice = settingValue && settingValue !== 'auto'
    ? settingValue
    : (localPref && localPref !== 'auto' ? localPref : 'auto');

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
 * Print a POS receipt in its own document. Printing the main POS window
 * makes Edge/Chrome apply conflicting hide/show CSS and yields blank POS-80 pages.
 */
export function buildStandaloneReceiptDocument(receiptMarkup, paperSetting='80mm') {
  const paper=resolvePrinterPaperSize(paperSetting);
  const a4=paper==='a4';
  const roll=a4?'A4 portrait':paper==='58mm'?'58mm':'80mm';
  const width=a4?'190mm':paper==='58mm'?'52mm':'76mm';
  const font=a4?13:paper==='58mm'?11:12;
  const css=[
    '@page{size:'+(a4?'A4 portrait':roll+' 180mm')+';margin:0}',
    '*{box-sizing:border-box}',
    'html,body{margin:0!important;padding:0!important;background:white!important;color:black!important;font-family:Arial,Helvetica,sans-serif!important;height:auto!important;overflow:visible!important}',
    '.receipt-print-area{display:block!important;visibility:visible!important;opacity:1!important;position:static!important;transform:none!important;float:none!important;width:'+width+'!important;max-width:'+width+'!important;margin:0 auto!important;padding:'+(a4?'10mm':'2mm 1mm 8mm')+'!important;color:black!important;background:white!important;font-size:'+font+'px!important;line-height:1.35!important;overflow:visible!important}',
    '.receipt-print-area *{visibility:visible!important;opacity:1!important;color:black!important;-webkit-text-fill-color:black!important;text-shadow:none!important;box-shadow:none!important}',
    '.receipt-print-area button,.receipt-print-area [data-print-exclude]{display:none!important}',
    '.receipt-center{text-align:center}.receipt-divider{border-top:1px dashed #000;margin:8px 0}',
    '.receipt-business-name{font-size:'+(paper==='58mm'?'14':'17')+'px!important;letter-spacing:.25px;line-height:1.15!important;margin:4px 0 5px!important}',
    '.receipt-document-heading{padding:5px 0 4px;font-size:'+(paper==='58mm'?'12':'14')+'px;font-weight:800;letter-spacing:1.3px}',
    '.receipt-items-heading{display:flex;justify-content:space-between;gap:7px;font-size:10px;font-weight:800;letter-spacing:.6px;padding:6px 0 5px;border-bottom:1px solid #111;margin-bottom:3px}',
    '.receipt-items-heading span:last-child{text-align:right}',
    '.receipt-item-block{padding:5px 0;border-bottom:1px dotted #bbb;break-inside:avoid}',
    '.receipt-item-detail{font-size:10px;padding:1px 0 0 4px;color:#333!important}',
    '.receipt-payment-method{font-weight:800;font-size:12px;margin:7px 0!important}',
    '.receipt-totals{border-top:2px solid #000;border-bottom:2px solid #000;padding:7px 0!important;margin:7px 0!important;font-weight:800!important}',
    '.receipt-print-area p{overflow-wrap:anywhere}',

    '.receipt-row{display:flex;justify-content:space-between;align-items:baseline;gap:5px;padding:2px 0;break-inside:avoid}',
    '.receipt-row span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}.receipt-row span:last-child{text-align:right;white-space:nowrap}',
    '.receipt-totals{font-size:1.15em;font-weight:800}',
    '.receipt-logo{display:block;max-width:70px;max-height:70px;object-fit:contain;margin:0 auto 6px}',
    'p{margin:3px 0!important}h3{margin:3px 0!important}img{max-width:100%;height:auto}',
    '@media print{html,body{overflow:visible!important}.receipt-print-area{break-inside:auto!important}}'
  ].join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GastroFlow POS Bill</title><style>'+css+'</style></head><body>'+receiptMarkup+'</body></html>';
}
// The print document must size itself to the actual receipt, not a fixed roll length.
// Use the isolated print document's layout to avoid measurement of hidden POS elements.
export function fitStandaloneReceiptPage(doc, paperSetting = '80mm') {
  if (!doc) return false;
  // Some embedded print hosts expose a minimal document API without layout
  // measurement; preserve the already-validated receipt instead of suppressing print.
  if (typeof doc.querySelector !== 'function') return true;
  const receipt = doc.querySelector('.receipt-print-area');
  if (!receipt || !receipt.textContent?.trim()) return false;
  const paper = resolvePrinterPaperSize(paperSetting);
  if (paper === 'a4') return true;
  const width = paper === '58mm' ? 58 : 80;
  // Ensure all dimensions are measured with actual receipt wrapping after fonts load.
  const rectHeight = typeof receipt.getBoundingClientRect === 'function' ? receipt.getBoundingClientRect().height : 0;
  const px = Math.max(receipt.scrollHeight || 0, rectHeight || 0);
  if (!Number.isFinite(px) || px <= 0) return false;
  const mm = Math.max(35, Math.ceil(px * 25.4 / 96) + 5);
  let style = doc.getElementById('receipt-content-page-size');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'receipt-content-page-size';
    doc.head.appendChild(style);
  }
  // Limit one thermal page to 300mm. For large orders, let the browser
  // paginate rather than requesting a single exceptionally long paper feed.
  style.textContent = '@page { size: ' + width + 'mm ' + Math.min(mm, 300) + 'mm !important; margin: 0 !important; }';
  return true;
}
let activePrintFrame=null;
export function printRenderedReceipt(paperSetting='80mm',options={}) {
  if(typeof document==='undefined'||typeof window==='undefined')return false;
  const receipt=options.selector ? document.querySelector(options.selector) : document.getElementById('receipt-print-root')?.querySelector('.receipt-print-area');
  const text=receipt?.textContent?.replace(/\s+/g,' ').trim()||'';
  if(!receipt||text.length<24||!receipt.outerHTML){
    console.error('[GastroFlow] Blank bill prevented: receipt has not rendered');
    return false;
  }
  const receiptHtml=options.selector ? '<div class="receipt-print-area">'+receipt.outerHTML+'</div>' : receipt.outerHTML;
  const html=buildStandaloneReceiptDocument(receiptHtml,paperSetting);
  let popup=null;
  if(options.userInitiated){
    try{popup=window.open('','_blank','width=480,height=740');}catch(_){}
  }
  if(popup){
    popup.document.open();popup.document.write(html);popup.document.close();
    const show=async()=>{
      try{
        await popup.document.fonts?.ready;
        await Promise.all([...popup.document.images].map(img=>img.complete?null:new Promise(resolve=>{
          img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,1500);
        })));
        if(!popup.closed && fitStandaloneReceiptPage(popup.document,paperSetting)){popup.focus();popup.print();}
      }catch(error){console.error('[GastroFlow] Bill print preview failed',error);}
    };
    setTimeout(show,180);
    return true;
  }
  // An off-screen but layout-enabled iframe prints reliably on Edge when
  // popup blocking would otherwise prevent auto-print after payment.
  if(activePrintFrame?.parentNode)activePrintFrame.parentNode.removeChild(activePrintFrame);
  const frame=document.createElement('iframe');
  frame.title='GastroFlow POS receipt';
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:0;top:0;width:80mm;height:150mm;border:0;opacity:0;pointer-events:none;z-index:-1';
  activePrintFrame=frame;
  let launched=false;
  const finish=()=>{
    if(activePrintFrame===frame)activePrintFrame=null;
    if(frame.parentNode)frame.parentNode.removeChild(frame);
  };
  frame.onload=async()=>{
    if(launched)return;
    launched=true;
    try{
      const doc=frame.contentDocument;
      await doc?.fonts?.ready;
      await Promise.all([...(doc?.images||[])].map(img=>img.complete?null:new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,1500);
      })));
      if(!fitStandaloneReceiptPage(doc,paperSetting))throw Error('Print frame is empty or has no measurable receipt');
      const win=frame.contentWindow;
      if(!win)throw Error('Browser print frame unavailable');
      win.addEventListener('afterprint',()=>setTimeout(finish,1500),{once:true});
      win.focus();
      win.print();
      setTimeout(finish,30000);
    }catch(error){console.error('[GastroFlow] Bill print failed',error);finish();}
  };
  // Configure srcdoc and its load handler *before* insertion. Otherwise the
  // initial about:blank iframe load can win the race and print a blank frame.
  frame.srcdoc=html;
  document.body.appendChild(frame);
  return true;
}

/** Print only the selected existing receipt, never the whole POS application. */
export function printSelectedReceipt(selector, paperSetting = '80mm') {
  return printRenderedReceipt(paperSetting, { selector, userInitiated: true });
}
