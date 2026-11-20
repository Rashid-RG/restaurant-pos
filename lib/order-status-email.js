import { platformPublisher } from '../shared/platform-brand.js';
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
    text: `${name}\n${heading}\n${detail}\nOrder: ${id}\nTotal: LKR ${total}${url ? '\nTrack: '+url : ''}\nPowered by GastroFlow · Developed by ${platformPublisher}`
  };
}

// Additive delivery receipts; preserves every existing order and transaction.
export async function initOrderStatusEmail(dbRun) {
  await dbRun(`CREATE TABLE IF NOT EXISTS order_status_email_receipts (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, orderId TEXT NOT NULL,
    status TEXT NOT NULL, claimedAt BIGINT NOT NULL, sentAt BIGINT,
    UNIQUE(tenant_id,orderId,status)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS order_stage_email_queue (
    id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, orderId TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, availableAt INTEGER NOT NULL DEFAULT 0,
    sentAt INTEGER, UNIQUE(tenant_id,orderId,status)
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_stage_email_due ON order_stage_email_queue(availableAt,id) WHERE sentAt IS NULL');
  // Capture transitions in the same transaction as the order. A rollback
  // removes its pending notification too. Existing orders are never backfilled.
  const stages = Object.keys(MILESTONES).map(stage => `'${stage}'`).join(',');
  await dbRun(`CREATE TRIGGER IF NOT EXISTS capture_online_order_stage_email
    AFTER UPDATE OF status ON orders
    WHEN NEW.status IS NOT OLD.status AND NEW.source='online'
      AND NEW.status IN (${stages}) AND trim(COALESCE(NEW.customerEmail,'')) LIKE '%_@_%._%'
      AND NOT (NEW.status='served' AND COALESCE(NULLIF(NEW.orderType,''),NEW.diningType,'')='delivery')
    BEGIN
      INSERT INTO order_stage_email_queue(tenant_id,orderId,status)
      SELECT NEW.tenant_id,NEW.id,NEW.status WHERE NEW.tenant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM order_stage_email_queue WHERE tenant_id=NEW.tenant_id AND orderId=NEW.id AND status=NEW.status)
        AND NOT EXISTS (SELECT 1 FROM order_status_email_receipts WHERE tenant_id=NEW.tenant_id AND orderId=NEW.id AND status=NEW.status AND sentAt IS NOT NULL);
    END`);
}

export async function deliverPendingStageEmails({dbAll,dbGet,dbRun,customerAppUrl,deliver=sendEmail}) {
  if (deliver === sendEmail && !isEmailConfigured()) return;
  const rows = await dbAll(`SELECT q.* FROM order_stage_email_queue q
    WHERE q.sentAt IS NULL AND q.availableAt<=?
      AND NOT EXISTS (SELECT 1 FROM order_stage_email_queue earlier WHERE earlier.tenant_id=q.tenant_id
        AND earlier.orderId=q.orderId AND earlier.id<q.id AND earlier.sentAt IS NULL)
    ORDER BY q.availableAt,q.id LIMIT 20`,[Date.now()]);
  for (const row of rows) {
    const attempt = row.attempts + 1;
    const claim = await dbRun(`UPDATE order_stage_email_queue SET availableAt=?, attempts=?
      WHERE id=? AND attempts=? AND sentAt IS NULL AND availableAt<=?`,
      [Date.now()+120000,attempt,row.id,row.attempts,Date.now()]);
    if (!claim.changes) continue;
    try {
      const order = await dbGet(`SELECT o.*, COALESCE(
        (SELECT NULLIF(value,'') FROM settings WHERE tenant_id=o.tenant_id AND key='businessName'),
        (SELECT NULLIF(value,'') FROM settings WHERE tenant_id=o.tenant_id AND key='restaurantName'),
        (SELECT name FROM tenants WHERE id=o.tenant_id)) AS merchantName
        FROM orders o WHERE o.tenant_id=? AND o.id=?`,[row.tenant_id,row.orderId]);
      if (!order || !emailPattern.test(String(order.customerEmail || '').trim())) {
        await dbRun('DELETE FROM order_stage_email_queue WHERE id=? AND attempts=?',[row.id,attempt]);
        continue;
      }
      const email = buildOrderStatusEmail({order,restaurantName:order.merchantName,status:row.status,
        url:trackingLink(customerAppUrl,row.tenant_id,row.orderId)});
      const result = await deliver({to:order.customerEmail.trim(),...email});
      if (!result?.success) throw new Error('Provider did not accept the email.');
      await dbRun('UPDATE order_stage_email_queue SET sentAt=? WHERE id=? AND attempts=?',[Date.now(),row.id,attempt]);
    } catch {
      const delayMs = Math.min(3600000,15000 * 2 ** Math.min(attempt-1,8));
      await dbRun('UPDATE order_stage_email_queue SET availableAt=? WHERE id=? AND attempts=?',[Date.now()+delayMs,row.id,attempt]);
    }
  }
}
