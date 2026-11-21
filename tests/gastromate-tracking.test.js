import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isTrackingIntent, selectTrackableOrders, safeOrderChoice } from '../apps/customer-web/src/utils/gastromate-tracking.js';

describe('GastroMate secure order handoff', () => {
  it('recognizes order tracking intents without calling the LLM', () => {
    for (const text of ['Track my order','where is my order','Where is the driver?', 'order status', 'my orders', 'delivery status']) {
      expect(isTrackingIntent(text)).toBe(true);
    }
    expect(isTrackingIntent('recommend a spicy burger')).toBe(false);
    expect(isTrackingIntent('order 2 burgers')).toBe(false);
    expect(isTrackingIntent('මගේ ඇණවුම කොහෙද')).toBe(true);
    expect(isTrackingIntent('என் ஆர்டர் எங்கே')).toBe(true);
    expect(isTrackingIntent('கோழி பர்கர் விலை')).toBe(false);
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

describe('GastroMate integration security regressions', () => {
  it('requires customer authentication and restaurant scope in the history query', () => {
    const server=readFileSync('server.js','utf8');
    const start=server.indexOf("app.get('/api/customer/orders'");
    expect(start).toBeGreaterThan(0);
    const block=server.slice(start,server.indexOf('// POST /api/customer/loyalty/redeem',start));
    expect(block).toContain('authenticateCustomer');
    expect(block).toContain('customerAccountId = ? AND tenant_id = ?');
    expect(block).toContain('[req.customer.id, req.customer.tenant_id]');
  });
  it('never forwards order lookup to the AI model', () => {
    const concierge=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
    expect(concierge).toContain('if (isTrackingIntent(queryText))');
    expect(concierge).toContain("apiFetch('/customer/orders'");
    expect(concierge).toContain('safeOrderChoice(order, trackingChoices)');
  });
  it('opens tracking with a selected order and clears it for generic tracking', () => {
    const app=readFileSync('apps/customer-web/src/App.jsx','utf8');
    expect(app).toContain("if (v === 'track') setTrackingOrderId(extraParams.track ? String(extraParams.track) : null)");
    const tracking=readFileSync('apps/customer-web/src/views/OrderTrackingView.jsx','utf8');
    expect(tracking).toContain('setDriverLoc(null)');
  });
});
