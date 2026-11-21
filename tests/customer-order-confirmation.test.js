import {describe,it,expect} from 'vitest';
import {confirmationIsClosed,confirmationPaymentLabel,confirmationTotal} from '../apps/customer-web/src/utils/order-confirmation.js';
describe('order receipt remains truthful after OTP',()=>{
 it('distinguishes a closed order from a confirmed active order',()=>{
   expect(confirmationIsClosed('delivered')).toBe(false);
   expect(confirmationIsClosed('pending')).toBe(false);
   for(const status of ['cancelled','rejected','refunded','partially_refunded'])expect(confirmationIsClosed(status)).toBe(true);
 });
 it('never calls an unpaid cash or transfer order paid',()=>{
   expect(confirmationPaymentLabel({paymentMethod:'cash',paymentStatus:'pending'})).toBe('Pay at handover / collection');
   expect(confirmationPaymentLabel({paymentMethod:'bank_transfer',paymentStatus:'pending'})).toMatch(/awaiting verification/);
   expect(confirmationPaymentLabel({paymentMethod:'online_pending',paymentStatus:'pending'})).toBe('Payment pending');
   expect(confirmationPaymentLabel({paymentMethod:'cash',paymentStatus:'paid'})).toBe('Payment confirmed');
 });
 it('does not display invalid, negative, or missing totals',()=>{
   for(const total of [null,undefined,'',-1,'not a number'])expect(confirmationTotal({total})).toBe(null);
   expect(confirmationTotal({total:1949})).toBe(1949);
   expect(confirmationTotal({total:0})).toBe(0);
 });
});
