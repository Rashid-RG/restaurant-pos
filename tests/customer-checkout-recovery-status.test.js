import {describe,it,expect} from 'vitest';
import {recoveryDecision} from '../apps/customer-web/src/utils/order-recovery-status.js';

describe('GastroFood interrupted checkout recovery',()=>{
  it('does not mark a pending online payment as completed',()=>{
    const order={orderId:'existing-order',status:'pending',paymentStatus:'pending'};
    const result=recoveryDecision(order,'online_pending');
    expect(result.action).toBe('track');
    expect(result.clearCart).toBe(false);
    expect(result.message).toMatch(/not confirmed/i);
    expect(recoveryDecision({...order,paymentStatus:'unpaid'},'payhere').clearCart).toBe(false);
  });
  it('clears a matching cart for server-confirmed paid orders',()=>{
    expect(recoveryDecision({orderId:'o1',paymentStatus:'paid'},'online_pending').clearCart).toBe(true);
  });
  it('does not clear the cart when an existing order is closed',()=>{
    expect(recoveryDecision({orderId:'o1',status:'cancelled'},'cash').clearCart).toBe(false);
    expect(recoveryDecision({orderId:'o1',status:'refunded'},'online_pending').clearCart).toBe(false);
  });
  it('never claims success without an order identifier',()=>{
    const result=recoveryDecision({paymentStatus:'paid'},'cash');
    expect(result.action).toBe('retry');
    expect(result.clearCart).toBeUndefined();
  });
  it('allows ordinary cash/bank existing orders to open tracking',()=>{
    expect(recoveryDecision({orderId:'o2',paymentStatus:'unpaid'},'cash').clearCart).toBe(true);
    expect(recoveryDecision({orderId:'o2',paymentStatus:'pending'},'bank_transfer').clearCart).toBe(true);
  });
});
