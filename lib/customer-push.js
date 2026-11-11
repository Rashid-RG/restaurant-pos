import webpush from 'web-push';
import crypto from 'node:crypto';

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
  if(!configure()||!tenantId)return;
  const targets=await dbAll('SELECT id,subscription FROM customer_order_push WHERE orderId=? AND tenant_id=? LIMIT 40',[orderId,tenantId]);
  const title='GastroFlow order update';
  const safeStatus=String(status||'updated').replace(/[^a-zA-Z_ ]/g,'').slice(0,40);
  for(const row of targets){
    try {
      await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify({title,body:'Your order is '+safeStatus.replaceAll('_',' ')+'.',orderId,tenantId}),{TTL:600});
    }catch(e){if(e.statusCode===404||e.statusCode===410)await dbRun('DELETE FROM customer_order_push WHERE id=? AND tenant_id=?',[row.id,tenantId]);}
  }
}
