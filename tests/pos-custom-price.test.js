import {describe,it,expect} from 'vitest';
import {resolveAndCalculateBill} from '../lib/billing.js';
import {buildStandaloneReceiptDocument} from '../src/utils/printer.js';

const menu={id:'rice',name:'Full Rice',price:1800,cost:700,stock:100,isAvailable:1};
const dbGet=async(sql,args)=>{
  if(sql.includes('FROM menu_items'))return args[0]==='rice'?menu:null;
  if(sql.includes('FROM modifiers'))return null;
  if(sql.includes('FROM settings'))return {value:'0'};
  return null;
};
const price=(cart,allow=false)=>resolveAndCalculateBill({dbGet,tenantId:'restaurant-A'},cart,null,0,0,0,null,0,{allowStaffPriceOverride:allow});

describe('One-off POS price overrides',()=>{
  it('charges Rs. 2000 once while the catalog remains Rs. 1800',async()=>{
    const result=await price([{id:'rice',quantity:2,customUnitPrice:2000}],true);
    expect(result.subtotal).toBe(4000);
    expect(result.total).toBe(4000);
    expect(result.resolvedItems[0].unitPrice).toBe(2000);
    expect(result.resolvedItems[0].menuPrice).toBe(1800);
    expect(result.resolvedItems[0].lineTotal).toBe(4000);
    expect(menu.price).toBe(1800);
  });
  it('requires server approval for price overrides, including public checkout',async()=>{
    await expect(price([{id:'rice',quantity:1,customUnitPrice:2000}])).rejects.toThrow('restricted');
  });
  it('prevents negative, zero, malformed and excessively precise amounts',async()=>{
    for(const val of [0,-1,Infinity,NaN,1800.001,'2000',10000001]){
      await expect(price([{id:'rice',quantity:1,customUnitPrice:val}],true)).rejects.toThrow();
    }
  });
  it('keeps standard menu pricing unchanged',async()=>{
    const standard=await price([{id:'rice',quantity:1}],false);
    expect(standard.subtotal).toBe(1800);
    expect(standard.resolvedItems[0].customUnitPrice).toBeUndefined();
  });
});
describe('Modern thermal bill styles',()=>{
  it.each(['58mm','80mm'])('renders monochrome %s receipt with readable itemized layout',paper=>{
    const html=buildStandaloneReceiptDocument('<div class="receipt-print-area"><h3 class="receipt-business-name">Test Store</h3><div class="receipt-items-heading">ITEM · QTY</div><div class="receipt-row">Rice x1 Rs. 2000.00</div></div>',paper);
    expect(html).toContain('receipt-items-heading');
    expect(html).toContain('receipt-business-name');
    expect(html).toContain('receipt-totals');
    expect(html).toContain('color:black!important');
    expect(html).toContain('Rice x1 Rs. 2000.00');
    expect(html).toContain(paper);
  });
});
