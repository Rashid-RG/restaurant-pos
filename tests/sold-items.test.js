import { describe, expect, it } from 'vitest';
import { summarizeSoldItems, soldItemsPeriod } from '../src/utils/sold-items.js';

const order = (id, timestamp, items, extra = {}) => ({id, timestamp, status:'paid', paymentStatus:'paid', items, ...extra});

describe('Sold Items report', () => {
  it('aggregates confirmed item quantities and gross totals without touching orders', () => {
    const orders = [
      order('a', Date.parse('2026-11-11T10:00:00Z'), [{id:'burger',name:'Burger',quantity:2,price:150},{id:'tea',name:'Tea',quantity:1,price:50}]),
      order('b', Date.parse('2026-11-11T12:00:00Z'), JSON.stringify([{id:'burger',name:'Burger',qty:1,unitPrice:150}])),
      order('c', Date.parse('2026-11-11T12:00:00Z'), [{id:'burger',quantity:8,price:150}], {status:'cancelled', paymentStatus:'unpaid'})
    ];
    const before=JSON.stringify(orders);
    const result=summarizeSoldItems(orders,{timeZone:'Asia/Qatar'});
    expect(result.paidOrderCount).toBe(2);
    expect(result.unitsSold).toBe(4);
    expect(result.grossItemSales).toBe(500);
    expect(result.rows.find(row=>row.name==='Burger')).toMatchObject({quantity:3,gross:450,orders:2});
    expect(JSON.stringify(orders)).toBe(before);
  });
  it('uses each restaurant local date to select the same instant',()=>{
    const orders=[order('a', '2026-11-11T20:30:00Z', [{id:'x',name:'Coffee',quantity:1,price:30}])];
    const date='2026-11-12';
    expect(summarizeSoldItems(orders,{timeZone:'Asia/Dubai',from:date,to:date}).unitsSold).toBe(1);
    expect(summarizeSoldItems(orders,{timeZone:'Asia/Qatar',from:date,to:date}).unitsSold).toBe(0);
  });
  it('does not count missing items or zero quantities',()=>{
    const orders=[order('a',Date.parse('2026-11-11T11:00:00Z'),[]),order('b',Date.parse('2026-11-11T11:00:00Z'),[{name:'Test',quantity:0,price:99}])];
    expect(summarizeSoldItems(orders,{timeZone:'Asia/Qatar'}).unitsSold).toBe(0);
  });
  it('uses local calendar boundaries for preset periods',()=>{
    expect(soldItemsPeriod('week','2026-01-04')).toEqual({from:'2025-12-29',to:'2026-01-04'});
    expect(soldItemsPeriod('month','2026-02-20')).toEqual({from:'2026-02-01',to:'2026-02-20'});
    expect(soldItemsPeriod('all','2026-01-01')).toEqual({from:'',to:''});
  });
});
