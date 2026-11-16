import crypto from 'node:crypto';
import {sendEmail, isEmailConfigured} from './notifications.js';
import {renderEmailBase} from './email_templates.js';

// Status notifications belong to the restaurant that owns the saved order.
// Do not email for payment-only updates or for unrelated POS transactions.
const MILESTONES = {
  accepted: ['Order accepted', 'Your restaurant has accepted your order.'],
  confirmed: ['Order confirmed', 'Your order has been confirmed.'],
  preparing: ['Preparing your food', 'The kitchen has started preparing your food.'],
  ready: ['Ready for pickup', 'Your food is ready for pickup.'],
  served: ['Order handed over', 'Your order has been handed over. Thank you!'],
  completed: ['Order completed', 'Your pickup order has been completed. Thank you!'],
  picked_up: ['Collected by driver', 'Your order has been collected by the delivery driver.'],
  out_for_delivery: ['Out for delivery', 'Your order is on its way to you.'],
  arrived: ['Driver arrived', 'Your delivery driver has arrived.'],
  delivered: ['Order delivered', 'Your order has been delivered. Thank you!'],
  cancelled: ['Order cancelled', 'Your order has been cancelled.'],
  rejected: ['Order declined', 'The restaurant could not accept your order.']
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kind = order => String(order.orderType || order.diningType || '').toLowerCase();
const milestone = (status, order) => {
  const key = String(status || '').toLowerCase();
  if (key === 'ready' && kind(order) === 'delivery') return ['Food ready', 'Your food is ready and awaiting delivery pickup.'];
  if (key === 'ready' && kind(order) === 'dine-in') return ['Food ready', 'Your food is ready to be served.'];
  if (key === 'served' && kind(order) === 'delivery') return null;
  return MILESTONES[key] || null;
};
const trackingLink = (base, tenantId, orderId) => {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.searchParams.set('tenant',tenantId);
    url.searchParams.set('track',orderId);
    return url.href;
  } catch { return ''; }
};
export function buildOrderStatusEmail({order, restaurantName, status, url=''}) {
  const stage = milestone(status,order);
  if (!stage) return null;
  const [heading,detail] = stage;
  const name = String(restaurantName || 'Your restaurant').trim();
  const id = String(order.id || '');
  const total = Number(order.total || 0).toFixed(2);
  const safeUrl = url.startsWith('https://') ? escape(url) : '';
  const bodyHtml = `
    <p style="color:#087653;font-weight:800;letter-spacing:.07em;margin:0 0 8px">ORDER UPDATE</p>
    <h2 style="font-size:24px;color:#143d30;margin:0 0 12px">${escape(heading)}</h2>
    <p style="font-size:15px;color:#375849;line-height:1.7">${escape(detail)}</p>
    <p style="font-size:15px;color:#375849"><strong>Restaurant:</strong> ${escape(name)}<br>
    <strong>Order reference:</strong> ${escape(id)}<br>
    <strong>Order total:</strong> LKR ${escape(total)}</p>
    ${safeUrl ? `<p style="margin:25px 0"><a href="${safeUrl}" style="display:inline-block;background:#087653;color:#fff;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:bold">View order progress</a></p>` : ''}
    <p style="font-size:12px;color:#64748b">This email reflects a confirmed restaurant order-stage update, not a payment confirmation.</p>`;
  return {
    subject: `${name} · ${heading} · Order #${id.slice(-8)}`,
    html: renderEmailBase({title:heading,preheader:`${name}: ${detail}`,bodyHtml,businessName:name}),
    text: `${name}\n${heading}\n${detail}\nOrder: ${id}\nTotal: LKR ${total}${url ? '\nTrack: '+url : ''}\nPowered by GastroFlow · Developed by RS Technologies`
  };
}

// Additive delivery receipts; preserves every existing order and transaction.
export async function initOrderStatusEmail(dbRun) {
  await dbRun(`CREATE TABLE IF NOT EXISTS order_status_email_receipts (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, orderId TEXT NOT NULL,
    status TEXT NOT NULL, claimedAt BIGINT NOT NULL, sentAt BIGINT,
    UNIQUE(tenant_id,orderId,status)
  )`);
}

// No success receipt is written until the provider accepts the email.
// A single status sends once, even when the same event is emitted repeatedly.
export async function sendOrderStatusEmail({dbGet,dbRun,orderId,tenantId,status,customerAppUrl}) {
  if (!orderId || !tenantId || !milestone(status,{}) || !isEmailConfigured()) return {skipped:true};
  const order = await dbGet('SELECT * FROM orders WHERE id=? AND tenant_id=?',[orderId,tenantId]);
  if (!order || order.source !== 'online' || String(order.status).toLowerCase() !== String(status).toLowerCase()) return {skipped:true};
  const recipient = String(order.customerEmail || '').trim();
  if (!emailPattern.test(recipient)) return {skipped:true};
  const business = await dbGet("SELECT value FROM settings WHERE tenant_id=? AND key='businessName'",[tenantId]);
  const restaurant = await dbGet("SELECT value FROM settings WHERE tenant_id=? AND key='restaurantName'",[tenantId]);
  const tenant = await dbGet('SELECT name FROM tenants WHERE id=?',[tenantId]);
  const name = business?.value || restaurant?.value || tenant?.name || 'Your restaurant';
  const email = buildOrderStatusEmail({order,restaurantName:name,status,url:trackingLink(customerAppUrl,tenantId,orderId)});
  if (!email) return {skipped:true};
  const id=crypto.createHash('sha256').update(JSON.stringify([tenantId,orderId,status])).digest('hex');
  const now=Date.now();
  const insert=await dbRun(
    'INSERT OR IGNORE INTO order_status_email_receipts (id,tenant_id,orderId,status,claimedAt) VALUES (?,?,?,?,?)',
    [id,tenantId,orderId,status,now]
  );
  let claimed=insert?.changes===1;
  if (!claimed) {
    const retry=await dbRun(
      'UPDATE order_status_email_receipts SET claimedAt=? WHERE id=? AND sentAt IS NULL AND claimedAt<?',
      [now,id,now-120000]
    );
    claimed=retry?.changes===1;
  }
  if (!claimed) return {skipped:true};
  try {
    const result=await sendEmail({to:recipient,...email});
    if (!result?.success) throw new Error(result?.error || 'Email provider did not accept the notification');
    await dbRun('UPDATE order_status_email_receipts SET sentAt=? WHERE id=? AND claimedAt=?',[Date.now(),id,now]);
    return {sent:true};
  } catch(error) {
    await dbRun('DELETE FROM order_status_email_receipts WHERE id=? AND claimedAt=? AND sentAt IS NULL',[id,now]).catch(()=>{});
    console.error('[Order stage email] Delivery failed:',error.message);
    return {sent:false};
  }
}
