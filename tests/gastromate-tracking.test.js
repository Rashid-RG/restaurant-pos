import { describe, it, expect } from 'vitest';
import { isTrackingIntent, selectTrackableOrders, safeOrderChoice } from '../apps/customer-web/src/utils/gastromate-tracking.js';

describe('GastroMate secure order handoff', () => {
  it('recognizes order tracking intents without calling the LLM', () => {
    for (const text of ['Track my order','where is my order','Where is the driver?', 'order status', 'my orders', 'delivery status']) {
      expect(isTrackingIntent(text)).toBe(true);
    }
    expect(isTrackingIntent('recommend a spicy burger')).toBe(false);
    expect(isTrackingIntent('order 2 burgers')).toBe(false);
  });
  it('never trusts malformed or unbounded order identifiers', () => {
    const result=selectTrackableOrders([
      {id:'valid-1',status:'preparing',timestamp:1740000000000},
      {id:'bad/slash',status:'ready'},
      {id:'<script>',status:'ready'},
      {id:1234,status:'ready'},
      {id:'x'.repeat(101),status:'ready'}
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid-1');
  });
  it('places active orders ahead of terminal orders and limits display to six', () => {
    const orders=[{id:'done',status:'delivered'},...Array.from({length:9},(_,i)=>({id:'a'+i,status:'preparing'}))];
    const result=selectTrackableOrders(orders);
    expect(result).toHaveLength(6);
    expect(result.map(o=>o.id)).not.toContain('done');
  });
  it('rejects forged order choices that are not returned by authenticated history', () => {
    const choices=selectTrackableOrders([{id:'ownedA',status:'ready'}]);
    expect(safeOrderChoice({id:'ownedA'},choices)?.id).toBe('ownedA');
    expect(safeOrderChoice({id:'tenantB'},choices)).toBe(null);
    expect(safeOrderChoice(null,choices)).toBe(null);
  });
  it('displays a bounded status string, not raw order objects or private details', () => {
    const result=selectTrackableOrders([{
      id:'order_ABC12345678',status:'preparing',timestamp:1740000000000,
      customerPhone:'0712223333',deliveryAddress:'private house',paymentMethod:'cash',
      items:[{name:'Burger',price:2500}]
    }]);
    expect(Object.keys(result[0]).sort()).toEqual(['dateLabel','id','label','statusLabel']);
    expect(JSON.stringify(result)).not.toContain('0712223333');
    expect(JSON.stringify(result)).not.toContain('private house');
  });
});
