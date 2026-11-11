import {describe,it,expect,vi,afterEach} from 'vitest';
import {printRenderedReceipt} from '../src/utils/printer.js';

afterEach(()=>vi.unstubAllGlobals());

describe('Production receipt print safety',()=>{
  it('refuses to print an unrendered or empty bill',()=>{
    const printer=vi.fn();
    vi.stubGlobal('window',{print:printer});
    vi.stubGlobal('document',{getElementById:()=>null});
    expect(printRenderedReceipt()).toBe(false);
    expect(printer).not.toHaveBeenCalled();
  });
  it('prints a populated bill and restores CSS on afterprint',()=>{
    const printer=vi.fn(),handlers=new Map();
    const classes=new Set();
    const doc={
      body:{classList:{
        toggle:(name,on)=>on?classes.add(name):classes.delete(name),
        add:name=>classes.add(name),
        remove:(...names)=>names.forEach(name=>classes.delete(name))
      }},
      head:{appendChild:vi.fn()},
      createElement:()=>({id:'',innerHTML:''}),
      getElementById:id=>id==='receipt-print-root'
        ? {querySelector:()=>({textContent:'Test restaurant | Rice x2 | Total Rs. 1500 | Paid',offsetHeight:275,scrollHeight:275})}
        : null
    };
    vi.stubGlobal('document',doc);
    vi.stubGlobal('localStorage',{getItem:()=>null});
    vi.stubGlobal('window',{print:printer,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:(key)=>handlers.delete(key)});
    expect(printRenderedReceipt('80mm')).toBe(true);
    expect(printer).toHaveBeenCalledOnce();
    expect(classes.has('printing-receipt')).toBe(true);
    handlers.get('afterprint')();
    expect(classes.has('printing-receipt')).toBe(false);
  });
});
