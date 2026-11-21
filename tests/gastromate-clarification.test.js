import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gastroClarifyOrder,gastroVerifiedPriceQuestion} from '../lib/gastromate-clarification.js';

const items=[
  {id:'burger1',name:'Chicken Burger',price:1200,isAvailable:1,stock:10},
  {id:'burger2',name:'Spicy Chicken Burger',price:1450,isAvailable:1,stock:8},
  {id:'burger3',name:'Veg Burger',price:1150,isAvailable:0,stock:6},
  {id:'burger4',name:'Fish Burger',price:1050,isAvailable:1,stock:0},
  {id:'fries',name:'French Fries',price:450,isAvailable:1,stock:8}
];
describe('GastroMate order clarification',()=>{
 it('asks a question rather than guessing when multiple burgers match',()=>{
   const result=gastroClarifyOrder(items,'add 2 burger to my cart');
   expect(result.action).toBe(null);
   expect(result.clarification).toEqual({kind:'choose_menu_item',quantity:2});
   expect(result.recommendedItems.map(i=>i.id)).toEqual(['burger1','burger2']);
   expect(result.reply).toContain('Which exact item');
 });
 it('returns no clarification for unambiguous, correctly named food',()=>{
   expect(gastroClarifyOrder(items,'add 2 Chicken Burger')).toBe(null);
   expect(gastroClarifyOrder(items,'order 1 French Fries')).toBe(null);
   expect(gastroClarifyOrder(items,'order 3 chicken burgers')).toBe(null);
 });
 it('rejects unavailable, hidden, out-of-stock or other-tenant items',()=>{
   const result=gastroClarifyOrder(items,'order Veg Burger');
   expect(result.recommendedItems).toEqual([]);
   expect(result.action).toBe(null);
   expect(gastroClarifyOrder(items,'add 5 Fish Burger').recommendedItems).toEqual([]);
   expect(gastroClarifyOrder(items,'add Other Tenant Pizza').recommendedItems).toEqual([]);
 });
 it('enforces quantity and allows word quantities only within bounds',()=>{
   expect(gastroClarifyOrder(items,'add two burgers').clarification.quantity).toBe(2);
   expect(gastroClarifyOrder(items,'order 25 burgers').recommendedItems).toEqual([]);
   expect(gastroClarifyOrder(items,'order 25 burgers').reply).toContain('quantity');
 });
 it('never intercepts ordinary informational questions or private order tracking',()=>{
   expect(gastroClarifyOrder(items,'What is the best burger?')).toBe(null);
   expect(gastroClarifyOrder(items,'Where is my order?')).toBe(null);
 });
 it('answers an exact food price from the verified menu only',()=>{
   const result=gastroVerifiedPriceQuestion(items,'How much is Chicken Burger?');
   expect(result.reply).toContain('Rs. 1200.00');
   expect(result.recommendedItems.map(i=>i.id)).toEqual(['burger1']);
   expect(result.reply).toContain('checkout fees');
 });
 it('clarifies generic price queries without inventing numbers',()=>{
   const result=gastroVerifiedPriceQuestion(items,'price of burger');
   expect(result.recommendedItems.map(i=>i.id)).toEqual(['burger1','burger2']);
   expect(result.reply).not.toContain('Rs.');
   expect(gastroVerifiedPriceQuestion(items,'price of Other Shop Pizza').recommendedItems).toEqual([]);
 });
 it('does not hijack general tax, delivery or unrelated questions',()=>{
   expect(gastroVerifiedPriceQuestion(items,'What are the delivery fees?')).toBe(null);
   expect(gastroVerifiedPriceQuestion(items,'Could you recommend food?')).toBe(null);
 });
 it('integrates clarification before the model and preserves quantity in the UI',()=>{
   const server=readFileSync('server.js','utf8');
   const ui=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
   const chat=server.slice(server.indexOf("app.post('/api/ai/chat'"));
   expect(chat.indexOf('gastroClarifyOrder(menuItems, message)')).toBeLessThan(chat.indexOf('const geminiKey'));
   expect(chat.indexOf('gastroVerifiedPriceQuestion(menuItems, message)')).toBeLessThan(chat.indexOf('const geminiKey'));
   expect(ui).toContain("res.clarification?.kind === 'choose_menu_item'");
   expect(ui).toContain('quantity:msg.clarification?.quantity || 1');
 });
});
