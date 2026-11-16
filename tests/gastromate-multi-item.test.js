import {describe,it,expect} from 'vitest';
import {gastroMultiItemPlan} from '../lib/gastromate-multi-item.js';
import {readFileSync} from 'node:fs';

const menu=[
  {id:'burger',name:'Chicken Burger',price:1200,stock:5,isAvailable:1},
  {id:'fries',name:'French Fries',price:400,stock:6,isAvailable:1},
  {id:'cola',name:'Cola Drink',price:300,stock:8,isAvailable:1},
  {id:'water',name:'Water Drink',price:150,stock:3,isAvailable:1},
  {id:'sold',name:'Onion Rings',price:350,stock:0,isAvailable:1},
  {id:'closed',name:'Hidden Pizza',price:800,stock:4,isAvailable:0}
];

describe('GastroMate multi-item draft',()=>{
  it('parses multiple exact items and computes quantity-aware total',()=>{
    const plan=gastroMultiItemPlan(menu,'Give me 2 chicken burgers, one French Fries and 2 Cola Drink under Rs 4,000');
    expect(plan.type).toBe('multi_item_preview');
    expect(plan.lines.map(i=>i.quantity)).toEqual([2,1,2]);
    expect(plan.lines.map(i=>i.itemId)).toEqual(['burger','fries','cola']);
    expect(plan.totalKnown).toBe(true);
    expect(plan.subtotal).toBe(3400);
    expect(plan.budget).toBe(4000);
    expect(plan.withinBudget).toBe(true);
  });
  it('rejects a bundle over budget, without changing cart',()=>{
    const plan=gastroMultiItemPlan(menu,'Order 3 Chicken Burger and 2 French Fries under Rs 4,000');
    expect(plan.subtotal).toBe(4400);
    expect(plan.withinBudget).toBe(false);
    expect(plan).not.toHaveProperty('action');
  });
  it('asks clarification for ambiguous generic choices',()=>{
    const plan=gastroMultiItemPlan(menu,'Give me two Chicken Burgers, one drink and fries for under Rs. 4,000');
    expect(plan.lines[0].status).toBe('available');
    expect(plan.lines[1].status).toBe('clarify');
    expect(plan.totalKnown).toBe(false);
    expect(plan.withinBudget).toBe(null);
    expect(plan.lines.some(l=>l.phrase==='drink')).toBe(true);
  });
  it('does not recommend another tenant item or unavailable items',()=>{
    const plan=gastroMultiItemPlan(menu,'Add Hidden Pizza and Onion Rings');
    expect(plan.totalKnown).toBe(false);
    expect(plan.lines.every(i=>i.status!=='available')).toBe(true);
    const forbidden=gastroMultiItemPlan(menu,'Add Secret Other Restaurant and Chicken Burger');
    expect(forbidden.lines[0].itemId).toBe(undefined);
    expect(forbidden.lines[1].itemId).toBe('burger');
  });
  it('does not confirm insufficient stock, extreme quantities or arbitrary messages',()=>{
    const plan=gastroMultiItemPlan(menu,'add 6 Chicken Burger and 2 French Fries');
    expect(plan.lines[0].status).toBe('out_of_stock');
    expect(gastroMultiItemPlan(menu,'add 21 Chicken Burger and one French Fries').totalKnown).toBe(false);
    expect(gastroMultiItemPlan(menu,'Tell me about burger ingredients and discounts')).toBe(null);
  });
  it('limits the number of items and avoids invalid budget amounts',()=>{
    expect(gastroMultiItemPlan(menu,'add a,b,c,d,e,f,g')).toBe(null);
    const plan=gastroMultiItemPlan(menu,'add Chicken Burger and French Fries under Rs 999999');
    expect(plan.budget).toBe(null);
  });
  it('only exposes a preview and requires an explicit customer confirmation',()=>{
    const server=readFileSync('server.js','utf8');
    const component=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
    expect(server).toContain('const multiPlan = gastroMultiItemPlan(menuItems, message)');
    expect(server).toContain('action: null,');
    expect(component).toContain("msg.plan?.type === 'multi_item_preview'");
    expect(component).toContain('Review and add this item');
    expect(component).toContain('setPendingAdd({type:');
  });
});
