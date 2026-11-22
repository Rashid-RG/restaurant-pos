import {describe,it,expect} from 'vitest';
import {CHECKOUT_STEPS,checkoutStepIssue,checkoutReviewLineAmount,smartCheckoutNextStep} from '../apps/customer-web/src/utils/checkout-wizard.js';
const valid={
 hasItems:true,orderType:'delivery',modePaused:false,kitchenClosed:false,
 isScheduled:false,scheduledTimeVal:null,scheduleLoading:false,scheduleError:'',
 name:'Customer Test',phone:'0771234567',entranceConfirmed:true,deliveryQuoteConfirmed:true,
 minimumOrder:500,subtotal:1200,paymentMethod:'cash',cardUnavailable:true
};
describe('five-stage customer checkout navigation',()=>{
 it('express review goes directly to final confirmation only when every previous stage is valid',()=>{
   expect(smartCheckoutNextStep(valid)).toEqual({step:4,issue:'',ready:true});
   expect(smartCheckoutNextStep({...valid,hasItems:false}).step).toBe(0);
   expect(smartCheckoutNextStep({...valid,modePaused:true}).step).toBe(1);
   expect(smartCheckoutNextStep({...valid,phone:''}).step).toBe(2);
   expect(smartCheckoutNextStep({...valid,entranceConfirmed:false}).step).toBe(2);
   expect(smartCheckoutNextStep({...valid,deliveryQuoteConfirmed:false}).step).toBe(2);
   expect(smartCheckoutNextStep({...valid,paymentMethod:'payhere'}).step).toBe(3);
   expect(smartCheckoutNextStep({...valid,orderType:'takeaway',entranceConfirmed:false,deliveryQuoteConfirmed:false}).ready).toBe(true);
 });

 it('keeps the customer-facing steps in expected order',()=>{
   expect(CHECKOUT_STEPS.map(x=>x.id)).toEqual(['cart','fulfilment','details','payment','confirm']);
 });
 it('blocks empty cart and paused mode',()=>{
   expect(checkoutStepIssue(0,{...valid,hasItems:false})).toMatch(/Add an item/);
   expect(checkoutStepIssue(1,{...valid,modePaused:true})).toMatch(/unavailable/);
 });
 it('enforces schedule when the kitchen is closed',()=>{
   expect(checkoutStepIssue(1,{...valid,kitchenClosed:true})).toMatch(/scheduled/);
   expect(checkoutStepIssue(1,{...valid,isScheduled:true,scheduledTimeVal:null})).toMatch(/time/);
   expect(checkoutStepIssue(1,{...valid,isScheduled:true,scheduledTimeVal:Date.now()})).toBe('');
 });
 it('requires verified contact and pinned delivery quote',()=>{
   expect(checkoutStepIssue(2,{...valid,name:''})).toMatch(/name/);
   expect(checkoutStepIssue(2,{...valid,phone:'123'})).toMatch(/mobile/);
   expect(checkoutStepIssue(2,{...valid,entranceConfirmed:false})).toMatch(/entrance/);
   expect(checkoutStepIssue(2,{...valid,deliveryQuoteConfirmed:false})).toMatch(/delivery fee/);
   expect(checkoutStepIssue(2,{...valid,minimumOrder:1500})).toMatch(/minimum/);
   expect(checkoutStepIssue(2,valid)).toBe('');
 });
 it('does not require a delivery pin for pickup',()=>{
   expect(checkoutStepIssue(2,{...valid,orderType:'takeaway',entranceConfirmed:false,deliveryQuoteConfirmed:false})).toBe('');
 });
 it('blocks unavailable payment methods before confirmation',()=>{
   expect(checkoutStepIssue(3,{...valid,paymentMethod:'lankaqr'})).toMatch(/available/);
   expect(checkoutStepIssue(3,{...valid,paymentMethod:'payhere'})).toMatch(/not available/);
   expect(checkoutStepIssue(3,{...valid,paymentMethod:'bank_transfer'})).toBe('');
 });
  it('shows modifier-inclusive cart line totals without changing backend pricing',()=>{
    const lines=[
      {price:1800,unitPrice:2050,qty:2},
      {price:450,unitPrice:450,qty:1}
    ];
    expect(checkoutReviewLineAmount(lines[0])).toBe(4100);
    expect(checkoutReviewLineAmount(lines[1])).toBe(450);
    expect(lines.reduce((total,line)=>total+checkoutReviewLineAmount(line),0)).toBe(4550);
    expect(checkoutReviewLineAmount({price:100,qty:-2})).toBe(0);
    expect(checkoutReviewLineAmount({price:'invalid',qty:1})).toBe(0);
  });
});
