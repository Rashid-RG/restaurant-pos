import {describe,it,expect} from 'vitest';
import {deliveryQuoteKey,validDeliveryQuote,deliveryQuoteReady} from '../apps/customer-web/src/utils/delivery-quote.js';

describe('GastroFood delivery quote authorization in checkout UI',()=>{
  const key=deliveryQuoteKey({tenantId:'shop-a',lat:6.9271,lng:79.8612,subtotal:1800});
  it('requires a real store, valid pin and finite subtotal',()=>{
    expect(key).toBeTruthy();
    expect(deliveryQuoteKey({lat:6.9271,lng:79.8612,subtotal:1800})).toBeNull();
    expect(deliveryQuoteKey({tenantId:'shop-a',lat:91,lng:79.8,subtotal:200})).toBeNull();
    expect(deliveryQuoteKey({tenantId:'shop-a',lat:6.9,lng:181,subtotal:200})).toBeNull();
    expect(deliveryQuoteKey({tenantId:'shop-a',lat:null,lng:79.8,subtotal:200})).toBeNull();
    expect(deliveryQuoteKey({tenantId:'shop-a',lat:6.9,lng:79.8,subtotal:-1})).toBeNull();
  });
  it('cannot accept a stale quote from a different store, pin or subtotal',()=>{
    const quote={key,status:'ready',data:{totalFee:200}};
    expect(deliveryQuoteReady({type:'delivery',key,quote})).toBe(true);
    for(const changed of [
      {tenantId:'shop-b',lat:6.9271,lng:79.8612,subtotal:1800},
      {tenantId:'shop-a',lat:6.9272,lng:79.8612,subtotal:1800},
      {tenantId:'shop-a',lat:6.9271,lng:79.8612,subtotal:1900},
    ]) expect(deliveryQuoteReady({type:'delivery',key:deliveryQuoteKey(changed),quote})).toBe(false);
  });
  it('rejects unconfirmed, unavailable and out-of-range fees',()=>{
    expect(validDeliveryQuote({isOutOfRange:true,totalFee:0})).toBe(false);
    expect(validDeliveryQuote({totalFee:-1})).toBe(false);
    expect(validDeliveryQuote({totalFee:NaN})).toBe(false);
    expect(validDeliveryQuote({totalFee:0})).toBe(true);
    expect(deliveryQuoteReady({type:'delivery',key,quote:{key,status:'checking',data:{totalFee:0}}})).toBe(false);
    expect(deliveryQuoteReady({type:'delivery',key,quote:{key,status:'ready',data:{isOutOfRange:true,totalFee:0}}})).toBe(false);
    expect(deliveryQuoteReady({type:'takeaway',key:null,quote:null})).toBe(true);
  });
});
