import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareGastroBatch,applyGastroBatch} from '../apps/customer-web/src/utils/gastromate-batch.js';

const tenant='shop-A';
const items=[
 {id:'rice',name:'Chicken Rice',price:1200,stock:5,isAvailable:true,modifiers:[]},
 {id:'juice',name:'Lime Juice',price:300,stock:8,isAvailable:1,modifiers:[]},
 {id:'custom',name:'Build Your Burger',price:1300,stock:4,isAvailable:1,modifiers:[{id:1,name:'Cheese'}]},
 {id:'sold',name:'Fries',price:400,stock:0,isAvailable:1,modifiers:[]}
];
const menu={tenantId:tenant,storeOpen:true,items};
const draft={type:'multi_item_preview',tenantId:tenant,totalKnown:true,lines:[
 {itemId:'rice',quantity:2,status:'available',unitPrice:1,lineTotal:2},
 {itemId:'juice',quantity:1,status:'available',unitPrice:1,lineTotal:1}
]};

describe('GastroMate atomic cart validation',()=>{
 it('uses only server prices, not prices inserted into a chat draft',()=>{
  const prepared=prepareGastroBatch(draft,menu,[],tenant);
  expect(prepared.ok).toBe(true);
  expect(prepared.subtotal).toBe(2700);
  expect(prepared.items.map(x=>[x.item.id,x.quantity])).toEqual([['rice',2],['juice',1]]);
  const added=applyGastroBatch([],prepared.items);
  expect(added.map(x=>[x.id,x.qty,x.unitPrice])).toEqual([['rice',2,1200],['juice',1,300]]);
 });
 it('rejects wrong tenant or offline snapshot without any mutation',()=>{
  expect(prepareGastroBatch(draft,{...menu,tenantId:'shop-B'},[],tenant).ok).toBe(false);
  expect(prepareGastroBatch({...draft,tenantId:'shop-B'},menu,[],tenant).ok).toBe(false);
  expect(prepareGastroBatch(draft,{...menu,offlineSnapshot:true},[],tenant).ok).toBe(false);
  expect(prepareGastroBatch(draft,{...menu,storeOpen:false},[],tenant).ok).toBe(false);
 });
 it('requires all lines resolved and rejects customization bypass',()=>{
  expect(prepareGastroBatch({...draft,totalKnown:false},menu,[],tenant).ok).toBe(false);
  const customized={...draft,lines:[draft.lines[0],{itemId:'custom',quantity:1}]};
  expect(prepareGastroBatch(customized,menu,[],tenant).reason).toContain('customization');
 });
 it('enforces stock after counting existing cart and duplicate plan lines',()=>{
  const existing=[{id:'rice',cartId:'rice__',qty:4,unitPrice:1200}];
  expect(prepareGastroBatch(draft,menu,existing,tenant).ok).toBe(false);
  const duplicates={...draft,lines:[{itemId:'rice',quantity:3},{itemId:'rice',quantity:3}]};
  expect(prepareGastroBatch(duplicates,menu,[],tenant).ok).toBe(false);
 });
 it('enforces refreshed budget before adding',()=>{
  expect(prepareGastroBatch({...draft,budget:2600},menu,[],tenant).ok).toBe(false);
  expect(prepareGastroBatch({...draft,budget:3000},menu,[],tenant).ok).toBe(true);
 });
 it('applies a batch atomically and keeps previous cart if one line is invalid',()=>{
  const old=[{id:'juice',cartId:'juice__',qty:1,unitPrice:300}];
  const prepared=prepareGastroBatch(draft,menu,old,tenant);
  const result=applyGastroBatch(old,prepared.items);
  expect(old).toHaveLength(1);
  expect(result).toHaveLength(2);
  expect(result.find(x=>x.id==='juice').qty).toBe(2);
  expect(applyGastroBatch(old,[{item:items[0],quantity:10},{item:items[1],quantity:1}])).toBe(old);
  expect(applyGastroBatch(old,[{item:items[0],quantity:1},{item:items[2],quantity:1}])).toBe(old);
 });
 it('never allows arbitrary AI plans to modify cart without explicit confirmation',()=>{
  const context=readFileSync('apps/customer-web/src/context/CartContext.jsx','utf8');
  const component=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
  expect(context).toContain('setItems(previous => applyGastroBatch(previous, entries))');
  expect(component).toContain('Review complete selection');
  expect(component).toContain('Confirm complete selection');
  expect(component).toContain('prepareGastroBatch(plan, menu, liveCartItems, tenantAtStart)');
  expect(component).toContain("addVerifiedBatch(prepared.items)");
  expect(component).toContain('tenantAtRequest !== getActiveTenant()');
  expect(component).toContain('proposal.tenantId !== getActiveTenant()');
  expect(component).toContain('tenantId:msg.plan.tenantId');
 });
});
