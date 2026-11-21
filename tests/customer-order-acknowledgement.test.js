import {describe,it,expect} from 'vitest';
import {validOrderAcknowledgement,shouldClearCartAfterSubmit} from '../apps/customer-web/src/utils/order-acknowledgement.js';

describe('GastroFood order acknowledgement safety',()=>{
  it('does not accept empty or malformed checkout acknowledgements',()=>{
    for(const response of [null,{},[],{orderId:null},{orderId:10},{orderId:''},{orderId:'   '}]){
      expect(validOrderAcknowledgement(response)).toBe(false);
      expect(shouldClearCartAfterSubmit(response,'cash')).toBe(false);
    }
    expect(validOrderAcknowledgement({orderId:'ord_123'})).toBe(true);
  });
  it('only closes ordinary orders after a valid server reference',()=>{
    expect(shouldClearCartAfterSubmit({orderId:'a',status:'pending'},'cash')).toBe(true);
    expect(shouldClearCartAfterSubmit({orderId:'a',status:'pending',paymentStatus:'unpaid'},'bank_transfer')).toBe(true);
    for(const status of ['cancelled','rejected','refunded','partially_refunded'])
      expect(shouldClearCartAfterSubmit({orderId:'a',status},'cash')).toBe(false);
  });
  it('preserves online carts until server payment settlement is confirmed',()=>{
    expect(shouldClearCartAfterSubmit({orderId:'a',paymentStatus:'pending'},'payhere')).toBe(false);
    expect(shouldClearCartAfterSubmit({orderId:'a',paymentStatus:'unpaid'},'online_pending')).toBe(false);
    expect(shouldClearCartAfterSubmit({orderId:'a',paymentStatus:'paid'},'payhere')).toBe(true);
    expect(shouldClearCartAfterSubmit({orderId:'a',paymentStatus:'paid',status:'refunded'},'payhere')).toBe(false);
  });
});
