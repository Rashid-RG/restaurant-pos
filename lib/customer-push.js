import webpush from 'web-push';
import crypto from 'node:crypto';
import {orderPushMessage,pushReceiptKey} from './order-push-policy.js';

export const pushConfigured=()=>Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_CONTACT_EMAIL);
const configure=()=>{
  if(!pushConfigured())return false;
  webpush.setVapidDetails('mailto:'+process.env.VAPID_CONTACT_EMAIL,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  return true;
};
export async function initCustomerPush(dbRun){
  await dbRun(`CREATE TABLE IF NOT EXISTS customer_order_push (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, orderId TEXT NOT NULL,
    subscription TEXT NOT NULL, endpointHash TEXT NOT NULL, createdAt INTEGER NOT NULL,
    UNIQUE(tenant_id,orderId,endpointHash)
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_customer_order_push ON customer_order_push(tenant_id,orderId)');
  await dbRun(`CREATE TABLE IF NOT EXISTS customer_order_push_receipts (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, orderId TEXT NOT NULL,
    endpointHash TEXT NOT NULL, eventCode TEXT NOT NULL,
    claimedAt INTEGER NOT NULL, deliveredAt INTEGER,
    UNIQUE(tenant_id,orderId,endpointHash,eventCode)
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_customer_order_push_receipts ON customer_order_push_receipts(tenant_id,orderId)');

}
export function createCustomerPushRoutes({dbRun,dbGet,resolvePublicTenant,guard,rateLimit}){
  return async function subscribe(req,res){
    if(!configure())return res.status(503).json({error:'Push notifications are not configured. Live in-app tracking is still available.'});
    try{
      const {subscription}=req.body||{};
      if(!subscription?.endpoint||typeof subscription.endpoint!=='string'||subscription.endpoint.length>1600||!subscription.endpoint.startsWith('https://')||!subscription.keys?.p256dh||!subscription.keys?.auth) return res.status(400).json({error:'Invalid browser push subscription.'});
      const tenantId=await resolvePublicTenant(req);
      const found=await dbGet('SELECT id FROM orders WHERE tenant_id=? AND id=?',[tenantId,req.params.id]);
      if(!found)return res.status(404).json({error:'Order not found.'});
      const hash=crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
      await dbRun(`INSERT OR IGNORE INTO customer_order_push (id,tenant_id,orderId,subscription,endpointHash,createdAt)
        VALUES (?,?,?,?,?,?)`,['cp_'+crypto.randomUUID(),tenantId,req.params.id,JSON.stringify(subscription),hash,Date.now()]);
      res.status(201).json({success:true});
    }catch(e){res.status(500).json({error:'Could not register notifications.'});}
  };
}
export async function sendOrderPush(dbAll,dbRun,orderId,tenantId,status){
  const message=orderPushMessage(status);
  if(!message||!configure()||!tenantId||!orderId)return;
  const targets=await dbAll('SELECT id,subscription,endpointHash FROM customer_order_push WHERE orderId=? AND tenant_id=? LIMIT 40',[orderId,tenantId]);
  for(const row of targets){
    const receiptId=pushReceiptKey(tenantId,orderId,row.endpointHash,status);
    if(!receiptId)continue;
    const now=Date.now();
    let claimed=false;
    try {
      // Atomic unique insert makes simultaneous status broadcasts safe.
      const inserted=await dbRun(
        'INSERT OR IGNORE INTO customer_order_push_receipts (id,tenant_id,orderId,endpointHash,eventCode,claimedAt) VALUES (?,?,?,?,?,?)',
        [receiptId,tenantId,orderId,row.endpointHash,status,now]
      );
      claimed=inserted?.changes===1;
      if(!claimed){
        // If a process died mid-send, allow a later call to reclaim the receipt.
        // Successful sends (deliveredAt set) remain suppressed permanently.
        const reclaimed=await dbRun(
          'UPDATE customer_order_push_receipts SET claimedAt=? WHERE id=? AND deliveredAt IS NULL AND claimedAt<?',
          [now,receiptId,now-120000]
        );
        claimed=reclaimed?.changes===1;
      }
      if(!claimed)continue;
      await webpush.sendNotification(
        JSON.parse(row.subscription),
        JSON.stringify({title:message.title,body:message.body,orderId,tenantId,status}),
        {TTL:600}
      );
      await dbRun('UPDATE customer_order_push_receipts SET deliveredAt=? WHERE id=? AND claimedAt=?',[Date.now(),receiptId,now]);
    }catch(error){
      // Clear a failed claim so a later committed update can retry the notification.
      // Expired subscriptions are removed, preventing repeated failed sends.
      if(claimed)await dbRun('DELETE FROM customer_order_push_receipts WHERE id=? AND claimedAt=? AND deliveredAt IS NULL',[receiptId,now]).catch(()=>{});
      if(error?.statusCode===404||error?.statusCode===410){
        await dbRun('DELETE FROM customer_order_push WHERE id=? AND tenant_id=?',[row.id,tenantId]).catch(()=>{});
      }
    }
  }
}

// Recover missed current milestones after transient push outages and process
// restarts. This reads committed order state; it never rewrites fulfillment,
// payment, or evidence. Successful per-browser receipts remain authoritative.
// Look back one day to avoid notifying customers about stale historical orders.
export async function recoverPendingOrderPush(dbAll,dbRun,{now=Date.now(),limit=100}={}){
  if(!pushConfigured())return {checked:0};
  const since=now-24*60*60*1000;
  const count=Math.max(1,Math.min(100,Number(limit)||100));
  const pending=await dbAll(`
    WITH events AS (
      SELECT o.id AS orderId,o.tenant_id AS tenantId,o.status AS eventCode,o.timestamp
      FROM orders o
      WHERE o.timestamp>=? AND o.status IN
        ('pending','confirmed','accepted','preparing','ready','picked_up',
         'out_for_delivery','arrived','delivered','completed','cancelled','rejected')
      UNION ALL
      SELECT o.id AS orderId,o.tenant_id AS tenantId,'driver_assigned' AS eventCode,o.timestamp
      FROM orders o
      WHERE o.timestamp>=? AND o.driverId IS NOT NULL AND o.driverId<>''
        AND o.status IN ('pending','confirmed','accepted','preparing','ready',
                         'picked_up','out_for_delivery','arrived')
    )
    SELECT DISTINCT e.orderId,e.tenantId,e.eventCode,e.timestamp
    FROM events e
    JOIN customer_order_push p ON p.orderId=e.orderId AND p.tenant_id=e.tenantId
    LEFT JOIN customer_order_push_receipts r
      ON r.tenant_id=p.tenant_id AND r.orderId=p.orderId
      AND r.endpointHash=p.endpointHash AND r.eventCode=e.eventCode
      AND r.deliveredAt IS NOT NULL
    WHERE r.id IS NULL
    ORDER BY e.timestamp DESC
    LIMIT ?
  `,[since,since,count]);
  let checked=0;
  for(const row of pending){
    if(!row?.orderId||!row?.tenantId||!orderPushMessage(row.eventCode))continue;
    try{
      await sendOrderPush(dbAll,dbRun,row.orderId,row.tenantId,row.eventCode);
      checked++;
    }catch(error){
      console.error('[Order push recovery]',error?.message||'Notification recovery failed');
    }
  }
  return {checked};
}
