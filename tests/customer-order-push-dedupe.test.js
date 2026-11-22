import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {orderPushMessage,pushReceiptKey} from '../lib/order-push-policy.js';

const sent=vi.hoisted(()=>vi.fn(async()=>({statusCode:201})));
vi.mock('web-push',()=>({default:{setVapidDetails:vi.fn(),sendNotification:sent}}));
import {sendOrderPush,initCustomerPush,recoverPendingOrderPush} from '../lib/customer-push.js';

describe('GastroFood delivery push notifications',()=>{
  const tenant='restaurant-A',order='order-123',endpoint='hash-of-browser-subscription';
  let receipts,dbRun,dbAll;
  beforeEach(()=>{
    vi.stubEnv('VAPID_PUBLIC_KEY','test-vapid-public');
    vi.stubEnv('VAPID_PRIVATE_KEY','test-vapid-private');
    vi.stubEnv('VAPID_CONTACT_EMAIL','routing@example.com');
    sent.mockReset().mockResolvedValue({statusCode:201});
    receipts=new Map();
    dbAll=vi.fn(async()=>[{id:'push-1',endpointHash:endpoint,subscription:JSON.stringify({endpoint:'https://push.example.test',keys:{auth:'a',p256dh:'b'}})}]);
    dbRun=vi.fn(async(sql,params=[])=>{
      if(sql.startsWith('CREATE '))return {changes:0};
      if(sql.startsWith('INSERT OR IGNORE INTO customer_order_push_receipts')){
        if(receipts.has(params[0]))return {changes:0};
        receipts.set(params[0],{claimedAt:params[5],deliveredAt:null});
        return {changes:1};
      }
      if(sql.startsWith('UPDATE customer_order_push_receipts SET deliveredAt=')){
        const entry=receipts.get(params[1]);
        if(!entry||entry.claimedAt!==params[2])return {changes:0};
        entry.deliveredAt=params[0];return {changes:1};
      }
      if(sql.startsWith('UPDATE customer_order_push_receipts SET claimedAt=')){
        const entry=receipts.get(params[1]);
        if(!entry||entry.deliveredAt!=null||entry.claimedAt>=params[2])return {changes:0};
        entry.claimedAt=params[0];return {changes:1};
      }
      if(sql.startsWith('DELETE FROM customer_order_push_receipts')){
        const entry=receipts.get(params[0]);
        if(entry&&entry.claimedAt===params[1]&&entry.deliveredAt===null){receipts.delete(params[0]);return {changes:1}}
        return {changes:0};
      }
      if(sql.startsWith('DELETE FROM customer_order_push'))return {changes:1};
      throw new Error('Unexpected SQL '+sql);
    });
  });
  afterEach(()=>vi.unstubAllEnvs());
  it('offers precise milestones without personal details',()=>{
    expect(orderPushMessage('picked_up').title).toMatch(/collected/i);
    expect(orderPushMessage('arrived').body).toMatch(/reported arrival/i);
    expect(orderPushMessage('driver_assigned').body).toMatch(/assigned/i);
    expect(orderPushMessage('unknown')).toBe(null);
    expect(pushReceiptKey(tenant,order,endpoint,'ready')).not.toBe(pushReceiptKey(tenant,order,endpoint,'delivered'));
  });
  it('creates a durable receipt table during startup',async()=>{
    await initCustomerPush(dbRun);
    const statements=dbRun.mock.calls.map(([sql])=>sql).join(' ');
    expect(statements).toContain('customer_order_push_receipts');
    expect(statements).toContain('deliveredAt');
  });
  it('sends one push per browser and status despite duplicate updates',async()=>{
    await sendOrderPush(dbAll,dbRun,order,tenant,'picked_up');
    await sendOrderPush(dbAll,dbRun,order,tenant,'picked_up');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent.mock.calls[0][1]).body).toMatch(/collected/i);
    await sendOrderPush(dbAll,dbRun,order,tenant,'arrived');
    expect(sent).toHaveBeenCalledTimes(2);
  });
  it('releases an unsuccessful claim so the next committed update can retry',async()=>{
    sent.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    await sendOrderPush(dbAll,dbRun,order,tenant,'ready');
    expect(receipts.size).toBe(0);
    await sendOrderPush(dbAll,dbRun,order,tenant,'ready');
    expect(sent).toHaveBeenCalledTimes(2);
    expect(receipts.size).toBe(1);
  });
  it('recovers a failed delivered milestone on a safe retry without resending successful notifications',async()=>{
    sent.mockRejectedValueOnce(new Error('temporary gateway outage')).mockResolvedValueOnce({statusCode:201});
    await sendOrderPush(dbAll,dbRun,order,tenant,'delivered');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(receipts.size).toBe(0);
    await sendOrderPush(dbAll,dbRun,order,tenant,'delivered');
    expect(sent).toHaveBeenCalledTimes(2);
    expect([...receipts.values()][0].deliveredAt).toEqual(expect.any(Number));
    await sendOrderPush(dbAll,dbRun,order,tenant,'delivered');
    expect(sent).toHaveBeenCalledTimes(2);
  });
  it('recovers missed committed delivery status without reopening settlement or duplicating a delivered push',async()=>{
    const subscribed=dbAll;
    dbAll=vi.fn(async(sql,params)=>{
      if(sql.includes('WITH events AS (')){
        expect(sql).toContain('customer_order_push_receipts');
        expect(sql).toContain('r.deliveredAt IS NOT NULL');
        expect(sql).toContain('o.tenant_id');
        expect(params).toHaveLength(3);
        expect(params[0]).toBeLessThanOrEqual(Date.now()-23*60*60*1000);
        return [{orderId:order,tenantId:tenant,eventCode:'delivered',timestamp:Date.now()}];
      }
      return subscribed(sql,params);
    });
    sent.mockRejectedValueOnce(new Error('push provider unavailable')).mockResolvedValue({statusCode:201});
    expect((await recoverPendingOrderPush(dbAll,dbRun)).checked).toBe(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(receipts.size).toBe(0);
    // Automatic recovery may retry after a process restart or on the next sweep.
    expect((await recoverPendingOrderPush(dbAll,dbRun)).checked).toBe(1);
    expect(sent).toHaveBeenCalledTimes(2);
    expect([...receipts.values()][0].deliveredAt).toEqual(expect.any(Number));
    await recoverPendingOrderPush(dbAll,dbRun);
    expect(sent).toHaveBeenCalledTimes(2);
    expect(dbRun.mock.calls.some(([sql])=>/UPDATE orders|INSERT INTO orders|delivery_proofs|invoice_counter/.test(sql))).toBe(false);
  });
  it('recovers assigned-rider milestone using the same scoped push receipt',async()=>{
    const subscriptions=dbAll;
    dbAll=vi.fn(async(sql,params)=>sql.includes('WITH events AS (')
      ? [{orderId:order,tenantId:tenant,eventCode:'driver_assigned',timestamp:Date.now()}]
      : subscriptions(sql,params));
    await recoverPendingOrderPush(dbAll,dbRun);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent.mock.calls[0][1]).status).toBe('driver_assigned');
    await recoverPendingOrderPush(dbAll,dbRun);
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it('skips the recovery database scan when push is not configured',async()=>{
    vi.stubEnv('VAPID_PRIVATE_KEY','');
    expect(await recoverPendingOrderPush(dbAll,dbRun)).toEqual({checked:0});
    expect(dbAll).not.toHaveBeenCalled();
  });
  it('does not send unknown statuses or when push is not configured',async()=>{
    await sendOrderPush(dbAll,dbRun,order,tenant,'mystery');
    expect(sent).not.toHaveBeenCalled();
    vi.stubEnv('VAPID_PUBLIC_KEY','');
    await sendOrderPush(dbAll,dbRun,order,tenant,'ready');
    expect(sent).not.toHaveBeenCalled();
  });
});
