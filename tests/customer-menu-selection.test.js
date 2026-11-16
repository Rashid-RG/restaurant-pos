import {describe,it,expect} from 'vitest';
import {isMenuItemAvailable,maxMenuItemQuantity,validMenuQuantity,menuItemTotal,isRequiredModifierMissing,toggleMenuModifier,validateMenuModifiers,remainingMenuQuantity} from '../apps/customer-web/src/utils/menu-selection.js';

describe('GastroFood menu selection safety',()=>{
 it('uses POS availability and live stock together',()=>{
   expect(isMenuItemAvailable({isAvailable:false,stock:8})).toBe(false);
   expect(isMenuItemAvailable({isAvailable:0,stock:8})).toBe(false);
   expect(isMenuItemAvailable({isAvailable:true,stock:0})).toBe(false);
   expect(isMenuItemAvailable({isAvailable:true,stock:2})).toBe(true);
   expect(maxMenuItemQuantity({isAvailable:true,stock:2})).toBe(2);
   expect(maxMenuItemQuantity({isAvailable:false,stock:20})).toBe(0);
 });
 it('disallows negative/fractional/oversold quantities',()=>{
   const item={price:500,stock:3,isAvailable:true};
   for(const q of [-1,0,1.5,4,101,NaN])expect(validMenuQuantity(q,item)).toBe(false);
   expect(validMenuQuantity(3,item)).toBe(true);
   expect(maxMenuItemQuantity({price:200,stock:null})).toBe(100);
 });
 it('calculates numeric modifier totals even if API returns price strings',()=>{
   const item={price:'1000',stock:7,isAvailable:true};
   const mods=[{id:'a',priceDelta:'200'},{id:'b',priceDelta:50}];
   expect(menuItemTotal(item,2,mods)).toBe(2500);
   expect(menuItemTotal(item,8,mods)).toBe(null);
   expect(menuItemTotal({price:'not-a-number'},1)).toBe(null);
   expect(menuItemTotal({price:500},1,[{priceDelta:NaN}])).toBe(null);
 });
 it('requires selections for required groups but ignores optional groups',()=>{
   const groups={Size:[{isRequired:1}],Extras:[{isRequired:0}]};
   expect(isRequiredModifierMissing(groups,[])).toBe(true);
   expect(isRequiredModifierMissing(groups,[{groupName:'Size',id:'large'}])).toBe(false);
 });
 it('keeps radio modifier groups exclusive and multi-select groups independently selectable',()=>{
   const size1={id:'small',groupName:'Size',priceDelta:0};
   const size2={id:'large',groupName:'Size',priceDelta:100};
   const extra={id:'cheese',groupName:'Extras',priceDelta:50};
   const chosen=toggleMenuModifier([],size1,'Size',false);
   const replaced=toggleMenuModifier(chosen,size2,'Size',false);
   expect(replaced).toEqual([size2]);
   const more=toggleMenuModifier(replaced,extra,'Extras',true);
   expect(more).toHaveLength(2);
   expect(toggleMenuModifier(more,extra,'Extras',true)).toEqual([size2]);
 });
 it('rejects missing required groups, unknown choices and duplicate single-select options',()=>{
   const item={modifiers:[
     {id:'small',groupName:'Size',isRequired:true,isMultiSelect:false},
     {id:'large',groupName:'Size',isRequired:true,isMultiSelect:false},
     {id:'cheese',groupName:'Extras',isRequired:false,isMultiSelect:true},
   ]};
   expect(validateMenuModifiers(item,[])).toBe(false);
   expect(validateMenuModifiers(item,[{id:'small',groupName:'Size'}])).toBe(true);
   expect(validateMenuModifiers(item,[{id:'small',groupName:'Size'},{id:'large',groupName:'Size'}])).toBe(false);
   expect(validateMenuModifiers(item,[{id:'fake',groupName:'Size'}])).toBe(false);
   expect(validateMenuModifiers(item,[{id:'small',groupName:'Size'},{id:'cheese',groupName:'Extras'}])).toBe(true);
 });
 it('respects quantity already in cart across variants',()=>{
   const item={isAvailable:true,stock:4,price:800};
   expect(remainingMenuQuantity(item,3)).toBe(1);
   expect(remainingMenuQuantity(item,4)).toBe(0);
   expect(remainingMenuQuantity(item,7)).toBe(0);
   expect(remainingMenuQuantity(item,NaN)).toBe(0);
 });
});
