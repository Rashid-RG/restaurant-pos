import { readFileSync } from 'node:fs';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {printRenderedReceipt,buildStandaloneReceiptDocument,fitStandaloneReceiptPage,resolvePrinterPaperSize} from '../src/utils/printer.js';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('POS-80 receipt print isolation',()=>{
  it('will not print if a customer bill is missing or has not rendered',()=>{
    const printer=vi.fn();
    vi.stubGlobal('window',{print:printer});
    vi.stubGlobal('document',{getElementById:()=>null});
    expect(printRenderedReceipt()).toBe(false);
    expect(printer).not.toHaveBeenCalled();
  });
  it('generates standalone Edge document without app hide/print CSS',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const html=buildStandaloneReceiptDocument('<div class="receipt-print-area">Rice x2 &amp; Cash Rs. 1500</div>','80mm');
    expect(html).toContain('GastroFlow POS Bill');
    expect(html).toContain('@page{size:80mm 180mm');
    expect(html).toContain('Rice x2 &amp; Cash Rs. 1500');
    expect(html).not.toContain('body:not(.printing-receipt)');
    expect(html).not.toContain('body:has(');
    expect(html).toContain('visibility:visible!important');
  });
  it('prints a populated manual POS bill from a separate window rather than the app',async()=>{
    vi.useFakeTimers();
    const print=vi.fn(),parentPrint=vi.fn();
    const popupDoc={open:vi.fn(),write:vi.fn(),close:vi.fn(),images:[],fonts:{ready:Promise.resolve()}};
    const popup={document:popupDoc,focus:vi.fn(),print,closed:false};
    vi.stubGlobal('localStorage',{getItem:()=>null});
    vi.stubGlobal('window',{open:vi.fn(()=>popup),print:parentPrint});
    vi.stubGlobal('document',{getElementById:id=>id==='receipt-print-root'
      ? {querySelector:()=>({textContent:'Shop | Fried rice x2 | Paid Rs. 1500',
          outerHTML:'<div class="receipt-print-area">Shop | Fried rice x2 | Paid Rs. 1500</div>'})}
      : null});
    expect(printRenderedReceipt('80mm',{userInitiated:true})).toBe(true);
    expect(popupDoc.write).toHaveBeenCalledOnce();
    expect(parentPrint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(print).toHaveBeenCalledOnce();
  });
});

describe('Thermal roll length safety',()=>{
  it.each([['58mm',58],['80mm',80]])('fits %s print page to rendered content', (paper,width)=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const page={id:'receipt-content-page-size',textContent:''};
    const receipt={textContent:'Rice x 2 | Rs 1800',scrollHeight:240,getBoundingClientRect:()=>({height:240})};
    const doc={querySelector:()=>receipt,getElementById:()=>null,createElement:()=>page,head:{appendChild:vi.fn()}};
    expect(fitStandaloneReceiptPage(doc,paper)).toBe(true);
    expect(page.textContent).toContain('size: '+width+'mm 69mm');
    expect(page.textContent).not.toContain('180mm');
  });
  it('never prepares a blank receipt for printing',()=>{
    const doc={querySelector:()=>({textContent:''}),getElementById:()=>null};
    expect(fitStandaloneReceiptPage(doc,'80mm')).toBe(false);
  });
});

describe('Windows thermal printer regressions',()=>{
  it('honors explicit restaurant 80mm setting even with stale A4 browser preference',()=>{
    vi.stubGlobal('window',{localStorage:{getItem:()=> 'a4'}});
    expect(resolvePrinterPaperSize('80mm')).toBe('80mm');
    expect(resolvePrinterPaperSize('58mm')).toBe('58mm');
  });
  it('uses stored preference only for auto-detection mode',()=>{
    vi.stubGlobal('window',{innerWidth:1200,localStorage:{getItem:()=> '58mm'}});
    expect(resolvePrinterPaperSize('auto')).toBe('58mm');
  });
  it('prepares the receipt iframe before inserting it into the DOM',()=>{
    const receipt={textContent:'Restaurant | 1 x fried rice | TOTAL Rs. 1,800',outerHTML:'<div class="receipt-print-area">Restaurant | 1 x fried rice | TOTAL Rs. 1,800</div>'};
    let inserted=false;
    const frame={
      style:{cssText:''},setAttribute:vi.fn(),parentNode:null,
      set onload(fn){this.loadHandler=fn;},get onload(){return this.loadHandler;},
      set srcdoc(value){this.receiptDocument=value;},get srcdoc(){return this.receiptDocument;}
    };
    vi.stubGlobal('window',{localStorage:{getItem:()=>null},innerWidth:1200});
    vi.stubGlobal('document',{
      getElementById:()=>({querySelector:()=>receipt}),
      createElement:()=>frame,
      body:{appendChild:vi.fn(node=>{
        expect(node.onload).toBeTypeOf('function');
        expect(node.srcdoc).toContain('TOTAL Rs. 1,800');
        inserted=true;
      })}
    });
    expect(printRenderedReceipt('80mm')).toBe(true);
    expect(inserted).toBe(true);
  });
  it('caps exceptional receipt pages at 300mm rather than requesting a long feed',()=>{
    vi.stubGlobal('window',{localStorage:{getItem:()=>null}});
    const page={textContent:''};
    const doc={
      querySelector:()=>({textContent:'A populated very long order',scrollHeight:4000,getBoundingClientRect:()=>({height:4000})}),
      getElementById:()=>null,createElement:()=>page,head:{appendChild:vi.fn()}
    };
    expect(fitStandaloneReceiptPage(doc,'80mm')).toBe(true);
    expect(page.textContent).toContain('80mm 300mm');
  });
});

describe('Shift close and manager report printing',()=>{
  it('prints Z-report without changing the whole POS print mode',()=>{
    const source=readFileSync(new URL('../src/components/POSView.jsx', import.meta.url),'utf8');
    const start=source.indexOf('🖨️ Print Z-Report');
    expect(start).toBeGreaterThan(0);
    const preceding=source.slice(start-600,start);
    expect(preceding).toContain("printSelectedReceipt('#z-report-print'");
    expect(preceding).not.toContain('window.print()');
    expect(preceding).not.toContain("classList.add('printing-receipt')");
  });
  it('prints X-report in isolation and warns before opening the A4 audit print dialog',()=>{
    const source=readFileSync(new URL('../src/components/Dashboard.jsx',import.meta.url),'utf8');
    expect(source).toContain('id="x-report-print"');
    expect(source).toContain("printSelectedReceipt('#x-report-print'");
    expect(source).toContain('Sales Audit is an A4 report');
    expect(source).not.toContain('onClick={() => window.print()}>🖨️ Print X-Report');
  });
  it('never includes report print controls in standalone receipt output',()=>{
    vi.stubGlobal('window',{localStorage:{getItem:()=>null}});
    const html=buildStandaloneReceiptDocument('<div class="receipt-print-area">Shift report<button>Print</button></div>','80mm');
    expect(html).toContain('.receipt-print-area button,.receipt-print-area [data-print-exclude]{display:none!important}');
  });
});
